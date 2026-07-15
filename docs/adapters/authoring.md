# Adapter Authoring Guide

An Engram adapter translates a memory provider's observable API results into Memory Telemetry v2. It should be structurally thin and evidence-preserving.

## Required behavior

1. Wrap provider calls without changing their return values or thrown errors.
2. Emit only inside an active `EngramClient.withTurn` scope.
3. Preserve concrete memory IDs, ranks, scores, provider/store identity, and useful metadata.
4. Label translated provider responses `mapped` or `observed` according to the integration boundary and include a source path.
5. Report an instrumentation gap instead of fabricating an operation when IDs or outcomes are unavailable.
6. Keep retrieval separate from context loading. The application must call `turn.load` after prompt construction.
7. Remain fail-open unless the SDK was explicitly configured with `strict: true`.

## Tests

Include deterministic coverage for successful operations, empty results, malformed/partial provider output, asynchronous acknowledgements, provider errors, and calls outside an active turn. Do not require live credentials in normal CI.

## Review checklist

- Does every emitted operation have evidence provenance?
- Can an asynchronous write be mistaken for a completed store?
- Can a retrieved record be mistaken for loaded context?
- Are provider errors and return values preserved?
- Are unknown response shapes surfaced rather than silently normalized?
- Does the README document unsupported operations and provider-version assumptions?
