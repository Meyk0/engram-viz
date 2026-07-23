# Changelog

All notable changes to Engram packages will be documented here.

## 0.2.1 - 2026-07-22

- Fixed `engram demo stale-location` when port `3100` belongs to another local
  Engram project or service.
- The demo now verifies local Studio credentials before reuse and automatically
  starts on the next available port when the default is incompatible.

## 0.2.0 - 2026-07-22

- Reframed Engram around memory-incident diagnosis, controlled replay, and regression testing.
- Added the dedicated Diagnose -> Intervene -> Replay -> Prove incident workflow.
- Added real LangGraph checkpoint replay with isolated baseline and treatment runtimes.
- Added `engram init --framework langgraph` scaffolding for one shared Studio and CI executor.
- Added automatic LangGraph replay-checkpoint attachment to the active Engram turn.
- Added executor-aware `engram doctor`, direct incident links, configured regression discovery, and generated GitHub Actions coverage.
- Added a production-shaped support-agent example with optional OpenAI generation and deterministic CI verification.
- Added replay-fidelity manifests, earliest observable divergence analysis, and semantic v2 regression matrices.
- Added the public product site, guided memory-incident demo, and expanded Mintlify documentation project.

## 0.1.0 - 2026-07-15

- Added provider-neutral Memory Telemetry v2 and Agent Turn Envelope v1 contracts.
- Added a fail-open TypeScript capture SDK and local-first CLI.
- Added evidence-preserving Mem0 instrumentation.
- Added a standalone packaged Studio runtime.
- Added memory incident diagnosis, branch intervention, replay, and portable regression execution.
- Added deterministic clean-room package installation coverage.
