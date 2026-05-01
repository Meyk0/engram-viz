# Memory Eval Harness

The memory eval harness is the fast regression layer for Engram memory behavior. It is deterministic
and does not call OpenAI, so it can run before every LLM or visualization change.

## What It Covers

- Conversation decisions: whether a user turn should create a durable hippocampus memory.
- Retrieval relevance: whether a query pulls the expected stored memories and avoids confusing neighbors.
- Consolidation policy: whether repeated hippocampus memories merge into temporal semantic memory.
- Scenario replays: whether multi-turn memory behavior matches the product story users see in the UI.

## Run It

```bash
npm run eval:memory
```

For a full local verification pass, run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Add A Case

Add new fixtures in `src/lib/memory/evals.ts`:

- `memoryConversationEvalFixtures` for storage and question-vs-memory behavior.
- `memoryRetrievalEvalFixtures` for relevance and ranking.
- `memoryConsolidationEvalFixtures` for merge behavior.
- `memoryScenarioEvalFixtures` for multi-turn product narratives such as store, retrieve, load context,
  and consolidate.

Keep each case narrow. A good eval fixture should fail with a useful message when one behavior regresses.
