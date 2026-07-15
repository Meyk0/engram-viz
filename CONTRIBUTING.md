# Contributing to Engram

Engram welcomes focused fixes, evidence-model improvements, memory-provider adapters, regression executors, and usability work around memory incidents.

## Development

```bash
npm install
npm run dev
```

Before opening a pull request, run:

```bash
npm run lint
npm run typecheck
npm test
npm run eval:memory
npm run build
```

Changes to package distribution or the CLI must also pass `npm run test:distribution`. Changes to the browser experience must pass `npm run smoke`.

## Evidence rules

- Do not claim access to hidden reasoning, chain-of-thought, or model activations.
- Keep observed, mapped, derived, inferred, replayed, and unavailable evidence distinct.
- Do not infer context loading from retrieval alone.
- Missing telemetry remains unavailable rather than becoming a negative observation.
- Replays are behavioral experiments and must retain `causalClaim: false`.
- Provider mutations require explicit developer review; incident branches do not silently change source stores.

Read [`docs/concepts/evidence-model.mdx`](docs/concepts/evidence-model.mdx) before changing trace, incident, replay, or regression behavior.

## Adapter contributions

Adapters must preserve provider IDs, source paths, ranks/scores when available, and instrumentation gaps when concrete operations cannot be established. Include deterministic fixtures and tests; live-provider tests must remain opt-in.

See [`docs/instrument/custom-adapters.mdx`](docs/instrument/custom-adapters.mdx).

## Pull requests

Keep changes milestone-sized. Describe the observable behavior changed, the evidence level involved, and the verification performed. Do not include API keys, `.engram` data, real user memories, provider exports, or generated Studio artifacts.
