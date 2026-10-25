use super::{ensure_origin, BrowserOperation};
use serde_json::Value;
use std::time::Duration;
use tauri::Webview;

async fn evaluate(webview: &Webview, script: String) -> Result<Value, String> {
    let (sender, mut receiver) = tokio::sync::mpsc::channel(1);
    webview
        .eval_with_callback(script, move |result| {
            let _ = sender.try_send(result);
        })
        .map_err(|error| error.to_string())?;
    let result = receiver
        .recv()
        .await
        .ok_or("Browser closed before the operation completed.")?;
    serde_json::from_str(&result).map_err(|error| error.to_string())
}

/// Rich editors receive focus and selection in an earlier host task, without a page timer.
pub async fn execute(webview: &Webview, request: BrowserOperation) -> Result<Value, String> {
    if request.action["kind"] == "fill" {
        webview.set_focus().map_err(|error| error.to_string())?;
        let prepare = request
            .prepare_script
            .ok_or("Missing composer preparation.")?;
        let prepared = evaluate(webview, prepare).await?;
        if prepared != Value::Bool(true) {
            return Ok(prepared);
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
    ensure_origin(webview, &request.expected_origin)?;
    evaluate(webview, request.fallback_script).await
}
