# Engram

**Open-source memory reliability for AI agents.**

Engram helps applied AI engineers answer a concrete incident question:

> This agent gave a bad answer. Which memory decision caused it, what changes if I correct that decision, and how do I prevent the failure from returning?

It captures memory operations around an agent turn, reconstructs the visible memory path, lets an engineer test a controlled alternative, and exports the verified behavior as a portable regression test.

**Observe -> explain -> intervene -> replay -> prove.**

The 3D brain is a synchronized evidence map and educational surface. The dedicated Incident workspace is where the debugging workflow happens.

Start with the [Engram documentation](docs/index.mdx) or go directly to the [npm quickstart](docs/quickstart.mdx).

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
npm run engram -- demo stale-location
```

That single command initializes local capture, starts Studio, records the
deterministic three-turn failure, and opens
[http://localhost:3100/?mode=incidents](http://localhost:3100/?mode=incidents).
Select `What city do I live in now?`, enter `Oakland` as expected answer
evidence, diagnose it, apply the proposed branch repair, and replay.

The underlying instrumented fixture remains directly runnable when developing
the adapter:

```bash
npm run engram -- dev
npm run engram -- run -- node examples/mem0-stale-correction/demo.mjs
```

Then run the checked-in version of that reliability contract:

```bash
npm run engram -- test \
  regressions/current-city.engram-test.json \
  --executor examples/mem0-stale-correction/regression-executor.mjs
```

The executor is the replaceable boundary. Point it at the retrieval and generation stack you want to validate in CI. Engram also accepts a captured observation JSON with `--observation`.

## Instrument an Agent

The repository contains six distributable workspace packages:

- `@engramviz/core`: provider-neutral telemetry and turn contracts.
- `@engramviz/sdk`: local capture client and turn lifecycle.
- `@engramviz/adapter-mem0`: evidence-preserving Mem0 wrapper.
- `@engramviz/adapter-langgraph`: evidence-preserving LangGraph Store wrapper.
- `@engramviz/studio`: prebuilt standalone local workbench and visual assets.
- `@engramviz/cli`: local Studio, import, diagnostics, and regression commands.

The six packages share the [`@engramviz`](https://www.npmjs.com/org/engramviz) npm scope and are tested in a clean external project by `npm run test:distribution`. The clean-project flow is:

```bash
npm install --save-dev @engramviz/cli
npm install @engramviz/sdk
npx --yes @engramviz/cli init --project my-agent
npx --yes @engramviz/cli doctor
npx --yes @engramviz/cli dev
npx --yes @engramviz/cli run -- npm run my-agent
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

See the [quickstart](docs/quickstart.mdx) and [Mem0 adapter guide](docs/instrument/mem0.mdx) for the full integration path.

For LangGraph, wrap its cross-thread `Store` before compiling the graph:

```ts
import { InMemoryStore } from "@langchain/langgraph";
import { instrumentLangGraphStore } from "@engramviz/adapter-langgraph";

const store = instrumentLangGraphStore(new InMemoryStore(), engram);
const graph = workflow.compile({ store });
```

The adapter captures `put`, `search`, `get`, `delete`, and direct `batch`
operations. Search results remain retrieval evidence; your prompt-building code
must call `turn.load(...)` for the memories actually copied into model context.
See the [LangGraph adapter guide](docs/instrument/langgraph.mdx) and
[runnable example](examples/langgraph-memory).

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

Read the [evidence model](docs/concepts/evidence-model.mdx) before interpreting a replay or regression report.

## Architecture

This repository builds two independent Next.js artifacts and one documentation
site. Their release boundaries are deliberate:

- The repository root is **Engram Studio**, the local workbench with API routes,
  local capture storage, and optional server credentials. `npm run dev` and
  `npm run build` target Studio, and the CLI launches its packaged build on a
  loopback address. The root app is not the Vercel deployment.
- [`apps/web`](apps/web) is the public product and demo app. Vercel must use
  `apps/web` as its **Root Directory**. This artifact has `/` and `/demo`, no API
  routes, and no access to Studio's server environment.
- [`docs`](docs) is the Mintlify project published at
  [docs.engramviz.com](https://docs.engramviz.com).

Use `npm run dev:public`, `npm run test:public`, and `npm run build:public` for
the public app. Public builds regenerate `apps/web/public` from an allowlist of
canonical root assets; `npm run verify:public` checks routes and secret markers.

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

The local store is session/development infrastructure, not a managed production backend. There is no login, billing, distributed retention service, or automatic source-provider mutation. See the [architecture guide](docs/concepts/architecture.mdx).

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
npm run test:public
npm run build:public
npm run verify:public
npm run smoke
```

CI runs the same checks, including sharded Chromium smoke tests. The checked-in regression harness validates repository behavior; production equivalence exists only when a project supplies an executor that calls its real agent stack.

## License and Credit

Engram source code is available under the [MIT License](LICENSE). The included
3D models retain their Creative Commons Attribution 4.0 licenses. See
[Third-Party Notices](THIRD_PARTY_NOTICES.md) for creators, source links, and
modification details.
