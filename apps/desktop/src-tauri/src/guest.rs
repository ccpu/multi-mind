//! The embedded browsers.
//!
//! WebView2 gave the WinForms build a control it could dock like any other, and
//! Electron gave the port a `<webview>` element the page laid out itself. Tauri
//! has neither: a guest here is a child webview of a main window — the
//! `unstable` feature in Cargo.toml is what allows more than one — owned by
//! Rust, positioned in window coordinates and drawn over the page.
//!
//! So the window still decides the layout, with the same flex row and the same
//! Split.js it always had, and sends the measurements down. Everything else
//! about a guest is decided in `@internal/multi-mind`: the scripts it runs, the
//! menu a right-click on it offers, which of its cookies belong to the site.
//! This file carries those across and nothing more.
//!
//! There may be several main windows, and every one of them has a row of these.
//! A guest therefore belongs to a window rather than to the app: its label
//! names the window it is in, the commands act on the window that called them,
//! and what the app remembers about a row — which scripts it was built from,
//! whether it is hidden, whether anyone is looking at it — is kept per window
//! in [`GuestHost`]. What they all share is the one thing they should: the
//! browser profile, and so the sign-ins in it.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::webview::{Cookie, Webview, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, State, WebviewUrl, Window,
};
use url::Url;

use crate::identity;

/// The first main window, which `commands::open_main_window` creates.
pub const MAIN_WINDOW_LABEL: &str = "main";

/// What every main window opened after the first is labelled with —
/// `main-2`, `main-3`, and so on. See `commands::new_window`.
pub const EXTRA_MAIN_WINDOW_PREFIX: &str = "main-";

/// Label prefix every guest takes, which is what capabilities/guest.json
/// matches on. Nothing else in the app may be labelled this way.
const GUEST_LABEL_PREFIX: &str = "chat-";

/// What separates the window from the site inside a guest's label.
///
/// A colon, because a window label may contain a hyphen (`main-2`) and a site
/// id may contain anything the settings file says it does — so splitting on
/// the first colon is the one reading of `chat-main-2:claude` there is. Tauri
/// allows it in a label, and neither half ever holds one.
const GUEST_LABEL_SEPARATOR: char = ':';

/// Prefix for the in-app window a sign-in flow asks for.
const POPUP_LABEL_PREFIX: &str = "popup-";

/// Folder all the browsers share, mirroring the single WebView2 user-data
/// folder the WinForms build gave every control and the `persist:multi-mind`
/// partition the Electron port used. One profile is what lets a sign-in done in
/// one pane be a sign-in everywhere — in the other panes, in the sign-in
/// windows, and in every other main window that is open — and what makes
/// clearing cookies a per-site job rather than a per-pane one.
const PROFILE_DIRECTORY: &str = "browser-profile";

/// Event a guest's message is re-broadcast on, for its own window to answer.
const GUEST_MESSAGE_EVENT: &str = "multi-mind://guest-message";

/// The current default for the setting the user changes in Settings → Memory.
const DEFAULT_IDLE_MEMORY_TRIM_DELAY_SECONDS: u64 = 10;

/// Chromium switches every webview in the app is started with.
///
/// Three panes of a chat site is three renderers, a browser process, a GPU
/// process and the service processes behind them, and the defaults size all of
/// those for a browser with one window per site rather than for an app that
/// keeps three open side by side all day. These bring that down without
/// touching anything the sandbox or the origin boundaries rest on — no
/// `--renderer-process-limit`, which would let two sites share a renderer, and
/// no `--disable-site-isolation-trials`.
///
/// One string for every webview, not one per window: WebView2 keys its browser
/// process on the user-data folder *and* these arguments, so two webviews
/// sharing a folder with different arguments cannot both be created. The panes
/// and the sign-in windows share `browser-profile`, the app's own pages share
/// the default folder, and every native window takes the same startup choice.
///
/// - `msWebOOUI,msPdfOOUI,msSmartScreenProtection` is wry's own default, and
///   overriding the argument string replaces it, so it has to be carried here.
/// - `BackForwardCache` keeps a whole extra page alive per pane on the chance
///   the user presses Back; the right-click Back that costs is a reload.
/// - `--enable-low-end-device-mode` puts Chromium on its small-memory budgets:
///   smaller V8 heaps, less decoded-image and tile cache. It is the largest
///   single saving here and the only one with a cost — a very long transcript
///   has a lower ceiling before its renderer gives up, and animation is a
///   little cheaper-looking.
/// - `--process-per-site` folds two panes on the same site, and a site's own
///   iframes, into one renderer — including two panes in *different* windows,
///   which is what keeps a second window from costing a second set of
///   renderers. Different sites stay in different processes: this is process
///   reuse *within* an origin, not across.
/// - `--optimize-for-size` is V8 choosing memory over speed.
///
/// Off Windows every use is behind `#[cfg(windows)]`.
#[cfg(windows)]
pub const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,BackForwardCache --enable-low-end-device-mode --process-per-site --js-flags=--optimize-for-size";

/// The normal browser budget. The features wry disables by default must stay
/// here because assigning arguments replaces its complete default string.
#[cfg(windows)]
const STANDARD_BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

/// The subset of memory controls that can safely change while the app runs.
#[derive(Clone, Copy, PartialEq, Eq)]
struct MemoryTargetSettings {
    trim_inactive_webviews: bool,
    idle_memory_trim_delay: Duration,
}

impl MemoryTargetSettings {
    fn from_settings(settings: &Value) -> Self {
        let trim_inactive_webviews = settings
            .get("trimInactiveWebviews")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        let idle_memory_trim_delay_seconds = settings
            .get("idleMemoryTrimDelaySeconds")
            .and_then(Value::as_u64)
            .filter(|seconds| matches!(seconds, 5 | 10 | 30 | 60))
            .unwrap_or(DEFAULT_IDLE_MEMORY_TRIM_DELAY_SECONDS);

        Self {
            trim_inactive_webviews,
            idle_memory_trim_delay: Duration::from_secs(idle_memory_trim_delay_seconds),
        }
    }
}

/// The live memory-target policy. Browser arguments are immutable for one app
/// run, but WebView2's idle budget is safe to change as soon as Settings saves.
pub(crate) struct MemoryTargetPolicy(Mutex<MemoryTargetSettings>);

impl MemoryTargetPolicy {
    pub(crate) fn from_settings(settings: &Value) -> Self {
        Self(Mutex::new(MemoryTargetSettings::from_settings(settings)))
    }

    fn current(&self) -> MemoryTargetSettings {
        *self.0.lock().unwrap_or_else(|error| error.into_inner())
    }

    fn replace(&self, next: MemoryTargetSettings) -> bool {
        let mut current = self.0.lock().unwrap_or_else(|error| error.into_inner());

        if *current == next {
            return false;
        }

        *current = next;
        true
    }
}

/// Browser arguments are fixed for the lifetime of the shared WebView2
/// profile, so Settings applies this choice the next time the app starts.
#[cfg(windows)]
#[derive(Clone, Copy)]
struct BrowserMemorySettings {
    browser_memory_saving: bool,
    disable_back_forward_cache: bool,
    enable_low_end_device_mode: bool,
    process_per_site: bool,
    optimize_for_size: bool,
}

#[cfg(windows)]
impl BrowserMemorySettings {
    fn from_settings(settings: &Value) -> Self {
        Self {
            browser_memory_saving: settings
                .get("browserMemorySaving")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            disable_back_forward_cache: settings
                .get("disableBackForwardCache")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            enable_low_end_device_mode: settings
                .get("enableLowEndDeviceMode")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            process_per_site: settings
                .get("processPerSite")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            optimize_for_size: settings
                .get("optimizeForSize")
                .and_then(Value::as_bool)
                .unwrap_or(true),
        }
    }
}

#[cfg(windows)]
pub(crate) struct BrowserArguments(String);

#[cfg(windows)]
impl BrowserArguments {
    pub(crate) fn from_settings(settings: &Value) -> Self {
        let memory = BrowserMemorySettings::from_settings(settings);

        if !memory.browser_memory_saving {
            return Self(STANDARD_BROWSER_ARGS.into());
        }

        if memory.disable_back_forward_cache
            && memory.enable_low_end_device_mode
            && memory.process_per_site
            && memory.optimize_for_size
        {
            return Self(BROWSER_ARGS.into());
        }

        let mut disabled_features = "msWebOOUI,msPdfOOUI,msSmartScreenProtection".to_string();

        if memory.disable_back_forward_cache {
            disabled_features.push_str(",BackForwardCache");
        }

        let mut arguments = format!("--disable-features={disabled_features}");

        if memory.enable_low_end_device_mode {
            arguments.push_str(" --enable-low-end-device-mode");
        }
        if memory.process_per_site {
            arguments.push_str(" --process-per-site");
        }
        if memory.optimize_for_size {
            arguments.push_str(" --js-flags=--optimize-for-size");
        }

        Self(arguments)
    }

    fn value(&self) -> String {
        self.0.clone()
    }
}

#[cfg(windows)]
pub(crate) fn browser_args<R: Runtime>(app: &AppHandle<R>) -> String {
    app.state::<BrowserArguments>().value()
}

/// Whether a label names a main window — the one from the config, or one of
/// the copies opened since.
pub fn is_main_window_label(label: &str) -> bool {
    label == MAIN_WINDOW_LABEL || label.starts_with(EXTRA_MAIN_WINDOW_PREFIX)
}

fn guest_label(window_label: &str, website_id: &str) -> String {
    format!("{GUEST_LABEL_PREFIX}{window_label}{GUEST_LABEL_SEPARATOR}{website_id}")
}

/// The window and the site a guest's label names, or `None` for a label that
/// is not a guest's.
fn split_guest_label(label: &str) -> Option<(&str, &str)> {
    label
        .strip_prefix(GUEST_LABEL_PREFIX)?
        .split_once(GUEST_LABEL_SEPARATOR)
}

/// The webviews that are browsers, which is what a sweep over the app's own
/// has to be able to tell: every window's page is one of them, and so is a
/// sign-in window that happens to be open.
fn is_guest_label(label: &str) -> bool {
    split_guest_label(label).is_some()
}

/// Whether a label names a browser belonging to one particular window, which
/// is what keeps one window's layout pass from closing another's panes.
fn is_guest_of(label: &str, window_label: &str) -> bool {
    matches!(split_guest_label(label), Some((window, _)) if window == window_label)
}

/// Mirror of `GuestGlobals`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestGlobals {
    pub bridge_key: String,
    pub find_key: String,
}

/// Mirror of `GuestBounds`, in CSS pixels inside the window.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Mirror of `GuestPane`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestPane {
    pub website_id: String,
    pub url: String,
    pub bounds: GuestBounds,
    /// `createGuestScripts` output. Read only when the webview is created.
    pub scripts: Vec<String>,
}

/// Mirror of `GuestCookie`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestCookie {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    pub secure: bool,
}

/// Mirror of `GuestCookieRemoval`: a cookie named through a URL it would have
/// been sent to, which is how `cookieRemovalUrl` describes one.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestCookieRemoval {
    pub name: String,
    pub url: String,
}

/// Payload of the guest-message event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GuestMessagePayload {
    website_id: String,
    message: String,
}

/// What the app remembers about one window's row of browsers.
struct WindowGuests {
    /// False while a divider is being dragged or a popover is open, because a
    /// child webview takes both the pointer and the pixels from the page.
    visible: bool,
    /// The scripts each open guest was built with, keyed by site id.
    ///
    /// A layout pass is a whole list of panes, and a window sends one on every
    /// frame of a divider drag. Carrying every guest's scripts in each of
    /// those means serialising, shipping and re-allocating tens of kilobytes
    /// sixty times a second for strings that are only ever read when a webview
    /// is first built. So the window sends them once, for a pane it has not
    /// opened yet, and they are kept here for the rebuild that a site switched
    /// off and on again asks for.
    scripts: HashMap<String, Vec<String>>,
    /// Whether nobody is looking at this window.
    idle: bool,
    /// Bumped by every focus change, so the timer one of them starts can tell
    /// that another has overtaken it.
    idle_generation: u64,
}

impl Default for WindowGuests {
    fn default() -> Self {
        Self {
            visible: true,
            scripts: HashMap::new(),
            idle: false,
            idle_generation: 0,
        }
    }
}

pub struct GuestHost {
    globals: GuestGlobals,
    profile_directory: PathBuf,
    user_agent: Option<String>,
    /// One entry per main window that has laid out a row, dropped when the
    /// window closes.
    windows: Mutex<HashMap<String, WindowGuests>>,
    /// Numbers the sign-in windows. A counter rather than a count of the ones
    /// that are open, because two windows may each have one up and a label has
    /// to be unique across the app.
    popups: AtomicU64,
    /// Held for the whole of a layout pass.
    ///
    /// A window measures its panes after every commit, on every resize and on
    /// every frame of a divider drag, and the calls that carry those are
    /// `async` — so two of them can be in flight at once, both find a pane not
    /// yet open and both try to open it. The second then fails with `a webview
    /// with label ... already exists`, and takes a whole layout pass with it.
    /// One pass at a time makes "is it open?" and "open it" one decision.
    ///
    /// Nothing inside the pass awaits, so this is never held across a yield;
    /// and it is the outermost of the two locks here, so the order is always
    /// the same.
    reconcile: Mutex<()>,
}

impl GuestHost {
    pub fn new(profile_directory: PathBuf) -> Self {
        Self {
            globals: GuestGlobals {
                bridge_key: random_global_name(),
                find_key: random_global_name(),
            },
            profile_directory,
            user_agent: identity::guest_user_agent(),
            windows: Mutex::new(HashMap::new()),
            popups: AtomicU64::new(0),
            reconcile: Mutex::new(()),
        }
    }

    /// Reads or changes one window's row, starting a fresh entry for a window
    /// that has not laid one out yet.
    fn with_window<T>(&self, window_label: &str, act: impl FnOnce(&mut WindowGuests) -> T) -> T {
        let mut windows = self
            .windows
            .lock()
            .unwrap_or_else(|error| error.into_inner());

        act(windows.entry(window_label.to_string()).or_default())
    }

    /// Remembers what a pane was sent, and answers with what its webview should
    /// be built from — which is whatever was last sent for that site.
    fn remember_scripts(&self, window_label: &str, pane: &GuestPane) -> Vec<String> {
        self.with_window(window_label, |state| {
            if !pane.scripts.is_empty() {
                state
                    .scripts
                    .insert(pane.website_id.clone(), pane.scripts.clone());
            }

            state
                .scripts
                .get(&pane.website_id)
                .cloned()
                .unwrap_or_default()
        })
    }

    /// Drops what is remembered for a site whose browser has been closed, so a
    /// later one is built from scripts the window has sent since.
    fn forget_scripts(&self, window_label: &str, website_id: &str) {
        self.with_window(window_label, |state| {
            state.scripts.remove(website_id);
        });
    }

    fn is_visible(&self, window_label: &str) -> bool {
        self.with_window(window_label, |state| state.visible)
    }

    fn set_visible(&self, window_label: &str, visible: bool) {
        self.with_window(window_label, |state| state.visible = visible);
    }

    /// Marks a window idle or not, answering whether that was a change.
    fn set_idle(&self, window_label: &str, idle: bool) -> bool {
        self.with_window(window_label, |state| {
            std::mem::replace(&mut state.idle, idle) != idle
        })
    }

    fn bump_idle_generation(&self, window_label: &str) -> u64 {
        self.with_window(window_label, |state| {
            state.idle_generation += 1;
            state.idle_generation
        })
    }

    /// `None` once the window has closed, which is how a timer it left behind
    /// learns to do nothing.
    fn idle_generation(&self, window_label: &str) -> Option<u64> {
        let windows = self
            .windows
            .lock()
            .unwrap_or_else(|error| error.into_inner());

        windows.get(window_label).map(|state| state.idle_generation)
    }

    /// The windows nobody is looking at.
    fn idle_windows(&self) -> HashSet<String> {
        let windows = self
            .windows
            .lock()
            .unwrap_or_else(|error| error.into_inner());

        windows
            .iter()
            .filter(|(_, state)| state.idle)
            .map(|(label, _)| label.clone())
            .collect()
    }

    fn forget_window(&self, window_label: &str) {
        let mut windows = self
            .windows
            .lock()
            .unwrap_or_else(|error| error.into_inner());

        windows.remove(window_label);
    }

    fn next_popup_label(&self) -> String {
        let number = self.popups.fetch_add(1, Ordering::Relaxed) + 1;

        format!("{POPUP_LABEL_PREFIX}{number}")
    }

    /// The bridge itself, which only Rust can write because only Rust knows how
    /// to reach Tauri's IPC.
    ///
    /// It is the one thing a guest is allowed to call — see
    /// capabilities/guest.json — and it carries a string, exactly as the
    /// `window.chrome.webview` object WebView2 handed the WinForms build did.
    /// The name it takes is generated per run, so a site cannot recognise the
    /// app by a global it always defines.
    fn bridge_script(&self) -> String {
        let key = serde_json::to_string(&self.globals.bridge_key).unwrap_or_default();

        format!(
            r#"
;(function () {{
  var key = {key};

  if (window[key]) {{
    return;
  }}

  Object.defineProperty(window, key, {{
    value: Object.freeze({{
      postMessage: function (message) {{
        window.__TAURI_INTERNALS__
          .invoke('guest_message', {{ message: String(message) }})
          .catch(function () {{}});
      }}
    }}),
    // Not enumerable, so the app does not announce itself to every site that
    // walks `window`.
    enumerable: false,
    configurable: false,
    writable: false
  }});
}})();
"#
        )
    }

    fn initialization_script(&self, scripts: &[String]) -> String {
        std::iter::once(self.bridge_script())
            .chain(scripts.iter().cloned())
            .collect::<Vec<_>>()
            .join("\n")
    }
}

/// Not a secret, so a plain random name is enough: it only has to be
/// unguessable ahead of time and different between runs.
fn random_global_name() -> String {
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();

    let tail: String = (0..8)
        .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
        .collect();

    format!("_{tail}")
}

/// The app's data folder holds the shared browser profile.
pub fn profile_directory<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    app.path()
        .app_local_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(PROFILE_DIRECTORY)
}

fn webview_of<R: Runtime>(
    app: &AppHandle<R>,
    window_label: &str,
    website_id: &str,
) -> Result<Webview<R>, String> {
    app.get_webview(&guest_label(window_label, website_id))
        .ok_or_else(|| format!("No embedded browser is open for \"{website_id}\"."))
}

#[tauri::command]
pub fn get_guest_config(host: State<'_, GuestHost>) -> GuestGlobals {
    host.globals.clone()
}

/// Brings the calling window's guests in line with `panes`.
///
/// One list rather than one change at a time: opening a site, closing one and
/// dragging a divider are the same layout pass in the window above, and
/// reconciling from a complete picture is what keeps them from racing.
///
/// The window is taken from the call rather than looked up by name, so a
/// second window lays out its own row and leaves the first one's alone.
#[tauri::command]
pub async fn guest_sync(
    app: AppHandle,
    window: Window,
    host: State<'_, GuestHost>,
    panes: Vec<GuestPane>,
) -> Result<(), String> {
    let window_label = window.label().to_string();

    if !is_main_window_label(&window_label) {
        return Err("Only a main window may lay out the embedded browsers.".into());
    }

    // One layout pass at a time, app-wide: see `GuestHost::reconcile`.
    let _pass = host
        .reconcile
        .lock()
        .unwrap_or_else(|error| error.into_inner());

    let wanted: HashSet<String> = panes
        .iter()
        .map(|pane| guest_label(&window_label, &pane.website_id))
        .collect();

    // Whether a browser has been opened or closed, which is the only thing
    // that can change what the memory budgets should be.
    let mut opened_or_closed = false;

    // A site switched off, or dropped from the catalogue, closes its browser
    // with it — this window's browser for it, and no other window's.
    for (label, webview) in app.webviews() {
        if !is_guest_of(&label, &window_label) || wanted.contains(&label) {
            continue;
        }

        if let Some((_, website_id)) = split_guest_label(&label) {
            host.forget_scripts(&window_label, website_id);
        }

        match webview.close() {
            Ok(()) => opened_or_closed = true,
            Err(error) => eprintln!("Failed to close the browser for \"{label}\": {error}"),
        }
    }

    let visible = host.is_visible(&window_label);

    for pane in &panes {
        let label = guest_label(&window_label, &pane.website_id);
        let position = LogicalPosition::new(pane.bounds.x, pane.bounds.y);
        let size = LogicalSize::new(pane.bounds.width.max(1.0), pane.bounds.height.max(1.0));

        let scripts = host.remember_scripts(&window_label, pane);

        if let Some(webview) = app.get_webview(&label) {
            webview.set_position(position).map_err(stringify)?;
            webview.set_size(size).map_err(stringify)?;
            continue;
        }

        let url = Url::parse(&pane.url)
            .map_err(|error| format!("\"{}\" is not a URL: {error}", pane.url))?;

        let mut builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
            .initialization_script(host.initialization_script(&scripts))
            // One profile for every pane of every window, so a sign-in done in
            // one is a sign-in in all of them.
            .data_directory(host.profile_directory.clone())
            .zoom_hotkeys_enabled(true);

        if let Some(user_agent) = &host.user_agent {
            builder = builder.user_agent(user_agent);
        }

        #[cfg(windows)]
        {
            let browser_arguments = browser_args(&app);
            builder = builder.additional_browser_args(&browser_arguments);
        }

        let webview = window
            .add_child(builder, position, size)
            .map_err(stringify)?;

        if !visible {
            let _ = webview.hide();
        }

        opened_or_closed = true;
    }

    // A site switched on while its window sits in the background should not be
    // the one guest running on the full budget, and a site closed here may have
    // been the last one anybody was still reading.
    if opened_or_closed {
        apply_memory_targets(&app);
    }

    Ok(())
}

/// Hides or shows the calling window's guests at once.
///
/// A child webview is drawn over the window, so while one is up the page under
/// it gets neither the pointer nor the pixels. Dragging a divider needs the
/// first and a popover needs the second, so the window asks its browsers to
/// step aside and puts them back afterwards — which is what the Electron port
/// did with a `pointer-events: none` it could set itself.
#[tauri::command]
pub async fn guest_set_visible(
    app: AppHandle,
    window: Window,
    host: State<'_, GuestHost>,
    visible: bool,
) -> Result<(), String> {
    let window_label = window.label().to_string();

    host.set_visible(&window_label, visible);

    for (label, webview) in app.webviews() {
        if !is_guest_of(&label, &window_label) {
            continue;
        }

        let result = if visible {
            webview.show()
        } else {
            webview.hide()
        };

        if let Err(error) = result {
            eprintln!("Failed to change \"{label}\" visibility: {error}");
        }
    }

    Ok(())
}

/// Puts one browser on the small-memory budget, or takes it off again.
///
/// WebView2 answers this directly: `MemoryUsageTargetLevel` is the knob an app
/// is meant to turn when it knows a webview is not being looked at, and the
/// browser spends it on the caches a renderer can rebuild — decoded images,
/// rasterised tiles, compiled code. It is not a suspend: timers keep running
/// and a reply that is still streaming in keeps arriving, which is the whole
/// reason it is this rather than `TrySuspend`.
///
/// Nothing here can fail in a way worth reporting — an older WebView2 runtime
/// simply does not offer the interface, and the app is no worse off than it
/// was — so every step is best-effort.
#[cfg(windows)]
fn set_webview_memory_target<R: Runtime>(webview: &Webview<R>, idle: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows_core::Interface;

    let level = if idle {
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
    } else {
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
    };

    let _ = webview.with_webview(move |platform| unsafe {
        let Ok(core) = platform.controller().CoreWebView2() else {
            return;
        };

        let Ok(core) = core.cast::<ICoreWebView2_19>() else {
            return;
        };

        let _ = core.SetMemoryUsageTargetLevel(level);
    });
}

/// Only WebView2 has a budget to set; WebKit manages its own.
#[cfg(not(windows))]
fn set_webview_memory_target<R: Runtime>(_webview: &Webview<R>, _idle: bool) {}

/// The sites nobody is looking at, given which windows are idle.
///
/// Per site rather than per pane, because `--process-per-site` is the reason a
/// second window is cheap: two windows showing the same chat site share one
/// renderer. A budget set on one of those panes therefore lands on the process
/// the other is drawn from too, so a site only goes on the small budget once
/// every window holding it has gone idle. Without that, minimising one window
/// would throw away the caches of the one still being read.
fn idle_sites<'a>(
    labels: impl Iterator<Item = &'a str>,
    idle_windows: &HashSet<String>,
) -> HashSet<&'a str> {
    let mut idle: HashSet<&str> = HashSet::new();
    let mut busy: HashSet<&str> = HashSet::new();

    for label in labels {
        let Some((window, website_id)) = split_guest_label(label) else {
            continue;
        };

        if idle_windows.contains(window) {
            idle.insert(website_id);
        } else {
            busy.insert(website_id);
        }
    }

    idle.retain(|website_id| !busy.contains(website_id));
    idle
}

/// Brings every open browser's memory budget in line with which windows are
/// idle.
///
/// Called only when the answer can have changed — a focus change, a minimise,
/// a browser opened or closed — because each change of level costs the
/// renderers the caches they then have to rebuild, and because reaching into
/// a webview is a hop onto the main thread.
fn apply_memory_targets<R: Runtime>(app: &AppHandle<R>) {
    let memory_policy = app.state::<MemoryTargetPolicy>().current();
    let idle_windows = app.state::<GuestHost>().idle_windows();

    let guests: Vec<(String, Webview<R>)> = app
        .webviews()
        .into_iter()
        .filter(|(label, _)| is_guest_label(label))
        .collect();

    let idle = idle_sites(
        guests.iter().map(|(label, _)| label.as_str()),
        &idle_windows,
    );

    for (label, webview) in &guests {
        let Some((_, website_id)) = split_guest_label(label) else {
            continue;
        };

        set_webview_memory_target(
            webview,
            memory_policy.trim_inactive_webviews && idle.contains(website_id),
        );
    }
}

fn set_idle<R: Runtime>(app: &AppHandle<R>, window_label: &str, idle: bool) {
    if !app.state::<GuestHost>().set_idle(window_label, idle) {
        return;
    }

    apply_memory_targets(app);
}

/// Updates existing WebView2 targets after a live memory setting has changed.
pub(crate) fn on_memory_settings_changed<R: Runtime>(app: &AppHandle<R>, settings: &Value) {
    if app
        .state::<MemoryTargetPolicy>()
        .replace(MemoryTargetSettings::from_settings(settings))
    {
        apply_memory_targets(app);
    }
}

/// A main window gained or lost the user's attention.
///
/// Losing it waits: alt-tabbing out and straight back is not a reason to throw
/// away three renderers' caches, so the budget only drops if the window is
/// still in the background after its configured delay. Gaining it does not wait,
/// because the first thing that happens next is the user reading a pane.
pub fn on_window_focus<R: Runtime>(app: &AppHandle<R>, window_label: &str, focused: bool) {
    let generation = app.state::<GuestHost>().bump_idle_generation(window_label);

    if focused {
        set_idle(app, window_label, false);
        return;
    }

    let idle_memory_trim_delay = app
        .state::<MemoryTargetPolicy>()
        .current()
        .idle_memory_trim_delay;

    let app = app.clone();
    let window_label = window_label.to_string();

    std::thread::spawn(move || {
        std::thread::sleep(idle_memory_trim_delay);

        // A focus change since this timer started has already decided the
        // question, and may have decided it the other way; a window that has
        // closed since has no question left to decide.
        if app.state::<GuestHost>().idle_generation(&window_label) == Some(generation) {
            set_idle(&app, &window_label, true);
        }
    });
}

/// A minimised window is not being read by anyone, so its browsers go on the
/// small budget at once rather than waiting out the configured idle delay.
pub fn on_window_resized<R: Runtime>(app: &AppHandle<R>, window_label: &str, minimized: bool) {
    if minimized {
        app.state::<GuestHost>().bump_idle_generation(window_label);

        set_idle(app, window_label, true);
    }
}

/// A main window has gone, and with it everything the app remembered about its
/// row. Its browsers went with it too, so whatever they were the last window
/// reading may now be idle everywhere else.
pub fn on_window_closed<R: Runtime>(app: &AppHandle<R>, window_label: &str) {
    app.state::<GuestHost>().forget_window(window_label);

    apply_memory_targets(app);
}

/// Port of `WebViewManager.Reload`: back to the site's configured URL.
#[tauri::command]
pub async fn guest_navigate(
    app: AppHandle,
    window: Window,
    website_id: String,
    url: String,
) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|error| format!("\"{url}\" is not a URL: {error}"))?;

    webview_of(&app, window.label(), &website_id)?
        .navigate(parsed)
        .map_err(stringify)
}

#[tauri::command]
pub async fn guest_reload(
    app: AppHandle,
    window: Window,
    website_id: String,
) -> Result<(), String> {
    webview_of(&app, window.label(), &website_id)?
        .reload()
        .map_err(stringify)
}

/// Runs a script in one guest — the prompt runner, or a right-click action.
#[tauri::command]
pub async fn guest_eval(
    app: AppHandle,
    window: Window,
    website_id: String,
    script: String,
) -> Result<(), String> {
    webview_of(&app, window.label(), &website_id)?
        .eval(&script)
        .map_err(stringify)
}

#[tauri::command]
pub async fn guest_url(
    app: AppHandle,
    window: Window,
    website_id: String,
) -> Result<String, String> {
    webview_of(&app, window.label(), &website_id)?
        .url()
        .map(|url| url.to_string())
        .map_err(stringify)
}

/// Every cookie in the shared profile.
///
/// `async` is not a style choice: reading cookies from a synchronous command
/// deadlocks on Windows, which is the platform whose webview has them.
#[tauri::command]
pub async fn guest_cookies(
    app: AppHandle,
    window: Window,
    website_id: String,
) -> Result<Vec<GuestCookie>, String> {
    let cookies = webview_of(&app, window.label(), &website_id)?
        .cookies()
        .map_err(stringify)?;

    Ok(cookies
        .into_iter()
        .map(|cookie| GuestCookie {
            name: cookie.name().to_string(),
            value: cookie.value().to_string(),
            domain: cookie.domain().unwrap_or_default().to_string(),
            path: cookie.path().unwrap_or("/").to_string(),
            secure: cookie.secure().unwrap_or(false),
        })
        .collect())
}

/// Deletes the named cookies, one at a time.
///
/// Each is named through a URL it would have been sent to, which is what
/// `cookieRemovalUrl` works out and what carries the two things the cookie
/// store needs to find it again: the path it is scoped to, and whether it is
/// `Secure`. A cookie refusing to go is not a reason to leave the rest.
///
/// The profile is shared, so this signs the site out of every window at once —
/// which is what clearing a site's cookies has always meant here.
#[tauri::command]
pub async fn guest_delete_cookies(
    app: AppHandle,
    window: Window,
    website_id: String,
    cookies: Vec<GuestCookieRemoval>,
) -> Result<(), String> {
    let webview = webview_of(&app, window.label(), &website_id)?;

    for entry in cookies {
        let Ok(url) = Url::parse(&entry.url) else {
            continue;
        };

        let mut cookie = Cookie::new(entry.name.clone(), "");
        cookie.set_domain(url.host_str().unwrap_or_default().to_string());
        cookie.set_path(url.path().to_string());
        cookie.set_secure(url.scheme() == "https");

        if let Err(error) = webview.delete_cookie(cookie) {
            eprintln!("Failed to clear the cookie \"{}\": {error}", entry.name);
        }
    }

    Ok(())
}

/// Opens the guest's own DevTools, which is what `Inspect Element` is for. The
/// `devtools` feature is on for release builds too, because an embedded site
/// misbehaving is exactly what it is for.
#[tauri::command]
pub async fn guest_open_devtools(
    app: AppHandle,
    window: Window,
    website_id: String,
) -> Result<(), String> {
    webview_of(&app, window.label(), &website_id)?.open_devtools();

    Ok(())
}

/// Opens the in-app window a guest asked for — a sign-in flow, a citation, any
/// `window.open` or `target="_blank"` a site hands over.
///
/// It shares the profile, so the session a sign-in authorises is the one every
/// pane in every window is signed in to, which is the whole reason none of
/// this is handed to the system browser. It gets no capability of its own, so
/// the page in it can call nothing; `scripts` are therefore whatever the
/// window wants the page to do for itself, with no bridge in front of them.
#[tauri::command]
pub async fn guest_open_popup(
    app: AppHandle,
    host: State<'_, GuestHost>,
    url: String,
    scripts: Vec<String>,
) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|error| format!("\"{url}\" is not a URL: {error}"))?;

    let label = host.next_popup_label();

    let mut builder = tauri::WebviewWindowBuilder::new(&app, label, WebviewUrl::External(parsed))
        .title("Multi Mind")
        .inner_size(600.0, 720.0)
        .data_directory(host.profile_directory.clone())
        .zoom_hotkeys_enabled(true)
        .center();

    if !scripts.is_empty() {
        builder = builder.initialization_script(scripts.join(
            "
",
        ));
    }

    if let Some(user_agent) = &host.user_agent {
        builder = builder.user_agent(user_agent);
    }

    // The sign-in window is on `browser-profile` with the panes, so WebView2
    // will only build it if it asks for the same arguments they did.
    #[cfg(windows)]
    {
        let browser_arguments = browser_args(&app);
        builder = builder.additional_browser_args(&browser_arguments);
    }

    builder.build().map_err(stringify)?;

    Ok(())
}

/// A message from an embedded site, on its way to the window it sits in.
///
/// The site it came from is taken from the webview that called, never from the
/// payload: this is the one command a remote page can reach, and a page that
/// could name another pane could set off actions in it. The same label says
/// which window to answer in, so a click in one window's pane never reaches
/// another's.
#[tauri::command]
pub fn guest_message(app: AppHandle, webview: Webview, message: String) -> Result<(), String> {
    let Some((window_label, website_id)) = split_guest_label(webview.label()) else {
        return Err("Only an embedded browser may send a guest message.".into());
    };

    app.emit_to(
        window_label,
        GUEST_MESSAGE_EVENT,
        GuestMessagePayload {
            website_id: website_id.to_string(),
            message,
        },
    )
    .map_err(stringify)
}

/// Command results cross the bridge as strings, and a Tauri error is not one.
fn stringify(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_label_names_the_window_and_then_the_site() {
        assert_eq!(guest_label("main", "claude"), "chat-main:claude");
        assert_eq!(guest_label("main-2", "claude"), "chat-main-2:claude");

        assert_eq!(
            split_guest_label("chat-main:claude"),
            Some(("main", "claude"))
        );
        assert_eq!(
            split_guest_label("chat-main-2:claude"),
            Some(("main-2", "claude"))
        );
        assert_eq!(split_guest_label("main"), None);
        assert_eq!(split_guest_label("popup-1"), None);
    }

    /*
     * A window label may hold a hyphen and a site id may hold anything, so the
     * split has to be on the first separator and the separator has to be one
     * neither half uses.
     */
    #[test]
    fn a_site_id_may_hold_a_hyphen() {
        let label = guest_label("main-2", "my-own-site");

        assert_eq!(split_guest_label(&label), Some(("main-2", "my-own-site")));
    }

    #[test]
    fn a_guest_belongs_to_one_window() {
        assert!(is_guest_of("chat-main:claude", "main"));
        assert!(!is_guest_of("chat-main-2:claude", "main"));
        assert!(is_guest_of("chat-main-2:claude", "main-2"));
        assert!(!is_guest_of("main", "main"));
    }

    #[test]
    fn only_a_browser_label_counts_as_a_guest() {
        assert!(is_guest_label("chat-main:claude"));
        assert!(!is_guest_label("main"));
        assert!(!is_guest_label("main-2"));
        assert!(!is_guest_label("settings"));
    }

    #[test]
    fn every_copy_of_the_window_counts_as_a_main_window() {
        assert!(is_main_window_label("main"));
        assert!(is_main_window_label("main-2"));
        assert!(is_main_window_label("main-17"));
        assert!(!is_main_window_label("settings"));
        assert!(!is_main_window_label("popup-1"));
        assert!(!is_main_window_label("chat-main:claude"));
    }

    /*
     * The names land on the embedded page's own `window`. A constant would let
     * any site recognise the app, and block it by name.
     */
    #[test]
    fn names_the_globals_differently_on_every_run() {
        let first = random_global_name();
        let second = random_global_name();

        assert_ne!(first, second);
        assert!(first.starts_with('_'));
        assert!(!first.to_lowercase().contains("mind"));
    }

    #[test]
    fn the_bridge_is_defined_under_the_generated_name() {
        let host = GuestHost::new(PathBuf::from("."));
        let script = host.bridge_script();

        assert!(script.contains(&format!("\"{}\"", host.globals.bridge_key)));
        assert!(script.contains("guest_message"));
    }

    #[test]
    fn the_bridge_goes_in_before_the_scripts_that_use_it() {
        let host = GuestHost::new(PathBuf::from("."));
        let pane = pane_of("claude");

        let script = host.initialization_script(&host.remember_scripts("main", &pane));
        let bridge_at = script.find("guest_message").expect("bridge");
        let reporter_at = script.find("/* reporter */").expect("reporter");

        assert!(bridge_at < reporter_at);
    }

    #[test]
    fn a_pane_only_has_to_send_its_scripts_once() {
        let host = GuestHost::new(PathBuf::from("."));
        let mut pane = pane_of("claude");

        assert_eq!(host.remember_scripts("main", &pane), vec!["/* reporter */"]);

        // What the window sends on every frame of a divider drag.
        pane.scripts = Vec::new();
        assert_eq!(host.remember_scripts("main", &pane), vec!["/* reporter */"]);

        // Switching the site off has to take the memory of it too, so the one
        // switched on afterwards is built from what the window sends then.
        host.forget_scripts("main", "claude");
        assert!(host.remember_scripts("main", &pane).is_empty());
    }

    /*
     * Each window sends its own scripts for the sites it opens, so one window
     * closing a site must not leave another's browser unbuildable.
     */
    #[test]
    fn one_window_forgetting_a_site_leaves_the_others_alone() {
        let host = GuestHost::new(PathBuf::from("."));
        let mut pane = pane_of("claude");

        host.remember_scripts("main", &pane);
        host.remember_scripts("main-2", &pane);
        host.forget_scripts("main", "claude");

        pane.scripts = Vec::new();
        assert!(host.remember_scripts("main", &pane).is_empty());
        assert_eq!(
            host.remember_scripts("main-2", &pane),
            vec!["/* reporter */"]
        );
    }

    #[test]
    fn a_window_starts_visible_and_busy() {
        let host = GuestHost::new(PathBuf::from("."));

        assert!(host.is_visible("main-2"));
        assert!(host.idle_windows().is_empty());
    }

    #[test]
    fn hiding_one_windows_guests_leaves_the_others_showing() {
        let host = GuestHost::new(PathBuf::from("."));

        host.set_visible("main", false);

        assert!(!host.is_visible("main"));
        assert!(host.is_visible("main-2"));
    }

    #[test]
    fn idle_is_only_reported_when_it_changes() {
        let host = GuestHost::new(PathBuf::from("."));

        assert!(host.set_idle("main", true));
        assert!(!host.set_idle("main", true));
        assert!(host.set_idle("main", false));
    }

    /*
     * A timer started before the window closed must not put a budget on a row
     * that is gone -- nor quietly bring the window's state back to life.
     */
    #[test]
    fn a_closed_window_has_no_generation_left() {
        let host = GuestHost::new(PathBuf::from("."));

        let generation = host.bump_idle_generation("main-2");
        assert_eq!(host.idle_generation("main-2"), Some(generation));

        host.forget_window("main-2");
        assert_eq!(host.idle_generation("main-2"), None);
    }

    #[test]
    fn a_sign_in_window_is_numbered_rather_than_counted() {
        let host = GuestHost::new(PathBuf::from("."));

        assert_eq!(host.next_popup_label(), "popup-1");
        assert_eq!(host.next_popup_label(), "popup-2");
    }

    /*
     * --process-per-site puts the same site in one renderer however many
     * windows show it, so the small budget only applies once nobody is reading
     * it anywhere.
     */
    #[test]
    fn a_site_open_in_a_window_being_read_stays_on_the_full_budget() {
        let idle_windows: HashSet<String> = ["main-2".to_string()].into_iter().collect();

        let labels = [
            "chat-main:claude",
            "chat-main-2:claude",
            "chat-main-2:chatgpt",
        ];

        let idle = idle_sites(labels.iter().copied(), &idle_windows);

        assert!(!idle.contains("claude"));
        assert!(idle.contains("chatgpt"));
    }

    #[test]
    fn every_site_of_an_idle_window_is_idle_when_it_is_the_only_one() {
        let idle_windows: HashSet<String> = ["main".to_string()].into_iter().collect();

        let idle = idle_sites(["chat-main:claude"].into_iter(), &idle_windows);

        assert!(idle.contains("claude"));
    }

    #[test]
    fn memory_target_settings_keep_the_current_defaults() {
        let settings = MemoryTargetSettings::from_settings(&serde_json::json!({}));

        assert!(settings.trim_inactive_webviews);
        assert_eq!(
            settings.idle_memory_trim_delay,
            Duration::from_secs(DEFAULT_IDLE_MEMORY_TRIM_DELAY_SECONDS)
        );
    }

    #[test]
    fn memory_target_settings_accept_only_the_delays_offered_in_settings() {
        let settings = MemoryTargetSettings::from_settings(&serde_json::json!({
            "trimInactiveWebviews": false,
            "idleMemoryTrimDelaySeconds": 30,
        }));
        let unsupported = MemoryTargetSettings::from_settings(&serde_json::json!({
            "idleMemoryTrimDelaySeconds": 15,
        }));

        assert!(!settings.trim_inactive_webviews);
        assert_eq!(settings.idle_memory_trim_delay, Duration::from_secs(30));
        assert_eq!(
            unsupported.idle_memory_trim_delay,
            Duration::from_secs(DEFAULT_IDLE_MEMORY_TRIM_DELAY_SECONDS)
        );
    }

    #[cfg(windows)]
    #[test]
    fn browser_memory_saving_choice_changes_only_the_next_launch_arguments() {
        assert_eq!(
            BrowserArguments::from_settings(&serde_json::json!({})).value(),
            BROWSER_ARGS
        );
        assert_eq!(
            BrowserArguments::from_settings(&serde_json::json!({ "browserMemorySaving": false }))
                .value(),
            STANDARD_BROWSER_ARGS
        );
    }

    #[cfg(windows)]
    #[test]
    fn every_browser_memory_flag_can_be_disabled_independently() {
        for (setting, argument) in [
            ("disableBackForwardCache", "BackForwardCache"),
            ("enableLowEndDeviceMode", "--enable-low-end-device-mode"),
            ("processPerSite", "--process-per-site"),
            ("optimizeForSize", "--js-flags=--optimize-for-size"),
        ] {
            let mut settings = serde_json::Map::new();
            settings.insert(setting.into(), Value::Bool(false));

            let arguments = BrowserArguments::from_settings(&Value::Object(settings)).value();

            assert!(
                !arguments.contains(argument),
                "{setting} should remove {argument}"
            );
            assert!(arguments.contains("msWebOOUI"));
        }
    }

    /*
     * Everything in BROWSER_ARGS is about memory. A switch that widens what a
     * renderer may reach -- or that lets two sites share one -- is not, and
     * the saving would never be worth it.
     */
    #[cfg(windows)]
    #[test]
    fn the_browser_arguments_leave_the_sandbox_alone() {
        for forbidden in [
            "--disable-site-isolation-trials",
            "--disable-web-security",
            "--no-sandbox",
            "--renderer-process-limit",
            "--single-process",
            "--allow-running-insecure-content",
        ] {
            assert!(
                !BROWSER_ARGS.contains(forbidden),
                "{forbidden} has no place in BROWSER_ARGS"
            );
        }

        // Overriding the argument string replaces wry's own default, so what
        // it turned off has to still be off.
        assert!(BROWSER_ARGS.contains("msWebOOUI"));
        assert!(BROWSER_ARGS.contains("msPdfOOUI"));

        // Chromium reads only the last --disable-features it is given, so
        // there may only ever be one.
        assert_eq!(BROWSER_ARGS.matches("--disable-features").count(), 1);
    }

    /*
     * A second window is only cheap because the same site lands in the same
     * renderer whichever window it is drawn in.
     */
    #[cfg(windows)]
    #[test]
    fn the_browser_arguments_share_a_renderer_between_windows() {
        assert!(BROWSER_ARGS.contains("--process-per-site"));
    }

    fn pane_of(website_id: &str) -> GuestPane {
        GuestPane {
            website_id: website_id.into(),
            url: "https://claude.ai/new".into(),
            bounds: GuestBounds {
                x: 0.0,
                y: 0.0,
                width: 100.0,
                height: 100.0,
            },
            scripts: vec!["/* reporter */".into()],
        }
    }
}
