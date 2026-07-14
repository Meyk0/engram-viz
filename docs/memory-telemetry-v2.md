# Engram Memory Telemetry v2

Engram Memory Telemetry is the provider-neutral evidence contract between an
agent runtime and Engram's observability workspace. It describes memory
operations, not brain anatomy and not hidden model reasoning.

## Design rules

- Integrations emit operations such as `store`, `retrieve`, `load`, `update`,
  `summarize`, and `expire`.
- Memory tiers and scopes are operational concepts. Brain regions are derived by
  the visualization layer and never required from an integration.
- Every event has ordering, correlation, and evidence metadata.
- `observed` means the application emitted the operation explicitly. `mapped`
  means an adapter translated a recognized tool or span deterministically.
- Missing telemetry remains missing. Engram does not invent unrecorded memory
  operations.

## Minimal event

```json
{
  "schemaVersion": 2,
  "eventId": "evt-42",
  "traceId": "trace-7",
  "timestamp": "2026-07-14T18:00:00.000Z",
  "sequence": 4,
  "operation": "store",
  "memory": {
    "id": "memory-indigo",
    "content": "User likes indigo.",
    "tier": "episodic",
    "scope": "user"
  },
  "evidence": {
    "level": "observed",
    "adapter": "@engram/telemetry"
  }
}
```

## Compatibility

The v1 UI continues to consume `EngramEvent` while productization is in
progress. `engramEventToTelemetry` and `telemetryEventToEngramEvent` provide an
explicit compatibility boundary. Unsupported tiers such as `procedural` remain
valid telemetry but do not receive a misleading anatomical region.

## Evolution

Schema versions are immutable. New optional fields may be added within v2;
breaking semantic changes require v3. Collectors should preserve unknown source
fields in trace metadata and reject invalid required fields before persistence.
