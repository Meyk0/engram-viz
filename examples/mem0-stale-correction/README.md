# Mem0 stale-location incident

This deterministic fixture captures Engram's flagship failure: a user corrects their city, but the agent later loads the older location and answers incorrectly.

Run the complete demo from the repository root:

```bash
npm run engram -- demo stale-location
```

The command initializes capture, starts Studio, seeds the three-turn incident,
and opens the Incidents workspace. The manual flow below is useful when editing
the instrumented fixture itself.

```bash
npm run engram -- init --project stale-location-demo
npm run engram -- dev
```

In another terminal, let the CLI inject the local capture environment:

```bash
npm run engram -- run -- node examples/mem0-stale-correction/demo.mjs
```

The fixture has the same `add` and `search` response shapes as Mem0 OSS. Replace `StaleLocationFixture` with a real client without changing the wrapper:

```ts
import { Memory } from "mem0ai/oss";
import { instrumentMem0 } from "@engramviz/adapter-mem0";

const mem0 = instrumentMem0(new Memory(), engram);
```

Call `turn.load(memoryIds)` after constructing the model prompt. A search result proves retrieval; only the application can prove that a memory reached active context.

Mem0 Platform may return a pending event ID for asynchronous adds. Engram does not fabricate a stored memory in that case. Use the adapter's `onInstrumentationGap` callback until a webhook or event-status integration supplies concrete memory IDs.

After diagnosing and replaying the incident, run its portable regression contract:

```bash
npm run engram -- test \
  regressions/current-city.engram-test.json \
  --executor examples/mem0-stale-correction/regression-executor.mjs \
  --format github \
  --output engram-regression-report.json
```
