use super::super::{
    document::{fingerprint, Document},
    Selectors,
};
use super::page::{query, visible};
use serde_json::{json, Value};
use std::collections::HashSet;
use tauri::Webview;

pub(super) async fn snapshot(
    webview: &Webview,
    root_id: u64,
    document: &Document<'_>,
    selectors: Selectors,
    prompt: &str,
) -> Result<Value, String> {
    let responses = query(webview, root_id, &selectors.response_selector).await?;
    let turns = query(webview, root_id, &selectors.turn_selector).await?;
    let users = query(webview, root_id, &selectors.user_selector).await?;
    let mut seen = HashSet::new();
    let responses: Vec<(u64, u64)> = responses
        .into_iter()
        .filter_map(|response| {
            let turn = document.closest(response, &turns).unwrap_or(response);
            seen.insert(turn).then_some((turn, response))
        })
        .collect();
    let mut busy = false;
    for id in query(webview, root_id, &selectors.busy_selector).await? {
        if visible(webview, document, id).await? {
            busy = true;
            break;
        }
    }
    let mut errors = Vec::new();
    for id in query(webview, root_id, &selectors.error_selector).await? {
        if visible(webview, document, id).await? {
            let text = document.text(id).trim().to_string();
            if !text.is_empty() {
                errors.push(text);
            }
        }
    }
    let mut complete = false;
    let mut text = String::new();
    let mut has_text = false;
    let mut response_id = String::new();
    if let Some(&(turn, response)) = responses.last() {
        text = document.text(turn).trim().to_string();
        has_text = !document.text(response).trim().is_empty();
        response_id = document
            .attribute(response, "data-message-id")
            .filter(|id| !id.is_empty())
            .or_else(|| {
                document
                    .attribute(response, "id")
                    .filter(|id| !id.is_empty())
            })
            .map(str::to_string)
            .unwrap_or_else(|| responses.len().to_string());
        for id in query(webview, turn, &selectors.complete_selector).await? {
            if !document.in_pre(id)
                && document.attribute(id, "disabled").is_none()
                && document.attribute(id, "aria-disabled") != Some("true")
                && visible(webview, document, id).await?
            {
                complete = true;
                break;
            }
        }
    }
    let compact = |text: &str| {
        text.chars()
            .filter(|ch| !ch.is_whitespace())
            .collect::<String>()
    };
    let user_matches = users
        .last()
        .is_some_and(|id| compact(&document.text(*id)).contains(&compact(prompt)));
    let errors = errors.join("\n");
    Ok(json!({
        "url": webview.url().map_err(|error| error.to_string())?.as_str(),
        "title": document.title(),
        "responseCount": responses.len(), "userCount": users.len(), "userMatches": user_matches,
        "responseId": response_id, "fingerprint": fingerprint(&text), "hasText": has_text,
        "busy": busy, "complete": complete,
        "error": if errors.is_empty() { String::new() } else { fingerprint(&errors) }
    }))
}
