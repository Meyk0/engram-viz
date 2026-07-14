import { describe, expect, it } from "vitest";
import type { MemoryBranchReplayResult, MemoryCheckpoint } from "@/lib/lab/types";
import {
  MEMORY_REGRESSION_CAVEAT,
  createMemoryRegressionArtifact,
  memoryRegressionArtifactSchema,
  parseMemoryRegressionArtifact,
  replayResultsFromBranchReplay,
  serializeMemoryRegressionArtifact
} from "@/lib/regressions";
import type { EngramMemory } from "@/types";

describe("portable memory regression artifacts", () => {
  it("builds a versioned artifact from a frozen checkpoint and replay evidence", () => {
    const checkpoint = fixtureCheckpoint();
    const original = structuredClone(checkpoint);
    const replayResults = replayResultsFromBranchReplay(fixtureBranchReplay());

    const artifact = createMemoryRegressionArtifact({
      checkpoint,
      title: "Prefer the current city memory",
      description: "Prevent an older location memory from outranking the current one.",
      replayResults,
      assertions: {
        retrieval: {
          mustRetrieve: ["memory-oakland"],
          mustNotRetrieve: ["memory-san-francisco"],
          maxLoaded: 1
        },
        answer: {
          contains: ["Oakland"],
          notContains: ["San Francisco"]
        }
      },
      metadata: { owner: "memory-platform" }
    });

    expect(artifact).toMatchObject({
      kind: "engram.memory-regression",
      version: 1,
      title: "Prefer the current city memory",
      provenance: {
        source: {
          checkpointId: checkpoint.id,
          checkpointSource: "conversation"
        },
        turn: {
          recordId: "turn-current-city",
          sessionId: "session-1",
          provider: { id: "openai", model: "example-model" }
        },
        metadata: { owner: "memory-platform" }
      },
      evidence: {
        basis: "recorded-and-replayed",
        claim: "behavioral-observation",
        causalClaim: false,
        caveat: MEMORY_REGRESSION_CAVEAT,
        baseline: {
          evidence: "replayed",
          memoryContext: {
            source: "replay-input",
            retrievalObserved: false,
            loadedMemoryIds: ["memory-san-francisco"]
          }
        },
        treatment: {
          evidence: "replayed",
          memoryContext: {
            retrievalObserved: false,
            loadedMemoryIds: ["memory-oakland"]
          }
        }
      },
      assertions: {
        retrieval: {
          mustRetrieve: ["memory-oakland"],
          mustNotRetrieve: ["memory-san-francisco"],
          maxLoaded: 1
        },
        answer: {
          match: "case-insensitive-substring",
          contains: ["Oakland"],
          notContains: ["San Francisco"]
        }
      }
    });
    expect(artifact.fixture.input).toEqual({
      userMessage: "What city do I live in now?",
      history: [{ role: "user", content: "Actually, I live in Oakland now." }]
    });
    expect(artifact.fixture.memories.map((memory) => memory.id)).toEqual([
      "memory-san-francisco",
      "memory-oakland"
    ]);
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(checkpoint).toEqual(original);
  });

  it("infers only observed positive retrieval and leaves negative answer claims explicit", () => {
    const artifact = createMemoryRegressionArtifact({ checkpoint: fixtureCheckpoint() });

    expect(artifact.evidence.basis).toBe("recorded");
    expect(artifact.assertions).toEqual({
      retrieval: {
        mustRetrieve: ["memory-san-francisco"],
        mustNotRetrieve: []
      },
      answer: {
        match: "case-insensitive-substring",
        contains: [],
        notContains: []
      }
    });
    expect(artifact.evidence.recorded?.memoryContext).toMatchObject({
      source: "recorded-retrieval",
      retrievalObserved: true,
      retrievedMemoryIds: ["memory-san-francisco"],
      loadedMemoryIds: ["memory-san-francisco"]
    });
  });

  it("serializes and parses portable JSON without weakening validation", () => {
    const artifact = createMemoryRegressionArtifact({ checkpoint: fixtureCheckpoint() });
    const serialized = serializeMemoryRegressionArtifact(artifact);
    const parsed = parseMemoryRegressionArtifact(serialized);

    expect(parsed).toEqual(artifact);
    expect(JSON.parse(serialized)).toMatchObject({
      kind: "engram.memory-regression",
      version: 1
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(() => parseMemoryRegressionArtifact("not-json")).toThrow();
  });

  it("rejects contradictory, unknown, and impossible retrieval assertions", () => {
    const artifact = createMemoryRegressionArtifact({ checkpoint: fixtureCheckpoint() });
    const contradictory = structuredClone(artifact);
    contradictory.assertions.retrieval.mustNotRetrieve = ["memory-san-francisco"];
    expect(() => memoryRegressionArtifactSchema.parse(contradictory)).toThrow(/both required and forbidden/);

    const unknown = structuredClone(artifact);
    unknown.assertions.retrieval.mustRetrieve = ["memory-unknown"];
    expect(() => memoryRegressionArtifactSchema.parse(unknown)).toThrow(/unknown fixture memory/);

    const impossible = structuredClone(artifact);
    impossible.assertions.retrieval.mustRetrieve = ["memory-san-francisco", "memory-oakland"];
    impossible.assertions.retrieval.maxLoaded = 1;
    expect(() => memoryRegressionArtifactSchema.parse(impossible)).toThrow(/maxLoaded/);

    const mislabeled = structuredClone(artifact);
    mislabeled.evidence.basis = "checkpoint-state";
    expect(() => memoryRegressionArtifactSchema.parse(mislabeled)).toThrow(/Evidence basis/);
  });

  it("requires explicit input when a state-only checkpoint has no recorded query", () => {
    const checkpoint = fixtureCheckpoint();
    const stateOnly: MemoryCheckpoint = {
      ...checkpoint,
      source: "trace",
      turnRecord: undefined,
      query: undefined,
      answer: undefined
    };

    expect(() => createMemoryRegressionArtifact({ checkpoint: stateOnly })).toThrow(
      /recorded query or explicit turn input/
    );

    const artifact = createMemoryRegressionArtifact({
      checkpoint: stateOnly,
      turnInput: { userMessage: "Where do I live?", history: [] }
    });
    expect(artifact.evidence.basis).toBe("checkpoint-state");
    expect(artifact.fixture.input.userMessage).toBe("Where do I live?");
  });
});

function fixtureCheckpoint(): MemoryCheckpoint {
  const memories = fixtureMemories();
  const [sanFrancisco] = memories;
  const checkpoint: MemoryCheckpoint = {
    version: 1,
    id: "checkpoint-current-city",
    index: 2,
    label: "What city do I live in now?",
    source: "conversation",
    sourceId: "timeline-current-city",
    createdAt: "2026-07-14T18:00:01.000Z",
    events: [
      {
        type: "retrieve",
        query: "What city do I live in now?",
        ids: [sanFrancisco.id],
        accessed: [sanFrancisco]
      },
      { type: "load", ids: [sanFrancisco.id] }
    ],
    memories,
    loadedMemoryIds: [sanFrancisco.id],
    query: "What city do I live in now?",
    answer: "You live in San Francisco.",
    retrieval: {
      provider: "semantic",
      selectedCount: 1,
      matches: [{
        id: sanFrancisco.id,
        rank: 1,
        score: 0.9,
        basis: "semantic",
        selected: true
      }]
    },
    turnRecord: {
      version: 1,
      id: "turn-current-city",
      sessionId: "session-1",
      startedAt: "2026-07-14T18:00:00.000Z",
      completedAt: "2026-07-14T18:00:01.000Z",
      userMessage: "What city do I live in now?",
      history: [{ role: "user", content: "Actually, I live in Oakland now." }],
      retrievedMemories: [sanFrancisco],
      retrieval: {
        provider: "semantic",
        selectedCount: 1
      },
      events: [{
        type: "retrieve",
        query: "What city do I live in now?",
        ids: [sanFrancisco.id]
      }],
      originalAnswer: "You live in San Francisco.",
      provider: { id: "openai", model: "example-model" }
    }
  };
  return Object.freeze(checkpoint);
}

function fixtureMemories(): EngramMemory[] {
  return [
    {
      id: "memory-san-francisco",
      text: "User moved to San Francisco in 2022.",
      importance: 0.88,
      region: "hippocampus",
      created_at: "2026-07-14T17:40:00.000Z",
      access_count: 4
    },
    {
      id: "memory-oakland",
      text: "User lives in Oakland now.",
      importance: 0.92,
      region: "hippocampus",
      created_at: "2026-07-14T17:55:00.000Z",
      access_count: 0
    }
  ];
}

function fixtureBranchReplay(): MemoryBranchReplayResult {
  return {
    version: 1,
    evidence: "replayed",
    recordId: "turn-current-city",
    branchId: "branch-current-city",
    baselineMemoryIds: ["memory-san-francisco"],
    branchMemoryIds: ["memory-oakland"],
    baselineAnswer: "You live in San Francisco.",
    branchAnswer: "You live in Oakland.",
    changed: true,
    comparison: {
      outcome: "changed",
      normalizedTextDistance: 0.5,
      answerLengthDelta: -5,
      baselineRuns: 1,
      counterfactualRuns: 1
    },
    caveat: "Controlled replay; retrieval was not rerun.",
    provider: { id: "demo", model: "fixture-model" }
  };
}
