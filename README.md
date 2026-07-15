# Engram

**Open-source memory reliability for AI agents.**

Engram helps applied AI engineers answer a concrete incident question:

> This agent gave a bad answer. Which memory decision caused it, what changes if I correct that decision, and how do I prevent the failure from returning?

It captures memory operations around an agent turn, reconstructs the visible memory path, lets an engineer test a controlled alternative, and exports the verified behavior as a portable regression test.

**Observe -> explain -> intervene -> replay -> prove.**

The 3D brain is a synchronized evidence map and educational surface. The dedicated Incident workspace is where the debugging workflow happens.

## Flagship Workflow

The included reference incident models a common production failure:

1. The agent stores `User moved to San Francisco.`
2. The user corrects it with `Actually, I live in Oakland now.`
3. Retrieval selects the stale San Francisco memory and ignores Oakland.
4. The agent answers with the stale city.
5. Engram reconstructs the memory state, candidates, selected memory, loaded context, and answer.
6. The engineer branches from the original checkpoint and prefers the current memory.
7. Engram replays the frozen turn and verifies that the answer and retrieval behavior now pass.
8. The repair is saved as `*.engram-test.json` and run against future agent versions.

That workflow is intentionally narrower than general LLM observability. Engram complements tracing and memory platforms by specializing in memory-dependent failures and turning a diagnosis into an executable reliability check.

## Local Quickstart

Requirements: Node.js 20 or newer.

```bash
git clone https://github.com/Meyk0/engram-viz.git
cd engram-viz
npm install
npm run engram -- init --project my-agent
npm run engram -- dev
```

Open [http://localhost:3100/?mode=incidents](http://localhost:3100/?mode=incidents). In another terminal, run the deterministic Mem0-shaped incident with capture variables injected by the CLI:

```bash
npm run engram -- run -- node examples/mem0-stale-correction/demo.mjs
```

Select the recorded `What city do I live in now?` turn in Incidents, enter `Oakland` as expected answer evidence, diagnose it, apply the proposed branch repair, and replay.

Then run the checked-in version of that reliability contract:

```bash
npm run engram -- test \
  regressions/current-city.engram-test.json \
  --executor examples/mem0-stale-correction/regression-executor.mjs
```

The executor is the replaceable boundary. Point it at the retrieval and generation stack you want to validate in CI. Engram also accepts a captured observation JSON with `--observation`.

## Instrument an Agent

The repository contains five distributable workspace packages:

- `@engramviz/core`: provider-neutral telemetry and turn contracts.
- `@engramviz/sdk`: local capture client and turn lifecycle.
- `@engramviz/adapter-mem0`: evidence-preserving Mem0 wrapper.
- `@engramviz/studio`: prebuilt standalone local workbench and visual assets.
- `@engramviz/cli`: local Studio, import, diagnostics, and regression commands.

They are linked by this npm workspace and are publish-ready, but **have not been released to npm yet**. Until the first tagged release, use the source quickstart above. Package tarballs are tested in a clean external project by `npm run test:distribution`.

After the first package release, the clean-project flow will be:

```bash
npm install --save-dev @engramviz/cli
npm install @engramviz/sdk @engramviz/adapter-mem0
npx engram init --project my-agent
npx engram dev
npx engram run -- npm run my-agent
```

`engram env --format shell|json` is also available when a process manager needs the capture variables directly.

```ts
import { EngramClient } from "@engramviz/sdk";

const engram = new EngramClient({ adapter: "my-memory-layer" });

const answer = await engram.withTurn(
  {
    input: "Where do I live now?",
    provider: { id: "openai", model: "your-model" }
  },
  async (turn) => {
    const candidates = await memory.search("Where do I live now?");

    await turn.retrieve({
      query: "Where do I live now?",
      candidates: candidates.map((candidate, index) => ({
        memoryId: candidate.id,
        rank: index + 1,
        score: candidate.score,
        selected: candidate.selected
      })),
      selectedIds: candidates.filter((candidate) => candidate.selected).map((candidate) => candidate.id)
    });

    const loadedIds = candidates.filter((candidate) => candidate.loaded).map((candidate) => candidate.id);
    await turn.load(loadedIds);
    return runModel(candidates);
  }
);
```

`retrieve` and `load` are separate on purpose. A store search result proves that the application received a candidate; only the prompt-building application can report that the memory reached active model context.

For Mem0, wrap the client inside the active turn:

```ts
import { instrumentMem0 } from "@engramviz/adapter-mem0";

const mem0 = instrumentMem0(rawMem0, engram, {
  selectedIds: (records) => selectForPrompt(records).map((record) => record.id)
});
```

See [`docs/quickstart.md`](docs/quickstart.md) and [`docs/adapters/mem0.md`](docs/adapters/mem0.md) for the full integration path.

The opt-in [`examples/mem0-openai`](examples/mem0-openai) example exercises the real Mem0 OSS client and OpenAI Responses API with developer-owned credentials. Normal tests never make those paid calls.

## Product Surfaces

- **Learn:** understand new, working, and stable memory through the interactive brain metaphor.
- **Traces:** inspect recorded memory evidence and instrumentation coverage.
- **Incidents:** reconstruct one bad answer, test a branch-local repair, replay, and export a regression.
- **Advanced tools:** Retrieval MRI, Time Machine, Integrity, Dream review, timeline, and multi-agent topology remain available without competing with the primary incident workflow.

## Evidence Contract

Engram visualizes observable application behavior, not hidden model reasoning.

- **Observed:** emitted explicitly by the application or returned by an instrumented provider.
- **Mapped:** translated deterministically from a recognized provider response.
- **Derived:** computed from captured evidence, such as a failure-stage classification.
- **Replayed/simulated:** generated by rerunning a frozen input under a documented memory change.
- **Unavailable:** not captured; Engram does not silently convert missing telemetry into a negative result.

A memory being loaded proves it was available in context. It does not prove that hidden model reasoning used it. A changed replay is behavioral evidence that the controlled observable input mattered in those runs, not deterministic causal proof.

Engram does not silently mutate the source memory provider. Incident repairs are isolated branches. For Mem0, the workspace can produce a reviewable source-operation recipe, but applying it to the real store remains an explicit developer action.

Read [`docs/evidence-model.md`](docs/evidence-model.md) before interpreting a replay or regression report.

## Architecture

```text
Agent + memory provider
        |
        |  @engramviz/sdk / adapter
        v
Memory Telemetry v2 + Turn Envelope v1
        |
        v
Local append-only capture store
        |
        v
Normalized trace -> checkpoint -> incident
        |
        +--> branch-local intervention
        +--> controlled replay
        +--> portable .engram-test.json
```

The local store is session/development infrastructure, not a managed production backend. There is no login, billing, distributed retention service, or automatic source-provider mutation. See [`docs/engram-lab-architecture.md`](docs/engram-lab-architecture.md).

## Verification

Normal tests are deterministic and do not require a live model or memory provider.

```bash
npm run lint
npm run typecheck
npm test
npm run test:regressions
npm run eval:memory
npm run test:distribution
npm run build
npm run smoke
```

CI runs the same checks, including sharded Chromium smoke tests. The checked-in regression harness validates repository behavior; production equivalence exists only when a project supplies an executor that calls its real agent stack.

## License and Credit

Engram is available under the [MIT License](LICENSE).

Brain mesh by veryfAtfr0G on Sketchfab, CC Attribution.
