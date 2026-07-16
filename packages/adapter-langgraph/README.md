# @engramviz/adapter-langgraph

Evidence-preserving instrumentation for the LangGraph long-term `Store` interface.

The adapter wraps `InMemoryStore`, `PostgresStore`, `MongoDBStore`, and other
`BaseStore`-compatible implementations without importing a concrete store. It
captures `put`, `search`, `get`, `delete`, and direct `batch` calls inside the
active Engram turn.

```ts
import { InMemoryStore } from "@langchain/langgraph";
import {
  instrumentLangGraphStore,
  langGraphMemoryIds
} from "@engramviz/adapter-langgraph";
import { EngramClient } from "@engramviz/sdk";

const engram = new EngramClient({ adapter: "langgraph" });
const store = instrumentLangGraphStore(new InMemoryStore(), engram);

await engram.withTurn(turnOptions, async (turn) => {
  const results = await store.search(["users", userId, "memories"], {
    query: "Where does the user live?",
    limit: 3
  });

  const loadedIds = langGraphMemoryIds(results);
  await turn.load(loadedIds);
  return graph.invoke(input, { context: { userId } });
});
```

Search results are captured as retrieval candidates. They are not assumed to
have reached model context; call `turn.load(...)` only for memories actually
included in model input.

LangGraph checkpointers are intentionally outside this adapter. Checkpoints are
thread execution state, while LangGraph `Store` values are the durable
cross-thread memory boundary Engram observes.
