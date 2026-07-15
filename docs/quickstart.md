# Local Quickstart

This guide captures a memory-dependent failure from a local Node.js agent and opens it in Engram's Incident workspace.

## 1. Start Studio

From the Engram repository:

```bash
npm install
npm run engram -- init --project my-agent
npm run engram -- dev
```

`init` creates `.engram/config.json` with a local project ID and ingest token. The file and local capture data are git-ignored. `dev` starts Studio on port 3100 and enables local trace discovery.

## 2. Configure the agent process

The easiest path is to let Engram inject the three agent-side capture variables:

```bash
npm run engram -- run -- npm run my-agent
```

For another process manager, inspect sourceable shell or JSON output with `engram env --format shell` or `engram env --format json`. The output excludes collector-only key maps and data paths.

The SDK is fail-open by default: a capture outage is reported through `onError` but does not fail the agent turn. Set `strict: true` only when telemetry delivery must be part of the test contract.

## 3. Capture a turn

```ts
import { EngramClient } from "@engramviz/sdk";

const engram = new EngramClient({
  adapter: "my-memory-layer",
  onError: console.error
});

await engram.withTurn(
  {
    input: "What city do I live in now?",
    provider: { id: "my-agent", model: "agent-v12" }
  },
  async (turn) => {
    const candidates = await retrieveMemories();
    await turn.retrieve({
      query: "What city do I live in now?",
      candidates,
      selectedIds: candidates.filter((candidate) => candidate.selected).map((candidate) => candidate.memoryId)
    });

    const loadedIds = buildPrompt(candidates);
    await turn.load(loadedIds);
    return generateAnswer();
  }
);
```

Capture mutations where they occur with `turn.store`, `turn.update`, `turn.supersede`, `turn.delete`, or `turn.summarize`.

Until `v0.1.0` is published, SDK imports resolve through the cloned npm workspace. The release workflow verifies packed packages in a clean external project before publishing.

## 4. Diagnose the incident

Open `http://localhost:3100/?mode=incidents` and select the captured turn. Enter the key fact the answer should contain, then:

1. Inspect memory state, retrieval, context load, and answer separately.
2. Review Engram's diagnosis and its evidence level.
3. Apply the proposed change to an isolated branch.
4. Replay the same recorded input.
5. Verify the retrieval and answer assertions.

No branch changes the source memory provider.

## 5. Run the repair in CI

Export the verified incident as `incident-name.engram-test.json`, check it into the agent repository, and provide an executor module:

```js
export default async function run(fixture) {
  const result = await runAgentVersionUnderTest({
    memories: fixture.memories,
    messages: [...fixture.input.history, { role: "user", content: fixture.input.userMessage }]
  });

  return {
    answer: result.answer,
    retrievedMemoryIds: result.retrievedMemoryIds,
    loadedMemoryIds: result.loadedMemoryIds
  };
}
```

Run it with:

```bash
engram test incident-name.engram-test.json --executor ./engram-regression.mjs
```

The command exits nonzero if any required/forbidden retrieval, context-capacity, or answer-text assertion fails. The report always prints the artifact's evidence caveat.
