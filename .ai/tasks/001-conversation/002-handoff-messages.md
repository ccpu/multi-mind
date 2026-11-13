# Handoff messages

**Feature: [conversation](README.md)** · Status: todo · Depends on: none

**Docs:** [handoff-protocol](../../../docs/001-conversation/handoff-protocol.md)

## Goal

Pure functions that write every message the app sends to a browser and read every tag the browsers write back, exactly as in the doc.

## Design

New `packages/multi-mind/src/conversation/protocol.ts`, exported from the package index.

```ts
type LeadTag = { kind: 'ask'; reviewers: number[] } | { kind: 'final' };
type Verdict = 'agree' | 'changes' | null;
interface Review { reviewer: number; verdict: Verdict; text: string }

parseLeadTag(text: string, reviewerCount: number): LeadTag | null;
parseVerdict(text: string): Verdict;
stripTags(text: string): string;

leadFirstMessage(o: { topic: string; reviewerCount: number; maxRounds: number }): string;
reviewerMessage(o: {
  reviewer: number; reviewerCount: number; round: number;
  firstTime: boolean; topic: string; leadText: string; earlierReviews: Review[];
}): string;
leadReviewsMessage(o: { round: number; maxRounds: number; reviews: Review[] }): string;
missingTagReminder(reviewerCount: number): string;
```

- Tag rules ([reading the tag](../../../docs/001-conversation/handoff-protocol.md#reading-the-tag)): last tag wins; `ASK` targets read by their digits (`2`, `R2`, `Reviewer 2`); `ALL` any case → `1..reviewerCount`; out-of-range and duplicate numbers dropped; nothing left → `null`.
- Reviewers are numbers 1-based; reviewer order = setup order.
- **Anonymity by construction:** no function takes a site name, URL or website object. Text written by the AIs passes through unchanged.
- Message wording is the doc's templates; keep them as template strings in this one file so the doc and code are easy to compare.
- Earlier reviews block: follows [open decisions](../../../docs/001-conversation/conversation-flow.md#open-decisions) question 1 (recommended: included). Built only when `earlierReviews` is not empty.
- Reviewer verdict missing → shown as `(no verdict)` in [leadReviewsMessage](../../../docs/001-conversation/handoff-protocol.md#message-back-to-the-lead).
- Last round (`round === maxRounds`): last line becomes the "LAST round … [[FINAL]]" line.

## Done when

- [ ] unit: `parseLeadTag` — last tag wins over a quoted earlier one; `[[ASK: 2, 1]]` keeps order; `R2` / `Reviewer 2` / `2` equal; `[[ask: all]]` works; `[[ASK: 7]]` with 3 reviewers → `null`; no tag → `null`.
- [ ] unit: `stripTags` removes every tag (lead and reviewer kinds) and trailing blank lines.
- [ ] unit: each builder's output matches the doc example (inline snapshot), including the first-time vs later reviewer message and the last-round line.
- [ ] unit: for a run built with topic and replies that contain no site names, no built message contains `Claude`, `ChatGPT`, `Gemini`, `DeepSeek`, `Grok`, `Perplexity`, `Qwen` or `http`.
- [ ] unit: `pnpm --filter @internal/multi-mind test` and typecheck pass.

## Open questions

- Should a reviewer see earlier reviews from the same round? See [open decisions](../../../docs/001-conversation/conversation-flow.md#open-decisions) question 1. Recommended: yes.
