# Engram

**Memory observability and replay for AI agents.**

Engram is an interactive workbench for inspecting the observable memory layer around an AI agent. It
shows what the application stored, what retrieval considered and selected, what memory was loaded into
model context, and how that state changed over time. Controlled replays let developers test whether an
answer changes when a selected memory is omitted.

The 3D brain is Engram's visual overview. The underlying product is an event-driven memory debugger,
trace player, and experimentation environment.

## Core Workflow

**Observe → explain → intervene → replay → prove**

1. Start from a bad recorded answer in the current session or import an OpenAI Agents trace.
2. Reconstruct memory state, retrieval, active context, and the final answer as one causal incident.
3. Keep observed, adapter-mapped, derived, simulated, and unavailable evidence visibly distinct.
4. Apply one controlled change on an immutable memory branch, then replay the same turn.
5. Export a verified repair as a portable `.engram-test.json` regression artifact for CI.

The Incident workspace owns this workflow. The brain remains visible beside it as a synchronized memory
map; Time Machine, Integrity, Retrieval MRI, Dream review, and the educational experience remain
available through progressive disclosure.

## What Engram Can Show

- **Learn:** run a deterministic memory lifecycle and see new, working, and stable memory represented
  through an anatomical metaphor.
- **Observe:** import recorded agent traces or stream supported OpenAI Agents SDK spans into a flight
  recorder. Inspect instrumentation coverage so missing telemetry remains a visible blind spot.
  Explicit events remain distinguished from operations mapped by an adapter.
- **Incidents:** diagnose one bad answer across memory state, retrieval, active context, and generation.
  Test a diagnosis-specific repair in an immutable branch, compare original and replayed answers, and
  save verified behavior as a validated, portable `.engram-test.json` regression artifact. Retrieval
  MRI, Time Machine, Integrity, Dream review, and multi-agent topology remain available as advanced tools.

## Evidence Boundaries

Engram is deliberately narrow about what its evidence proves:

- It does **not** expose chain-of-thought, hidden reasoning, or internal model activations.
- A memory loaded into context was available to the model; that fact alone does not prove it influenced
  the answer.
- **Ablation Replay** compares a baseline rerun with a rerun that omits one retrieved memory. A changed
  output is evidence that the observable context change mattered in those runs, not proof of
  deterministic causality. Sampling and uncontrolled provider behavior can also affect the result.
- Trace completeness depends on instrumentation. An absent memory event may mean that no operation
  occurred or that the integration did not capture it.
- Incident import refuses to treat missing context-load telemetry as a failed context load. That stage
  remains `unavailable` until the provider or application records it.

## Status

Engram is an advanced engineering prototype, not a hosted production telemetry service. Interactive
chat memory is browser-owned and explicitly projected into each stateless request; the legacy live
flight-recorder channel remains process-local. The provider-neutral telemetry
v2 path adds hashed bearer-key authentication, fixed tenant/project boundaries, idempotent cursor-based
ingestion, and optional server-only Supabase persistence. Engram still has no end-user login, billing,
distributed quota service, or managed retention policy. Deterministic demo mode and mocked providers keep
normal tests repeatable.

Model-backed routes enforce request-size limits, provider deadlines, cancellation, and a bounded
process-local per-client rate limit. Deployments with meaningful traffic should also configure a
distributed Vercel/platform rate limit because serverless instances do not share in-memory counters.

The architecture and current evidence model are described in
[`docs/engram-lab-architecture.md`](docs/engram-lab-architecture.md). The live Agents SDK integration is
documented in [`docs/flight-recorder.md`](docs/flight-recorder.md). See
[`docs/memory-incidents.md`](docs/memory-incidents.md),
[`docs/memory-telemetry-v2.md`](docs/memory-telemetry-v2.md),
[`docs/telemetry-ingestion.md`](docs/telemetry-ingestion.md), and
[`docs/replay-fidelity.md`](docs/replay-fidelity.md) for the production-facing contracts and their limits.

## Development

```bash
npm install
npm run dev
```

The app runs in deterministic `demo` mode by default. To use OpenAI for local chat turns, set:

```bash
ENGRAM_CHAT_PROVIDER=openai
OPENAI_LIVE_ENABLED=true
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.4-mini
```

Memory extraction and consolidation are separate guarded planners. To let OpenAI decide what to store
and when repeated episodic memories should consolidate into stable memory, set:

```bash
ENGRAM_MEMORY_PLANNER=openai
OPENAI_MEMORY_PLANNER_ENABLED=true
ENGRAM_CONSOLIDATION_PLANNER=openai
OPENAI_CONSOLIDATION_PLANNER_ENABLED=true
```

Retrieval is lexical by default. To use OpenAI embeddings for semantic retrieval, set:

```bash
ENGRAM_RETRIEVAL_PROVIDER=openai
OPENAI_RETRIEVAL_ENABLED=true
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

OpenAI calls are server-side only. Normal tests use mocked providers and do not require an API key.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run test:regressions
npm run eval:memory
npm run build
npm run smoke
```

`npm run eval:memory` runs deterministic memory scenarios covering storage decisions, retrieval
relevance, correction behavior, and consolidation without calling a live model.

`npm run test:regressions` validates checked-in portable regression artifacts against Engram's named
lexical/demo harness. It does not claim to replay a production vector store or model provider.

## Provider Direction

Engram's event and trace layers are designed to be provider-neutral. The current live integration
targets OpenAI, while deterministic fixtures exercise the same contracts without a network dependency.
Additional provider and memory-store adapters remain future work.

## Credit

Brain mesh by veryfAtfr0G on Sketchfab, CC Attribution.
