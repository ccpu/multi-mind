//! The commands that are about the app itself rather than about a browser or
//! the settings file.
//!
//! Each one is registered in `generate_handler!` in `lib.rs`, named in
//! `build.rs` so the ACL knows it, granted in `capabilities/default.json`, and
//! wrapped with its return type in `@internal/tauri-api`. Keep the four in
//! step: a bridge call is a string, and nothing else will catch a rename.

use std::collections::HashSet;

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder, Window};

use crate::guest;

/// How far a new main window is put down and to the right of the one it was
/// asked for from, so a second copy does not land exactly on top of the first
/// and look like nothing happened.
const CASCADE_OFFSET: f64 = 32.0;

/// Returned by [`app_info`]. Serialised as camelCase to match the TypeScript
/// interface in `packages/tauri-api/src/types.ts`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub tauri_version: String,
    pub platform: String,
    pub arch: String,
}

/// What [`open_window`] answers, kept as the Electron port shaped it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWindowResult {
    pub success: bool,
    pub message: String,
}

/// Report what the app is and where it is running.
#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    let package_info = app.package_info();

    AppInfo {
        name: package_info.name.clone(),
        version: package_info.version.to_string(),
        tauri_version: tauri::VERSION.to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

/// The windows the app knows how to open, and the page each one is.
fn page_of(window_name: &str) -> Option<(&'static str, &'static str, f64, f64)> {
    match window_name {
        "settings" => Some(("settings.html", "Multi Mind Settings", 900.0, 760.0)),
        _ => None,
    }
}

/// Raises a window by name, opening it if it is not up yet.
///
/// `open`, not `create`: asking for a window that is already up should raise
/// and focus it rather than open a second copy — which is what the Electron
/// port's `openWindow` did, and what the **Settings** button expects when it is
/// pressed twice.
///
/// The settings window is built on demand rather than declared in
/// `tauri.conf.json`, so an app that is never configured never pays for a
/// second webview.
#[tauri::command]
pub async fn open_window(app: AppHandle, window_name: String) -> OpenWindowResult {
    if let Some(window) = app.get_webview_window(&window_name) {
        let raised = window
            .show()
            .and_then(|()| window.unminimize())
            .and_then(|()| window.set_focus());

        return match raised {
            Ok(()) => OpenWindowResult {
                success: true,
                message: format!("Window \"{window_name}\" raised."),
            },
            Err(error) => OpenWindowResult {
                success: false,
                message: format!("Failed to raise window \"{window_name}\": {error}"),
            },
        };
    }

    let Some((page, title, width, height)) = page_of(&window_name) else {
        return OpenWindowResult {
            success: false,
            message: format!("There is no \"{window_name}\" window to open."),
        };
    };

    // Only the `#[cfg(windows)]` block below reassigns it, so off Windows the
    // `mut` is dead.
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut builder = WebviewWindowBuilder::new(&app, &window_name, WebviewUrl::App(page.into()))
        .title(title)
        .inner_size(width, height)
        .min_inner_size(560.0, 420.0)
        .center();

    // This window shares the default user-data folder with the main one, and
    // WebView2 will only build a second webview on a folder if it asks for the
    // same browser arguments.
    #[cfg(windows)]
    {
        let browser_arguments = crate::guest::browser_args(&app);
        builder = builder.additional_browser_args(&browser_arguments);
    }

    let built = builder.build();

    match built {
        Ok(_) => OpenWindowResult {
            success: true,
            message: format!("Window \"{window_name}\" opened successfully."),
        },
        Err(error) => OpenWindowResult {
            success: false,
            message: format!("Failed to open window \"{window_name}\": {error}"),
        },
    }
}

/// The label the next main window should take.
///
/// `main` when it is free — which it is on the very first launch, and again if
/// the first window is the one that was closed — and the lowest free `main-N`
/// otherwise. Lowest rather than next, so closing and reopening windows does
/// not walk the numbers up forever and leave the window-state file remembering
/// a geometry per number.
///
/// Both the windows and the webviews are asked, because a label has to be free
/// in either namespace and neither list is the whole story: a main window is
/// missing from `webview_windows()` the moment it has a second webview in it —
/// which, here, is as soon as one chat site is open — and its browsers are
/// missing from `windows()`.
fn next_main_window_label<R: Runtime>(app: &AppHandle<R>) -> String {
    let taken: HashSet<String> = app
        .windows()
        .into_keys()
        .chain(app.webviews().into_keys())
        .collect();

    if !taken.contains(guest::MAIN_WINDOW_LABEL) {
        return guest::MAIN_WINDOW_LABEL.to_string();
    }

    (2u32..)
        .map(|number| format!("{}{number}", guest::EXTRA_MAIN_WINDOW_PREFIX))
        .find(|label| !taken.contains(label))
        .unwrap_or_else(|| format!("{}2", guest::EXTRA_MAIN_WINDOW_PREFIX))
}

/// Where to put a window opened from `near`, in logical pixels.
///
/// `None` when there is nothing to cascade from, or when the platform will not
/// say where that window is — in which case the window falls back to the
/// `center` the config asks for.
fn cascade_position<R: Runtime>(near: Option<&Window<R>>) -> Option<(f64, f64)> {
    let window = near?;
    let scale = window.scale_factor().ok()?;
    let position = window.outer_position().ok()?.to_logical::<f64>(scale);

    Some((position.x + CASCADE_OFFSET, position.y + CASCADE_OFFSET))
}

/// Opens another main window.
///
/// This is what "another instance" means here. A second *process* cannot be
/// one: the signed-in sites live in a single browser profile, and the webview
/// locks that profile's cookie and storage databases to whichever process
/// opened them first — so a second process would come up signed out of
/// everything, and both of them writing those files is how a profile gets
/// corrupted. A second window in this process shares the profile, and with it
/// every sign-in.
///
/// The first window and every copy are built here, so all native windows use
/// the one browser-argument configuration WebView2 requires for a shared
/// user-data folder.
pub fn open_main_window<R: Runtime>(
    app: &AppHandle<R>,
    near: Option<&Window<R>>,
) -> tauri::Result<String> {
    let label = next_main_window_label(app);
    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Multi Mind")
        .inner_size(800.0, 450.0)
        .min_inner_size(640.0, 360.0)
        .resizable(true)
        .decorations(true)
        .background_color(tauri::window::Color(0, 0, 0, 255));

    #[cfg(windows)]
    let builder = {
        let browser_arguments = guest::browser_args(app);
        builder.additional_browser_args(&browser_arguments)
    };

    let builder = match cascade_position(near) {
        Some((x, y)) => builder.position(x, y),
        None => builder.center(),
    };

    builder.build()?;

    Ok(label)
}

/// **New Window** in the menu bar: another copy of the main window, signed in
/// to everything this one is.
#[tauri::command]
pub async fn new_window(app: AppHandle, window: Window) -> OpenWindowResult {
    match open_main_window(&app, Some(&window)) {
        Ok(label) => OpenWindowResult {
            success: true,
            message: format!("Window \"{label}\" opened successfully."),
        },
        Err(error) => OpenWindowResult {
            success: false,
            message: format!("Failed to open another window: {error}"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_the_settings_window() {
        assert!(page_of("settings").is_some());
    }

    #[test]
    fn main_window_is_not_also_declared_in_the_config() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json");

        assert!(config["app"]["windows"]
            .as_array()
            .is_some_and(Vec::is_empty));
    }

    /*
     * A window name arrives from the frontend as a string, and the only names
     * that may become a window are the ones named here — otherwise a typo, or
     * anything worse, would open a page of its own choosing.
     */
    #[test]
    fn refuses_a_name_it_does_not_know() {
        assert!(page_of("main").is_none());
        assert!(page_of("../../etc/passwd").is_none());
        assert!(page_of("").is_none());
    }

    #[test]
    fn app_info_serialises_as_camel_case() {
        let info = AppInfo {
            name: "Multi Mind".to_string(),
            version: "0.1.0".to_string(),
            tauri_version: "2.0.0".to_string(),
            platform: "windows".to_string(),
            arch: "x86_64".to_string(),
        };

        let json = serde_json::to_value(&info).expect("AppInfo should serialise");

        assert!(json.get("tauriVersion").is_some());
        assert!(json.get("tauri_version").is_none());
    }
}
