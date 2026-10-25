use serde_json::Value;
use tauri::Webview;
use webview2_com::{CallDevToolsProtocolMethodCompletedHandler, CoTaskMemPWSTR};

/// Uses WebView2's in-process protocol API, without opening a remote debugging port.
pub async fn call(webview: &Webview, method: &str, params: Value) -> Result<Value, String> {
    let method = method.to_string();
    let params = params.to_string();
    let operation = method.clone();
    let (sender, mut receiver) = tokio::sync::mpsc::channel(1);
    webview
        .with_webview(move |platform| {
            let complete = sender.clone();
            let callback = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                move |status, result| {
                    let result = status.map_err(|error| error.to_string()).and_then(|()| {
                        serde_json::from_str::<Value>(&result).map_err(|error| error.to_string())
                    });
                    let _ = complete.try_send(result);
                    Ok(())
                },
            ));
            let method = CoTaskMemPWSTR::from(method.as_str());
            let params = CoTaskMemPWSTR::from(params.as_str());
            let result = unsafe {
                platform.controller().CoreWebView2().and_then(|core| {
                    core.CallDevToolsProtocolMethod(
                        *method.as_ref().as_pcwstr(),
                        *params.as_ref().as_pcwstr(),
                        &callback,
                    )
                })
            };
            if let Err(error) = result {
                let _ = sender.try_send(Err(error.to_string()));
            }
        })
        .map_err(|error| error.to_string())?;
    receiver
        .recv()
        .await
        .ok_or("Browser protocol channel closed.")?
        .map_err(|error| format!("{operation}: {error}"))
}
