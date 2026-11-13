# Run engine

**Feature: [conversation](README.md)** · Status: todo · Depends on: [handoff-messages](002-handoff-messages.md)

**Docs:** [conversation-flow](../../../docs/001-conversation/conversation-flow.md#run-states), [limits](../../../docs/001-conversation/conversation-flow.md#limits), [ending a conversation](../../../docs/001-conversation/conversation-flow.md#ending-a-conversation)

## Goal

A pure state machine that decides, from each event, who speaks next and what text to send — rounds, reviewer queue, reminders, pauses and limits — with no browser or React code.

## Design

The states are the doc's [run states](../../../docs/001-conversation/conversation-flow.md#run-states) diagram. New `packages/multi-mind/src/conversation/engine.ts`:

```ts
interface ConversationConfig { topic: string; reviewerCount: number; maxRounds: number }
type Speaker = { role: 'lead' } | { role: 'reviewer'; reviewer: number };

type ConversationEvent =
  | { type: 'start' }
  | { type: 'reply'; text: string }        // answer read after completion
  | { type: 'failed'; reason: string }     // timeout, page error, send failed
  | { type: 'retry' } | { type: 'skip' } | { type: 'stop' };

type Effect =
  | { type: 'send'; to: Speaker; text: string }
  | { type: 'end'; ending: 'finished' | 'limit-reached' | 'stopped'; result: string };

step(state: ConversationState, event: ConversationEvent): { state: ConversationState; effects: Effect[] };
```

- State holds: status (`lead-writing` · `reviewer-writing` · `paused` · `finished` · `limit-reached` · `stopped`), round, reviewer queue for this round, reviews collected, last lead text, whether a reminder was already sent for this reply, the last `send` (for Retry), and the transcript (`{ round, speaker, tag, text }[]`).
- Speakers are numbers only; mapping a reviewer number to a website is the host's job ([start-a-conversation](004-start-a-conversation.md)).
- Rules, all from the doc:
  - Lead `ASK` → queue those reviewers; each reviewer reply → next in queue, or `leadReviewsMessage` to the lead and round + 1.
  - `FINAL` → `end: finished` with the stripped text. In round 1 with no review yet → reply "ask at least one reviewer first" ([open decisions](../../../docs/001-conversation/conversation-flow.md#open-decisions) question 5, recommended).
  - No tag → one `missingTagReminder`; the reply to it is parsed for a tag only and routes the earlier text. Second miss → `paused`.
  - Lead asks again on the last round → `end: limit-reached` with its last reply.
  - `failed` → `paused` with the reason. `retry` → resend the last `send`. `skip` (reviewer only) → treat as an empty review marked skipped. `stop` → `end: stopped` from any state.
  - Events that don't fit the state (a `reply` while paused) are ignored.
- Too-long forwarded text: not truncated here; a send failure arrives as `failed` and pauses ([open decisions](../../../docs/001-conversation/conversation-flow.md#open-decisions) question 3).

## Done when

- [ ] unit: a full run — lead `ASK: ALL` → Reviewer 1 → Reviewer 2 → lead `FINAL` — produces the doc's messages in order and ends `finished`.
- [ ] unit: `ASK: 2, 1` asks Reviewer 2 first; `ASK: 2` skips Reviewer 1.
- [ ] unit: missing tag → one reminder; reminder answered with a tag routes the earlier text; second miss → `paused`.
- [ ] unit: `maxRounds: 2` and a lead that keeps asking → last-round line sent in round 2, then `limit-reached` with the last lead reply.
- [ ] unit: `FINAL` in round 1 with no reviews → pushed back once, not finished.
- [ ] unit: `failed` → `paused`; `retry` resends the same text; `skip` on a reviewer moves on; `stop` ends from every state.
- [ ] unit: transcript records every turn with round, speaker and tag.
- [ ] unit: `pnpm --filter @internal/multi-mind test` and typecheck pass.

## Open questions

- Can the lead end in round 1 without asking anyone? See [open decisions](../../../docs/001-conversation/conversation-flow.md#open-decisions) question 5. Recommended: no.
- Too-long forwarded text: pause or cut? See [open decisions](../../../docs/001-conversation/conversation-flow.md#open-decisions) question 3. Recommended: pause.
