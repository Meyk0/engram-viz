# LangGraph long-term memory example

This deterministic example runs a real LangGraph `StateGraph` with an
instrumented `InMemoryStore`. It stores a durable city memory on one turn,
retrieves it on the next turn, and explicitly reports which result was copied
into active model context.

```bash
npm install
npm run engram -- init --project langgraph-example
npm run engram -- dev
```

In another terminal, load the generated environment and run:

```bash
eval "$(npx engram env --format shell)"
node examples/langgraph-memory/demo.mjs
```

Open `http://localhost:3100/?mode=incidents` to inspect the two turns.

The adapter instruments LangGraph's cross-thread `Store` interface. It does not
translate checkpointer snapshots into durable memories because checkpoints are
thread execution state, not evidence that the agent stored a user memory.
