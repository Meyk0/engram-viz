# Engram Roadmap

Engram is an open-source memory debugger and regression harness for stateful AI
agents. The roadmap prioritizes real adopter workflows over breadth.

## Current: LangGraph reliability workflow

- Capture durable Store operations and active-context evidence.
- Promote a bad answer into a memory incident.
- Reproduce an untreated baseline from an explicit checkpoint.
- Apply a memory-native intervention on an isolated treatment branch.
- Export semantic memory and answer assertions for CI.

## Next

- Validate the quickstart in external LangGraph repositories.
- Add more canonical incident fixtures: ignored relevant memory, wrong context
  load, stale correction, and unsafe cross-scope retrieval.
- Reduce executor wiring with framework-specific templates and diagnostics.
- Add import paths from OpenTelemetry-compatible observability tools.
- Bring real-executor replay parity to the Mem0 integration.

## Later

- Shared incident review and regression history for teams.
- Production incident sampling, clustering, and policy-level reliability trends.
- Additional stateful-agent frameworks and memory providers.
- Optional hosted coordination without making local operation dependent on a
  managed service.

Roadmap items are directional, not committed release dates. Please use an
[adapter request](https://github.com/Meyk0/engram-viz/issues/new?template=adapter.yml)
or a memory-incident report to describe a concrete integration need.
