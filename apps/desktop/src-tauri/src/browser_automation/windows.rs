mod page;
mod snapshot;

use super::{
    cdp::call,
    document::{Document, Node},
    BrowserAction,
};
use page::{query, visible};
use serde_json::{json, Value};
use snapshot::snapshot;
use tauri::Webview;

/// DOM, CSS, Accessibility and Input commands only; never Runtime.evaluate.
pub async fn execute(
    webview: &Webview,
    action: BrowserAction,
    expected_origin: &str,
) -> Result<Value, String> {
    call(webview, "DOM.enable", json!({})).await?;
    call(webview, "CSS.enable", json!({})).await?;
    // Flat protocol nodes avoid JSON nesting limits on real provider pages.
    let value = call(
        webview,
        "DOM.getFlattenedDocument",
        json!({ "depth": -1, "pierce": true }),
    )
    .await?;
    let nodes: Vec<Node> =
        serde_json::from_value(value["nodes"].clone()).map_err(|error| error.to_string())?;
    let root_id = nodes
        .iter()
        .filter(|node| node.node_name == "#document" && node.parent_id.unwrap_or_default() == 0)
        .map(|node| node.node_id)
        .min()
        .ok_or("The browser document is unavailable.")?;
    let document = Document::new(root_id, &nodes);
    if let BrowserAction::Snapshot { selectors, prompt } = action {
        return snapshot(webview, root_id, &document, selectors, &prompt).await;
    }
    let selector = match &action {
        BrowserAction::Fill { selector, .. } | BrowserAction::Click { selector } => selector,
        _ => unreachable!(),
    };
    let mut node = None;
    'roots: for root in &document.roots {
        for found in query(webview, *root, selector).await? {
            if document.attribute(found, "disabled").is_none()
                && document.attribute(found, "aria-disabled") != Some("true")
                && visible(webview, &document, found).await?
            {
                node = Some(found);
                break 'roots;
            }
        }
    }
    let Some(node) = node else {
        return Ok(json!(false));
    };
    call(
        webview,
        "DOM.scrollIntoViewIfNeeded",
        json!({ "nodeId": node }),
    )
    .await?;
    match action {
        BrowserAction::Fill { text, .. } => {
            call(webview, "DOM.focus", json!({ "nodeId": node })).await?;
            call(webview, "Input.dispatchKeyEvent", json!({ "type": "keyDown", "key": "a", "code": "KeyA", "windowsVirtualKeyCode": 65, "modifiers": 2 })).await?;
            call(webview, "Input.dispatchKeyEvent", json!({ "type": "keyUp", "key": "a", "code": "KeyA", "windowsVirtualKeyCode": 65, "modifiers": 2 })).await?;
            super::ensure_origin(webview, expected_origin)?;
            call(webview, "Input.insertText", json!({ "text": text })).await?;
            let tree = call(
                webview,
                "Accessibility.getPartialAXTree",
                json!({ "nodeId": node, "fetchRelatives": false }),
            )
            .await?;
            let inserted = tree["nodes"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|node| node["value"]["value"].as_str())
                .any(|value| {
                    value.split_whitespace().collect::<String>()
                        == text.split_whitespace().collect::<String>()
                });
            Ok(json!(inserted))
        }
        BrowserAction::Click { .. } => {
            super::ensure_origin(webview, expected_origin)?;
            let value = call(webview, "DOM.getContentQuads", json!({ "nodeId": node })).await?;
            let quad: Vec<f64> = serde_json::from_value(value["quads"][0].clone())
                .map_err(|error| error.to_string())?;
            if quad.len() != 8 {
                return Ok(json!(false));
            }
            let x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4.0;
            let y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4.0;
            let hit = call(
                webview,
                "DOM.getNodeForLocation",
                json!({ "x": x.round(), "y": y.round(), "includeUserAgentShadowDOM": true }),
            )
            .await?;
            let hit_id = hit["nodeId"].as_u64().unwrap_or_default();
            if document.closest(hit_id, &[node]).is_none() {
                return Ok(json!(false));
            }
            for kind in ["mousePressed", "mouseReleased"] {
                call(
                    webview,
                    "Input.dispatchMouseEvent",
                    json!({ "type": kind, "x": x, "y": y, "button": "left", "clickCount": 1 }),
                )
                .await?;
            }
            Ok(json!(true))
        }
        _ => unreachable!(),
    }
}
