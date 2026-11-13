# Transcript and pauses

**Feature: [conversation](README.md)** · Status: todo · Depends on: [start-a-conversation](004-start-a-conversation.md)

**Docs:** [conversation-flow](../../../docs/001-conversation/conversation-flow.md#ending-a-conversation), [run states](../../../docs/001-conversation/conversation-flow.md#run-states)

## Goal

You can follow a run turn by turn, recover a paused run with **Retry** or **Skip**, and read and copy the final conclusion.

## Design

- **Transcript panel** in the main window, opened from the run status line: one entry per turn — round, speaker (here with the site name, e.g. "Reviewer 1 · ChatGPT"), tag (`ASK: 2`, `AGREE`…), and the text read from the page. Newest at the bottom, auto-scroll while running.
- **Result:** on `finished`, the lead's final text shown at the top of the panel; `limit-reached` marked "not concluded"; `stopped` shows the transcript only.
- **Copy:** one button copies the result, one copies the whole transcript as plain text.
- **Paused banner:** reason ("Reviewer 2 timed out", "No tag after reminder", "Could not read the answer") with **Retry**, **Skip** (reviewer turns only) and **Stop**, wired to the engine's `retry` / `skip` / `stop` events from [run-engine](003-run-engine.md).
- The transcript lives in memory for the run; it is not saved ([open decisions](../../../docs/001-conversation/conversation-flow.md#open-decisions) question 4).
- Write `docs/ui-guide/conversation.md` while testing (doc-files skill, UI guides).

## Done when

- [ ] unit: transcript component renders each turn's round, speaker, tag and text, and the result block for each ending.
- [ ] unit: paused banner shows Skip only for reviewer turns and sends the right event for each button.
- [ ] live: a run shows every turn in the panel as it happens and the final conclusion at the end.
- [ ] live: closing a reviewer's chat mid-answer (or waiting for a timeout) pauses the run; **Skip** continues to the next reviewer; **Retry** resends.
- [ ] live: Copy puts the conclusion and the full transcript on the clipboard.

## Open questions

- None.
