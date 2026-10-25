//! Exposes host overlays by clipping only the covered portions of native browsers.

#[cfg(windows)]
mod windows;

#[cfg(windows)]
use std::{collections::HashMap, sync::Mutex};
#[cfg(windows)]
use tauri::Manager;
use tauri::{AppHandle, Runtime, State, Webview, Window};

use crate::guest::{self, GuestBounds};

#[cfg(windows)]
#[derive(Clone, Default)]
pub struct OverlayLayout {
    pub bounds: Vec<GuestBounds>,
    pub modal: bool,
}

#[derive(Default)]
pub struct BrowserOverlays {
    #[cfg(windows)]
    windows: Mutex<HashMap<String, OverlayLayout>>,
}

impl BrowserOverlays {
    pub fn remove(&self, label: &str) {
        #[cfg(windows)]
        self.windows
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(label);
        #[cfg(not(windows))]
        let _ = label;
    }

    #[cfg(windows)]
    fn layout(&self, label: &str) -> OverlayLayout {
        self.windows
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(label)
            .cloned()
            .unwrap_or_default()
    }
}

/// Updates one window's overlays without hiding or resizing its browser panes.
#[tauri::command]
pub async fn guest_set_overlays(
    app: AppHandle,
    window: Window,
    state: State<'_, BrowserOverlays>,
    overlays: Vec<GuestBounds>,
    modal: bool,
) -> Result<bool, String> {
    if !guest::is_main_window_label(window.label()) {
        return Err("Only a main window may position browser overlays.".into());
    }
    if overlays.iter().any(|bounds| {
        ![bounds.x, bounds.y, bounds.width, bounds.height]
            .iter()
            .all(|value| value.is_finite())
            || bounds.width < 0.0
            || bounds.height < 0.0
    }) {
        return Err("Overlay bounds must be finite and nonnegative in size.".into());
    }
    #[cfg(windows)]
    {
        state
            .windows
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(
                window.label().to_string(),
                OverlayLayout {
                    bounds: overlays,
                    modal,
                },
            );
        for (label, webview) in app.webviews() {
            if guest::is_guest_of(&label, window.label()) {
                apply(&webview, &window)?;
            }
        }
    }
    #[cfg(not(windows))]
    let _ = (app, state, overlays, modal);
    Ok(cfg!(windows))
}

/// Reapplies the current regions after a browser is created, moved or resized.
pub fn apply<R: Runtime>(webview: &Webview<R>, window: &Window<R>) -> Result<(), String> {
    #[cfg(windows)]
    {
        let app = webview.app_handle().clone();
        let label = window.label().to_string();
        let parent = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        webview
            .with_webview(move |platform| {
                let layout = app.state::<BrowserOverlays>().layout(&label);
                if let Err(error) = windows::apply(&platform.controller(), parent, scale, &layout) {
                    eprintln!("Failed to clip browser overlays: {error}");
                }
            })
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(windows))]
    let _ = (webview, window);
    Ok(())
}
