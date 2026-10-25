use super::super::{cdp::call, document::Document};
use serde_json::json;
use tauri::Webview;

pub(super) async fn query(
    webview: &Webview,
    root: u64,
    selector: &str,
) -> Result<Vec<u64>, String> {
    if selector.trim().is_empty() {
        return Ok(Vec::new());
    }
    let value = call(
        webview,
        "DOM.querySelectorAll",
        json!({ "nodeId": root, "selector": selector }),
    )
    .await?;
    serde_json::from_value(value["nodeIds"].clone()).map_err(|error| error.to_string())
}

pub(super) async fn visible(
    webview: &Webview,
    document: &Document<'_>,
    node: u64,
) -> Result<bool, String> {
    if document.hidden(node) {
        return Ok(false);
    }
    let value = call(webview, "DOM.getContentQuads", json!({ "nodeId": node })).await?;
    if value["quads"].as_array().is_none_or(Vec::is_empty) {
        return Ok(false);
    }
    let styles = call(
        webview,
        "CSS.getComputedStyleForNode",
        json!({ "nodeId": node }),
    )
    .await?;
    Ok(!styles["computedStyle"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|style| {
            (style["name"] == "visibility" && style["value"] == "hidden")
                || (style["name"] == "display" && style["value"] == "none")
        }))
}
