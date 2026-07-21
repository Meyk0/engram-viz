# LangGraph checkpoint replay example

This deterministic example captures Engram's flagship stale-memory incident
through a real LangGraph `StateGraph`, `MemorySaver`, and `InMemoryStore`. Its
executor forks the captured checkpoint into isolated baseline and treatment
runs, reruns retrieval plus answer generation, and proves that selecting the
current memory changes the answer from San Francisco to Oakland.

Start Studio with the project executor:

```bash
npm install
npm run engram -- init --project langgraph-example
npm run engram -- dev --executor examples/langgraph-memory/engram.executor.mjs
```

In another terminal, capture the incident:

```bash
npm run engram -- run -- node examples/langgraph-memory/demo.mjs
```

Open `http://localhost:3100`, select the captured question, enter `Oakland` as
the expected answer, then follow **Diagnose -> Intervene -> Replay -> Prove**.
The Replay step should say **Real agent replay**, report selection as the
earliest divergence, and export a v2 regression artifact.

The checkpoint, Store, and side effects are isolated for each replay. The
adapter refuses runtimes that do not declare those boundaries. In a production
integration, replace `InMemoryStore` and `MemorySaver` with replay-safe copies
of the stores your graph uses; never point the executor at a mutable production
Store.
