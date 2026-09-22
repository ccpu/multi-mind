//! The commands that are about the app itself rather than about a browser or
//! the settings file.
//!
//! Each one is registered in `generate_handler!` in `lib.rs`, named in
//! `build.rs` so the ACL knows it, granted in `capabilities/default.json`, and
//! wrapped with its return type in `@internal/tauri-api`. Keep the four in
//! step: a bridge call is a string, and nothing else will catch a rename.

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

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
    // arguments the first did. `tauri.conf.json` gives the main window
    // `guest::BROWSER_ARGS`; this is the other half of that pair.
    #[cfg(windows)]
    {
        builder = builder.additional_browser_args(crate::guest::BROWSER_ARGS);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_the_settings_window() {
        assert!(page_of("settings").is_some());
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
