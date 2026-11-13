# Conversation

Several open browsers discuss one topic: a lead drafts, numbered reviewers critique in turn, and the app routes replies until the lead writes a final answer or a limit is hit.

Feature map: [docs/001-conversation](../../../docs/001-conversation/README.md)

| Task                                                  | Depends on                                                                   | Status |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| [read-answer-text](001-read-answer-text.md)           | none                                                                         | todo   |
| [handoff-messages](002-handoff-messages.md)           | none                                                                         | todo   |
| [run-engine](003-run-engine.md)                       | [handoff-messages](002-handoff-messages.md)                                  | todo   |
| [start-a-conversation](004-start-a-conversation.md)   | [read-answer-text](001-read-answer-text.md), [run-engine](003-run-engine.md) | todo   |
| [transcript-and-pauses](005-transcript-and-pauses.md) | [start-a-conversation](004-start-a-conversation.md)                          | todo   |

## Shared design

- Pure logic (tags, messages, run state machine) lives in `@internal/multi-mind` under `packages/multi-mind/src/conversation/`, unit-tested with no browser.
- The main window owns a run: it sends text, waits for the existing completion signal, reads the answer, and feeds the engine. Code: `apps/desktop/src/windows/main/conversation/`.
- One browser works at a time; the app, never the AIs, decides who speaks next ([conversation-flow](../../../docs/001-conversation/conversation-flow.md#decisions)).
- **Anonymity:** no message the app writes names a site, model, company or URL. The engine and message builders never receive site names; only the UI does ([handoff-protocol](../../../docs/001-conversation/handoff-protocol.md#anonymity)).

## Open questions

Asked once in the doc: [conversation-flow open decisions](../../../docs/001-conversation/conversation-flow.md#open-decisions).

1. Should a reviewer see earlier reviewers' replies from the same round? Recommended: yes. Affects [handoff-messages](002-handoff-messages.md).
2. Where does the old "Send only to" list go? Recommended: its own button. Affects [start-a-conversation](004-start-a-conversation.md).
3. Forwarded text too long for a site's input box: send it all and pause, or cut it? Recommended: send all and pause. Affects [run-engine](003-run-engine.md).
4. Save finished conversations in search history? Recommended: not in the first version. No task yet.
5. Can the lead end in round 1 without asking any reviewer? Recommended: no. Affects [run-engine](003-run-engine.md).
