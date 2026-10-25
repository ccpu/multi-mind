//! Browser operations are native on Windows and temporary evaluations on WebKit.

#[cfg(windows)]
mod cdp;
#[cfg(windows)]
mod document;
#[cfg(not(windows))]
mod webkit;
#[cfg(windows)]
mod windows;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, State, Window};

#[cfg(windows)]
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BrowserAction {
    Fill {
        selector: String,
        text: String,
    },
    Click {
        selector: String,
    },
    Snapshot {
        selectors: Selectors,
        prompt: String,
    },
}

#[cfg(windows)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Selectors {
    response_selector: String,
    turn_selector: String,
    busy_selector: String,
    complete_selector: String,
    #[serde(default)]
    user_selector: String,
    #[serde(default)]
    error_selector: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserOperation {
    action: Value,
    fallback_script: String,
    prepare_script: Option<String>,
    expected_origin: String,
}

fn ensure_origin(webview: &tauri::Webview, expected: &str) -> Result<(), String> {
    let current = webview.url().map_err(|error| error.to_string())?;
    if current.origin().ascii_serialization() != expected {
        return Err("The browser changed origin; sign in before sending.".into());
    }
    Ok(())
}

/// Serializes operations per pane, including when an older attempt is cancelled.
#[derive(Default)]
pub struct BrowserAutomation(Mutex<HashMap<String, std::sync::Weak<tokio::sync::Mutex<()>>>>);

impl BrowserAutomation {
    fn lock_for(&self, label: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = self.0.lock().unwrap_or_else(|error| error.into_inner());
        locks.retain(|_, lock| lock.strong_count() > 0);
        if let Some(lock) = locks.get(label).and_then(std::sync::Weak::upgrade) {
            return lock;
        }
        let lock = Arc::new(tokio::sync::Mutex::new(()));
        locks.insert(label.to_string(), Arc::downgrade(&lock));
        lock
    }
}

/// Only the trusted host may request automation; guests retain message-only access.
#[tauri::command]
pub async fn guest_automation(
    app: AppHandle,
    window: Window,
    state: State<'_, BrowserAutomation>,
    website_id: String,
    request: BrowserOperation,
) -> Result<Value, String> {
    if !crate::guest::is_main_window_label(window.label()) {
        return Err("Only a main window may automate a browser.".into());
    }
    let webview = crate::guest::webview_of(&app, window.label(), &website_id)?;
    #[cfg(windows)]
    let lock = state.lock_for(webview.label());
    #[cfg(not(windows))]
    let lock = state.lock_for("webkit-automation");
    let _guard = lock.lock().await;
    ensure_origin(&webview, &request.expected_origin)?;
    #[cfg(windows)]
    {
        let _ = (request.fallback_script, request.prepare_script);
        let action = serde_json::from_value(request.action).map_err(|error| error.to_string())?;
        tokio::time::timeout(
            Duration::from_secs(15),
            windows::execute(&webview, action, &request.expected_origin),
        )
        .await
        .map_err(|_| "Browser operation timed out.".to_string())?
    }
    #[cfg(not(windows))]
    {
        tokio::time::timeout(Duration::from_secs(15), webkit::execute(&webview, request))
            .await
            .map_err(|_| "Browser operation timed out.".to_string())?
    }
}
