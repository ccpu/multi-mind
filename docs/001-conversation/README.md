# Conversation

[← Docs index](../README.md) · Tasks: [conversation](../../.ai/tasks/001-conversation/README.md)

Several AI browsers discuss one topic: a lead browser owns the answer and asks reviewer browsers for their opinion, turn by turn, until it gives a final conclusion or a limit is reached.

```mermaid
%%{init: {"themeCSS": ".nodeLabel a { color: #1e3a8a !important; text-decoration: underline; font-weight: 600; }"}}%%
flowchart TD
    USER(["You<br/>type a topic"]) --> SETUP["<a href='conversation-flow.md#setup'>Set up the conversation</a><br/>pick the lead, reviewers and limits"]
    SETUP --> LEAD["<a href='handoff-protocol.md#first-message-to-the-lead'>Lead browser</a><br/>drafts an answer"]
    LEAD --> READ["<a href='handoff-protocol.md#reading-the-tag'>Read the reply</a><br/>who should speak next?"]
    READ --> NEXT{"Lead asked<br/>for reviews?"}
    NEXT -->|yes| REVIEW["<a href='handoff-protocol.md#message-to-a-reviewer'>Reviewer browsers</a><br/>give their opinion, one after another"]
    REVIEW --> BACK["<a href='handoff-protocol.md#message-back-to-the-lead'>Back to the lead</a><br/>with every review"]
    NEXT -->|final or limit| DONE["<a href='conversation-flow.md#ending-a-conversation'>Final conclusion</a><br/>shown with the full transcript"]
    DONE --> RESULT(["You read the conclusion"])
    BACK -.->|next round| LEAD

    RESULT ~~~ GUARDS

    subgraph GUARDS ["Runs by itself"]
        LIMITS["<a href='conversation-flow.md#limits'>Limits</a><br/>stop endless back-and-forth"]
    end

    classDef outside fill:#e5e7eb,stroke:#6b7280,color:#111827
    classDef host fill:#fed7aa,stroke:#c2410c,color:#111827
    classDef site fill:#bfdbfe,stroke:#1d4ed8,color:#111827

    class USER,RESULT outside
    class SETUP,READ,NEXT,BACK,DONE,LIMITS host
    class LEAD,REVIEW site
```

Orange: the app (main window) decides and routes. Blue: the AI sites in their browsers do the thinking. Grey: you.

Reading order:

1. [conversation-flow](conversation-flow.md): roles, rounds, setup, limits and how a conversation ends
2. [handoff-protocol](handoff-protocol.md): what each browser is told, the reply tags, and what gets passed on
