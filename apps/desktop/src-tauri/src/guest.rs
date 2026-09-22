//! The embedded browsers.
//!
//! WebView2 gave the WinForms build a control it could dock like any other, and
//! Electron gave the port a `<webview>` element the page laid out itself. Tauri
//! has neither: a guest here is a child webview of the main window — the
//! `unstable` feature in Cargo.toml is what allows more than one — owned by
//! Rust, positioned in window coordinates and drawn over the page.
//!
//! So the main window still decides the layout, with the same flex row and the
//! same Split.js it always had, and sends the measurements down. Everything
//! else about a guest is decided in `@internal/multi-mind`: the scripts it
//! runs, the menu a right-click on it offers, which of its cookies belong to
//! the site. This file carries those across and nothing more.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use rand::Rng;
use serde::{Deserialize, Serialize};
use tauri::webview::{Cookie, Webview, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, State, WebviewUrl,
};
use url::Url;

use crate::identity;

/// The window the browsers are children of.
pub const MAIN_WINDOW_LABEL: &str = "main";

/// Label prefix every guest takes, which is what capabilities/guest.json
/// matches on. Nothing else in the app may be labelled this way.
const GUEST_LABEL_PREFIX: &str = "chat-";

/// Prefix for the in-app window a sign-in flow asks for.
const POPUP_LABEL_PREFIX: &str = "popup-";

/// Folder all the browsers share, mirroring the single WebView2 user-data
/// folder the WinForms build gave every control and the `persist:multi-mind`
/// partition the Electron port used. One profile is what lets a sign-in done in
/// one pane be a sign-in everywhere, and what makes clearing cookies a
/// per-site job rather than a per-pane one.
const PROFILE_DIRECTORY: &str = "browser-profile";

/// Event a guest's message is re-broadcast on, for the main window to answer.
const GUEST_MESSAGE_EVENT: &str = "multi-mind://guest-message";

/// How long the window has to stay unfocused before the browsers are asked to
/// trim. Short enough that a window left behind stops holding the memory,
/// long enough that alt-tabbing back and forth does not churn their caches.
const IDLE_DELAY: Duration = Duration::from_secs(10);

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
/// the default folder, and keeping all four on one string is what makes that
/// impossible to get wrong. `tauri.conf.json` repeats it for the main window,
/// which is built from the config rather than from here — the test at the
/// bottom of this file is what keeps the two copies the same.
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
///   iframes, into one renderer. Different sites stay in different processes:
///   this is process reuse *within* an origin, not across.
/// - `--optimize-for-size` is V8 choosing memory over speed.
pub const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,BackForwardCache --enable-low-end-device-mode --process-per-site --js-flags=--optimize-for-size";

fn guest_label(website_id: &str) -> String {
    format!("{GUEST_LABEL_PREFIX}{website_id}")
}

fn website_id_of(label: &str) -> Option<&str> {
    label.strip_prefix(GUEST_LABEL_PREFIX)
}

/// The webviews that are browsers, which is what a sweep over the window's own
/// has to be able to tell: the main page is one of them, and so is a sign-in
/// window that happens to be open.
fn is_guest_label(label: &str) -> bool {
    label.starts_with(GUEST_LABEL_PREFIX)
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

pub struct GuestHost {
    globals: GuestGlobals,
    profile_directory: PathBuf,
    user_agent: Option<String>,
    /// False while a divider is being dragged or a popover is open, because a
    /// child webview takes both the pointer and the pixels from the page.
    visible: AtomicBool,
    /// The scripts each open guest was built with, keyed by site id.
    ///
    /// A layout pass is a whole list of panes, and the window sends one on
    /// every frame of a divider drag. Carrying every guest's scripts in each of
    /// those means serialising, shipping and re-allocating tens of kilobytes
    /// sixty times a second for strings that are only ever read when a webview
    /// is first built. So the window sends them once, for a pane it has not
    /// opened yet, and they are kept here for the rebuild that a site switched
    /// off and on again asks for.
    scripts: Mutex<HashMap<String, Vec<String>>>,
    /// Whether the browsers have been put on their small-memory budget.
    idle: AtomicBool,
    /// Bumped by every focus change, so the timer one of them starts can tell
    /// that another has overtaken it.
    idle_generation: AtomicU64,
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
            visible: AtomicBool::new(true),
            scripts: Mutex::new(HashMap::new()),
            idle: AtomicBool::new(false),
            idle_generation: AtomicU64::new(0),
        }
    }

    /// Remembers what a pane was sent, and answers with what its webview should
    /// be built from — which is whatever was last sent for that site.
    fn remember_scripts(&self, pane: &GuestPane) -> Vec<String> {
        let mut cache = self
            .scripts
            .lock()
            .unwrap_or_else(|error| error.into_inner());

        if !pane.scripts.is_empty() {
            cache.insert(pane.website_id.clone(), pane.scripts.clone());
        }

        cache.get(&pane.website_id).cloned().unwrap_or_default()
    }

    /// Drops what is remembered for a site whose browser has been closed, so a
    /// later one is built from scripts the window has sent since.
    fn forget_scripts(&self, website_id: &str) {
        let mut cache = self
            .scripts
            .lock()
            .unwrap_or_else(|error| error.into_inner());

        cache.remove(website_id);
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

fn webview_of<R: Runtime>(app: &AppHandle<R>, website_id: &str) -> Result<Webview<R>, String> {
    app.get_webview(&guest_label(website_id))
        .ok_or_else(|| format!("No embedded browser is open for \"{website_id}\"."))
}

#[tauri::command]
pub fn get_guest_config(host: State<'_, GuestHost>) -> GuestGlobals {
    host.globals.clone()
}

/// Brings the open guests in line with `panes`.
///
/// One list rather than one change at a time: opening a site, closing one and
/// dragging a divider are the same layout pass in the window above, and
/// reconciling from a complete picture is what keeps them from racing.
#[tauri::command]
pub async fn guest_sync(
    app: AppHandle,
    host: State<'_, GuestHost>,
    panes: Vec<GuestPane>,
) -> Result<(), String> {
    let window = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or("The main window is not open.")?;

    let wanted: HashSet<String> = panes
        .iter()
        .map(|pane| guest_label(&pane.website_id))
        .collect();

    // A site switched off, or dropped from the catalogue, closes its browser
    // with it.
    for (label, webview) in app.webviews() {
        if is_guest_label(&label) && !wanted.contains(&label) {
            if let Some(website_id) = website_id_of(&label) {
                host.forget_scripts(website_id);
            }

            if let Err(error) = webview.close() {
                eprintln!("Failed to close the browser for \"{label}\": {error}");
            }
        }
    }

    let visible = host.visible.load(Ordering::Relaxed);

    for pane in &panes {
        let label = guest_label(&pane.website_id);
        let position = LogicalPosition::new(pane.bounds.x, pane.bounds.y);
        let size = LogicalSize::new(pane.bounds.width.max(1.0), pane.bounds.height.max(1.0));

        let scripts = host.remember_scripts(pane);

        if let Some(webview) = app.get_webview(&label) {
            webview.set_position(position).map_err(stringify)?;
            webview.set_size(size).map_err(stringify)?;
            continue;
        }

        let url = Url::parse(&pane.url)
            .map_err(|error| format!("\"{}\" is not a URL: {error}", pane.url))?;

        let mut builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
            .initialization_script(host.initialization_script(&scripts))
            // One profile for every pane, so a sign-in done in one is a
            // sign-in in all of them.
            .data_directory(host.profile_directory.clone())
            .zoom_hotkeys_enabled(true);

        if let Some(user_agent) = &host.user_agent {
            builder = builder.user_agent(user_agent);
        }

        #[cfg(windows)]
        {
            builder = builder.additional_browser_args(BROWSER_ARGS);
        }

        let webview = window
            .add_child(builder, position, size)
            .map_err(stringify)?;

        if !visible {
            let _ = webview.hide();
        }

        // A site switched on while the window sits in the background should
        // not be the one guest running on the full budget.
        set_webview_memory_target(&webview, host.idle.load(Ordering::Relaxed));
    }

    Ok(())
}

/// Hides or shows every open guest at once.
///
/// A child webview is drawn over the window, so while one is up the page under
/// it gets neither the pointer nor the pixels. Dragging a divider needs the
/// first and a popover needs the second, so the main window asks the browsers
/// to step aside and puts them back afterwards — which is what the Electron
/// port did with a `pointer-events: none` it could set itself.
#[tauri::command]
pub async fn guest_set_visible(
    app: AppHandle,
    host: State<'_, GuestHost>,
    visible: bool,
) -> Result<(), String> {
    host.visible.store(visible, Ordering::Relaxed);

    for (label, webview) in app.webviews() {
        if !is_guest_label(&label) {
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

/// Puts every open browser on the small-memory budget, or takes them all off.
///
/// Guarded on the flag rather than applied every time, because the events that
/// call this — a focus change, a resize — arrive in bursts, and each change of
/// level costs the renderers the caches they then have to rebuild.
fn set_idle<R: Runtime>(app: &AppHandle<R>, idle: bool) {
    let host = app.state::<GuestHost>();

    if host.idle.swap(idle, Ordering::Relaxed) == idle {
        return;
    }

    for (label, webview) in app.webviews() {
        if is_guest_label(&label) {
            set_webview_memory_target(&webview, idle);
        }
    }
}

/// The main window gained or lost the user's attention.
///
/// Losing it waits: alt-tabbing out and straight back is not a reason to throw
/// away three renderers' caches, so the budget only drops if the window is
/// still in the background [`IDLE_DELAY`] later. Gaining it does not wait,
/// because the first thing that happens next is the user reading a pane.
pub fn on_window_focus<R: Runtime>(app: &AppHandle<R>, focused: bool) {
    let generation = app
        .state::<GuestHost>()
        .idle_generation
        .fetch_add(1, Ordering::Relaxed)
        + 1;

    if focused {
        set_idle(app, false);
        return;
    }

    let app = app.clone();

    std::thread::spawn(move || {
        std::thread::sleep(IDLE_DELAY);

        // A focus change since this timer started has already decided the
        // question, and may have decided it the other way.
        if app
            .state::<GuestHost>()
            .idle_generation
            .load(Ordering::Relaxed)
            == generation
        {
            set_idle(&app, true);
        }
    });
}

/// A minimised window is not being read by anyone, so its browsers go on the
/// small budget at once rather than waiting out [`IDLE_DELAY`].
pub fn on_window_resized<R: Runtime>(app: &AppHandle<R>, minimized: bool) {
    if minimized {
        app.state::<GuestHost>()
            .idle_generation
            .fetch_add(1, Ordering::Relaxed);

        set_idle(app, true);
    }
}

/// Port of `WebViewManager.Reload`: back to the site's configured URL.
#[tauri::command]
pub async fn guest_navigate(app: AppHandle, website_id: String, url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|error| format!("\"{url}\" is not a URL: {error}"))?;

    webview_of(&app, &website_id)?
        .navigate(parsed)
        .map_err(stringify)
}

#[tauri::command]
pub async fn guest_reload(app: AppHandle, website_id: String) -> Result<(), String> {
    webview_of(&app, &website_id)?.reload().map_err(stringify)
}

/// Runs a script in one guest — the prompt runner, or a right-click action.
#[tauri::command]
pub async fn guest_eval(app: AppHandle, website_id: String, script: String) -> Result<(), String> {
    webview_of(&app, &website_id)?
        .eval(&script)
        .map_err(stringify)
}

#[tauri::command]
pub async fn guest_url(app: AppHandle, website_id: String) -> Result<String, String> {
    webview_of(&app, &website_id)?
        .url()
        .map(|url| url.to_string())
        .map_err(stringify)
}

/// Every cookie in the shared profile.
///
/// `async` is not a style choice: reading cookies from a synchronous command
/// deadlocks on Windows, which is the platform whose webview has them.
#[tauri::command]
pub async fn guest_cookies(app: AppHandle, website_id: String) -> Result<Vec<GuestCookie>, String> {
    let cookies = webview_of(&app, &website_id)?
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
#[tauri::command]
pub async fn guest_delete_cookies(
    app: AppHandle,
    website_id: String,
    cookies: Vec<GuestCookieRemoval>,
) -> Result<(), String> {
    let webview = webview_of(&app, &website_id)?;

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
pub async fn guest_open_devtools(app: AppHandle, website_id: String) -> Result<(), String> {
    webview_of(&app, &website_id)?.open_devtools();

    Ok(())
}

/// Opens the in-app window a sign-in flow asks for.
///
/// It shares the profile, so the session it authorises is the one the panes are
/// signed in to — which is the whole reason it is not simply handed to the
/// system browser. It gets no capability of its own, so the page in it can call
/// nothing.
#[tauri::command]
pub async fn guest_open_popup(
    app: AppHandle,
    host: State<'_, GuestHost>,
    url: String,
) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|error| format!("\"{url}\" is not a URL: {error}"))?;

    // Labels only have to be unique among the windows that are open, and a
    // sign-in window is closed before the next one is asked for.
    let label = format!(
        "{POPUP_LABEL_PREFIX}{}",
        app.webview_windows()
            .keys()
            .filter(|key| key.starts_with(POPUP_LABEL_PREFIX))
            .count()
            + 1
    );

    let mut builder = tauri::WebviewWindowBuilder::new(&app, label, WebviewUrl::External(parsed))
        .title("Multi Mind")
        .inner_size(600.0, 720.0)
        .data_directory(host.profile_directory.clone())
        .center();

    if let Some(user_agent) = &host.user_agent {
        builder = builder.user_agent(user_agent);
    }

    // The sign-in window is on `browser-profile` with the panes, so WebView2
    // will only build it if it asks for the same arguments they did.
    #[cfg(windows)]
    {
        builder = builder.additional_browser_args(BROWSER_ARGS);
    }

    builder.build().map_err(stringify)?;

    Ok(())
}

/// A message from an embedded site, on its way to the main window.
///
/// The site it came from is taken from the webview that called, never from the
/// payload: this is the one command a remote page can reach, and a page that
/// could name another pane could set off actions in it.
#[tauri::command]
pub fn guest_message(app: AppHandle, webview: Webview, message: String) -> Result<(), String> {
    let Some(website_id) = website_id_of(webview.label()) else {
        return Err("Only an embedded browser may send a guest message.".into());
    };

    app.emit_to(
        MAIN_WINDOW_LABEL,
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
    fn a_label_is_the_site_id_behind_a_fixed_prefix() {
        assert_eq!(guest_label("claude"), "chat-claude");
        assert_eq!(website_id_of("chat-claude"), Some("claude"));
        assert_eq!(website_id_of("main"), None);
        assert_eq!(website_id_of("popup-1"), None);
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
        let pane = GuestPane {
            website_id: "claude".into(),
            url: "https://claude.ai/new".into(),
            bounds: GuestBounds {
                x: 0.0,
                y: 0.0,
                width: 100.0,
                height: 100.0,
            },
            scripts: vec!["/* reporter */".into()],
        };

        let script = host.initialization_script(&host.remember_scripts(&pane));
        let bridge_at = script.find("guest_message").expect("bridge");
        let reporter_at = script.find("/* reporter */").expect("reporter");

        assert!(bridge_at < reporter_at);
    }

    #[test]
    fn only_a_browser_label_counts_as_a_guest() {
        assert!(is_guest_label("chat-claude"));
        assert!(!is_guest_label("main"));
        assert!(!is_guest_label("settings"));
    }

    #[test]
    fn a_pane_only_has_to_send_its_scripts_once() {
        let host = GuestHost::new(PathBuf::from("."));
        let mut pane = GuestPane {
            website_id: "claude".into(),
            url: "https://claude.ai/new".into(),
            bounds: GuestBounds {
                x: 0.0,
                y: 0.0,
                width: 100.0,
                height: 100.0,
            },
            scripts: vec!["/* reporter */".into()],
        };

        assert_eq!(host.remember_scripts(&pane), vec!["/* reporter */"]);

        // What the window sends on every frame of a divider drag.
        pane.scripts = Vec::new();
        assert_eq!(host.remember_scripts(&pane), vec!["/* reporter */"]);

        // Switching the site off has to take the memory of it too, so the one
        // switched on afterwards is built from what the window sends then.
        host.forget_scripts("claude");
        assert!(host.remember_scripts(&pane).is_empty());
    }

    /*
     * WebView2 keys its browser process on the user-data folder together with
     * the arguments it was started with, and refuses a second webview on the
     * same folder asking for different ones. The panes and the sign-in window
     * take BROWSER_ARGS from this file; the main window is built from the
     * config and the settings window has to match it, so the string is written
     * twice. This is what notices when only one of them is edited.
     */
    #[test]
    fn the_config_asks_for_the_same_browser_arguments() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json");

        let configured = config["app"]["windows"][0]["additionalBrowserArgs"]
            .as_str()
            .expect("the main window should name its browser arguments");

        assert_eq!(configured, BROWSER_ARGS);
    }

    /*
     * Everything in BROWSER_ARGS is about memory. A switch that widens what a
     * renderer may reach -- or that lets two sites share one -- is not, and
     * the saving would never be worth it.
     */
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
}
