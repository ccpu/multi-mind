# Read answer text

**Feature: [conversation](README.md)** · Status: todo · Depends on: none

**Docs:** [conversation-flow](../../../docs/001-conversation/conversation-flow.md#what-the-app-needs-that-it-does-not-have-yet), [handoff-protocol](../../../docs/001-conversation/handoff-protocol.md#reading-the-tag)

## Goal

The main window can ask one browser for the plain text of its latest answer, on demand. Today completion detection only reports _that_ a site finished, never what it said.

## Design

- New browser action `{ kind: 'read'; selector: string }` in [types.ts](../../../packages/multi-mind/src/browser-automation/types.ts). Result: `{ text: string }`, `text` is `''` when nothing matches.
  - Selector = the site's `responseSelectors.responseSelector`; take the **last visible** match (latest answer).
  - Text = the element's rendered text (`innerText`-like: block elements become line breaks), trimmed.
- Implement in both backends:
  - **WebKit fallback:** [run-browser-action.ts](../../../packages/multi-mind/src/browser-automation/run-browser-action.ts), reusing its `visible` and shadow-root search (it currently returns the _first_ match; read needs the last).
  - **Windows native:** add `Read` to `BrowserAction` in [mod.rs](../../../apps/desktop/src-tauri/src/browser_automation/mod.rs) and a branch in [windows.rs](../../../apps/desktop/src-tauri/src/browser_automation/windows.rs). Keep the existing rule "never `Runtime.evaluate`": build the text from the flattened DOM document's text nodes under the match.
  - Non-Windows dispatch in `webkit.rs` already runs the fallback script; check it passes `read` through.
- Host API: `appApi.guest.readAnswer(websiteId, website): Promise<string>` in `packages/tauri-api/src/browser-automation/`, with the same `expectedOrigin` check as `sendGuestPrompt`.
- Comments in [types.ts](../../../packages/multi-mind/src/browser-automation/types.ts) and [response-completion/types.ts](../../../packages/multi-mind/src/response-completion/types.ts) say answer text is never transferred. Change them: snapshots still never carry it; only `read` does, and only when the conversation runner asks.
- Never log the answer text.

## Done when

- [ ] unit: `runBrowserAction({ kind: 'read', … })` returns the last visible match's text, skips hidden matches, finds matches inside a shadow root, returns `''` when nothing matches.
- [ ] unit: Rust text extraction turns a small flattened document (paragraphs, list, code block) into text with line breaks.
- [ ] unit: `pnpm --filter @internal/multi-mind test` and `cargo test` for `src-tauri` pass; typecheck passes.
- [ ] live: on Windows, after a reply finishes in Claude and in ChatGPT, calling `readAnswer` from the dev console returns that reply's visible text and not the previous one.

## Open questions

Plain text = what you see on screen, without markdown symbols (`**bold**` arrives as `bold`, a code block arrives without its fences).

1. Is plain text good enough to forward to another AI, or do we need markdown back (headings, code fences)? Recommended: plain text.
   - Example: the lead writes a code block. Plain text sends the code without the ``` fences; the reviewer still reads it, but the language label is lost. Markdown would mean converting HTML back to markdown for each site.
