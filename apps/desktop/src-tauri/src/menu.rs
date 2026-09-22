//! The right-click menu over an embedded browser.
//!
//! WebView2 came with a browser menu built in, so the WinForms build never had
//! to think about it. Electron had to build one, and did it in the main
//! process off a `ContextMenuParams`. Here the guest reports the click, the
//! main window builds the model with `buildContextMenuModel` — which is where
//! it is tested — and this file only draws it, because a menu over a child
//! webview cannot be drawn by the page underneath it.

use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use tauri::menu::{ContextMenu, Menu, MenuEvent, MenuItemBuilder, PredefinedMenuItem};
use tauri::{AppHandle, LogicalPosition, State, Window};

/// How long to wait for the popup itself to come back. Only a menu left open
/// for longer than anyone would gets this far.
const POPUP_TIMEOUT: Duration = Duration::from_secs(60);

/// Mirror of `NativeMenuEntry`; a separator is an entry with no action.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMenuEntry {
    pub action: String,
    pub label: String,
    pub enabled: bool,
}

/// Where the answer to the menu that is currently up should be sent.
#[derive(Default)]
pub struct PendingMenu(Mutex<Option<Sender<String>>>);

impl PendingMenu {
    fn expect(&self, sender: Sender<String>) {
        *self.0.lock().expect("pending menu poisoned") = Some(sender);
    }

    fn forget(&self) {
        *self.0.lock().expect("pending menu poisoned") = None;
    }

    /// Answers whatever menu is up. Registered once, in `lib.rs`, because a
    /// popup menu's selection arrives through the app rather than the menu.
    pub fn resolve(&self, event: &MenuEvent) {
        if let Some(sender) = self.0.lock().expect("pending menu poisoned").take() {
            let _ = sender.send(event.id().0.clone());
        }
    }
}

/// How long to keep listening for a selection once the popup has come back.
///
/// On Windows and macOS the popup is modal, so by the time it returns the
/// choice has already been made and only needs to reach us — a moment. On
/// Linux it returns straight away and the menu is still up, so there the wait
/// has to last as long as a person might take.
fn selection_grace() -> Duration {
    if cfg!(target_os = "linux") {
        POPUP_TIMEOUT
    } else {
        Duration::from_millis(750)
    }
}

/// Pops a native menu over the window that asked for it and answers with what
/// was chosen.
///
/// The window comes from the call rather than by name, because there may be
/// several main windows and the menu belongs over the pane that was
/// right-clicked — the point below is measured from that window's corner.
///
/// `null` for a menu dismissed without a choice, which is not something a
/// popup menu reports on any platform — it is simply a wait that ends.
#[tauri::command]
pub async fn guest_popup_menu(
    app: AppHandle,
    window: Window,
    pending: State<'_, PendingMenu>,
    entries: Vec<NativeMenuEntry>,
    x: f64,
    y: f64,
) -> Result<Option<String>, String> {
    let (picked_tx, picked_rx) = channel::<String>();
    let (shown_tx, shown_rx) = channel::<Result<(), String>>();

    pending.expect(picked_tx);

    let handle = app.clone();

    // Menus have to be built and shown on the main thread, so the whole of it
    // goes over at once rather than in pieces.
    app.run_on_main_thread(move || {
        let _ = shown_tx.send(show_menu(&handle, &window, &entries, x, y));
    })
    .map_err(|error| error.to_string())?;

    let shown = shown_rx
        .recv_timeout(POPUP_TIMEOUT)
        .map_err(|_| "The right-click menu did not open.".to_string())?;

    if let Err(error) = shown {
        pending.forget();
        return Err(error);
    }

    let picked = picked_rx.recv_timeout(selection_grace()).ok();
    pending.forget();

    Ok(picked)
}

fn show_menu<R: tauri::Runtime>(
    app: &AppHandle<R>,
    window: &tauri::Window<R>,
    entries: &[NativeMenuEntry],
    x: f64,
    y: f64,
) -> Result<(), String> {
    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<R>>> = Vec::with_capacity(entries.len());

    for entry in entries {
        if entry.action.is_empty() {
            items.push(Box::new(
                PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?,
            ));
            continue;
        }

        // The id is the action, so the answer needs no lookup table.
        let item = MenuItemBuilder::with_id(&entry.action, &entry.label)
            .enabled(entry.enabled)
            .build(app)
            .map_err(|error| error.to_string())?;

        items.push(Box::new(item));
    }

    let refs: Vec<&dyn tauri::menu::IsMenuItem<R>> =
        items.iter().map(|item| item.as_ref()).collect();

    let menu = Menu::with_items(app, &refs).map_err(|error| error.to_string())?;

    // The point is measured from the window's top-left corner, which is where
    // the main window put it after adding the pane's own offset: the guest
    // measures a click from its own corner and knows nothing of the window's.
    menu.popup_at(window.clone(), LogicalPosition::new(x, y))
        .map_err(|error| error.to_string())
}
