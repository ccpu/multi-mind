//! Asking GitHub whether there is a newer Multi Mind.
//!
//! This is the one thing the app does over the network without being asked, so
//! it is the one thing it asks about: the first packaged run puts the question,
//! and the answer is kept in the settings file for the settings window to
//! change later. Nothing but the version is sent.
//!
//! A development build never asks. It cannot replace itself, so spending the
//! one chance to ask on a question whose answer would do nothing is worse than
//! not asking.

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::UpdaterExt;

use crate::settings::SettingsStore;

/// Whether the updater has been given a key to check signatures against.
///
/// Without one the plugin cannot verify anything it downloads, so it is not
/// registered at all and this whole module stands down — which is the state a
/// fork is in until it sets up signing.
pub fn is_configured(config: &tauri::Config) -> bool {
    config
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("pubkey"))
        .and_then(Value::as_str)
        .is_some_and(|pubkey| !pubkey.trim().is_empty())
}

/// Runs the startup check, having asked first if it never has been asked.
pub fn check_on_startup(app: &AppHandle) {
    let app = app.clone();

    tauri::async_runtime::spawn(async move {
        if !is_allowed(&app).await {
            return;
        }

        match app.updater() {
            Ok(updater) => match updater.check().await {
                Ok(Some(update)) => offer(&app, update).await,
                Ok(None) => {}
                Err(error) => eprintln!("Failed to check for updates: {error}"),
            },
            Err(error) => eprintln!("The updater is not available: {error}"),
        }
    });
}

async fn is_allowed(app: &AppHandle) -> bool {
    let store = app.state::<SettingsStore>();
    let settings = store.settings();

    let auto_update = settings
        .get("autoUpdate")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let prompted = settings
        .get("autoUpdatePrompted")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    if prompted || tauri::is_dev() {
        return auto_update;
    }

    let answer = ask(app).await;

    // The window it was put to is the main one, and every window has to hear
    // the answer, so it is saved the way any other edit would be.
    let mut patch = serde_json::Map::new();
    patch.insert("autoUpdate".into(), json!(answer));
    patch.insert("autoUpdatePrompted".into(), json!(true));
    store.apply(app, patch);

    answer
}

async fn ask(app: &AppHandle) -> bool {
    let (sender, receiver) = tauri::async_runtime::channel(1);

    app.dialog()
        .message(
            "Multi Mind can ask GitHub for a newer release each time it starts, and offer to \
             install one when there is. Nothing but the version is sent. You can change this \
             later under Settings.",
        )
        .title("Check for updates?")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Check automatically".into(),
            "Do not check".into(),
        ))
        .show(move |answer| {
            let _ = sender.blocking_send(answer);
        });

    let mut receiver = receiver;
    receiver.recv().await.unwrap_or(false)
}

async fn offer(app: &AppHandle, update: tauri_plugin_updater::Update) {
    let version = update.version.clone();
    let (sender, mut receiver) = tauri::async_runtime::channel(1);

    app.dialog()
        .message(format!(
            "Multi Mind {version} is available. Download and install it now? The app will \
             restart when it is done."
        ))
        .title("An update is available")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Install".into(),
            "Not now".into(),
        ))
        .show(move |answer| {
            let _ = sender.blocking_send(answer);
        });

    if receiver.recv().await != Some(true) {
        return;
    }

    match update.download_and_install(|_, _| {}, || {}).await {
        Ok(()) => app.restart(),
        Err(error) => eprintln!("Failed to install the update: {error}"),
    }
}
