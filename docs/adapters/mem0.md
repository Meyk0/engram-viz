# Mem0 Adapter

`@engramviz/adapter-mem0` wraps a Mem0-like JavaScript client without importing a specific Mem0 distribution. It supports current Platform and OSS response containers for `add`, `search`, `update`, `delete`, and `deleteAll`.

The workspace package is publish-ready but has not had its first npm release yet. Use it through the repository workspace while developing the integration.

## Setup

```ts
import { EngramClient } from "@engramviz/sdk";
import { instrumentMem0 } from "@engramviz/adapter-mem0";

const engram = new EngramClient({ adapter: "mem0" });
const mem0 = instrumentMem0(rawMem0, engram, {
  storeId: "user-memory",
  selectedIds: (records) => records.slice(0, 3).map((record) => record.id),
  onInstrumentationGap: console.warn
});
```

The wrapper records operations only inside `engram.withTurn(...)`. Calls outside an active turn pass through unchanged.

## Retrieval versus context

```ts
await engram.withTurn(turnOptions, async (turn) => {
  const result = await mem0.search("Where do I live now?");
  const loadedIds = buildPromptFromMem0(result);
  await turn.load(loadedIds);
  return callModel();
});
```

The adapter can observe records returned by `search` and the IDs declared selected by `selectedIds`. It cannot inspect application prompt construction. Call `turn.load` only after the application has actually placed those memories into model input.

## Asynchronous Platform adds

Mem0 Platform may acknowledge an add with a pending event ID before concrete memory IDs exist. Engram does not fabricate a stored memory from that acknowledgement. The adapter calls `onInstrumentationGap` and emits no `store` event. A complete production integration should resolve the event through a webhook or event-status flow, then emit the concrete memory operation.

## Delete all

If `deleteAll` does not return affected memory IDs, Engram reports an instrumentation gap. The trace must not pretend to know which records changed.

## Source mutation boundary

An incident repair can generate a Mem0-oriented operation recipe. Engram never calls the real Mem0 client from the Incident workspace. Review and apply provider changes in the owning application, then rerun the exported regression against that version.

See [`../../examples/mem0-stale-correction`](../../examples/mem0-stale-correction) for the deterministic reference incident.
