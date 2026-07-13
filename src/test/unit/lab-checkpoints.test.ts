import { describe, expect, it } from "vitest";
import { applyMemoryBranch, createMemoryBranch, createReplacementMemory } from "@/lib/lab/branches";
import { buildTimelineCheckpoints, buildTraceCheckpoints } from "@/lib/lab/checkpoints";
import type { MemoryTimelineEntry } from "@/lib/timeline";
import type { NormalizedTrace } from "@/lib/traces/types";
import type { EngramMemory } from "@/types";

const indigo: EngramMemory = {
  id: "memory-indigo",
  text: "User loves indigo.",
  importance: 0.8,
  topic: "color",
  region: "hippocampus",
  created_at: "2026-07-13T10:00:00.000Z",
  access_count: 0
};

describe("Engram Lab checkpoints", () => {
  it("builds immutable turn checkpoints from the whole event prefix", () => {
    const entries: MemoryTimelineEntry[] = [
      {
        id: "turn-1",
        kind: "conversation",
        status: "completed",
        userText: "I love indigo.",
        assistantText: "Stored.",
        events: [{ type: "store", memory: indigo }],
        startedAt: "2026-07-13T10:00:00.000Z",
        completedAt: "2026-07-13T10:00:01.000Z"
      },
      {
        id: "turn-2",
        kind: "conversation",
        status: "completed",
        userText: "What color do I love?",
        assistantText: "Indigo.",
        events: [
          { type: "retrieve", query: "favorite color", ids: [indigo.id], accessed: [indigo] },
          { type: "load", ids: [indigo.id] },
          { type: "fire", ids: [indigo.id], region: "prefrontal" }
        ],
        startedAt: "2026-07-13T10:01:00.000Z",
        completedAt: "2026-07-13T10:01:01.000Z"
      }
    ];

    const checkpoints = buildTimelineCheckpoints(entries);

    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[1]?.memories).toEqual([indigo]);
    expect(checkpoints[1]?.loadedMemoryIds).toEqual([indigo.id]);
    expect(checkpoints[1]?.query).toBe("favorite color");
    expect(Object.isFrozen(checkpoints[1])).toBe(true);
  });

  it("creates a checkpoint for every imported trace step", () => {
    const trace: NormalizedTrace = {
      schemaVersion: 1,
      trace: {
        id: "trace-1",
        name: "Memory agent",
        source: { provider: "openai", format: "agents-sdk-export" },
        startedAt: "2026-07-13T10:00:00.000Z"
      },
      steps: [
        {
          id: "step-1",
          index: 0,
          kind: "custom",
          name: "engram.memory",
          status: "completed",
          memoryMappings: [{
            provenance: "observed",
            event: { type: "store", memory: indigo },
            sourcePath: "items[0]",
            note: "Observed store"
          }]
        },
        {
          id: "step-2",
          index: 1,
          kind: "model",
          name: "generation",
          status: "completed",
          memoryMappings: []
        }
      ]
    };

    const checkpoints = buildTraceCheckpoints(trace);

    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[1]?.memories.map((memory) => memory.id)).toEqual([indigo.id]);
    expect(checkpoints[1]?.traceStep?.name).toBe("generation");
  });
});

describe("Engram Lab branches", () => {
  it("quarantines memory without mutating the checkpoint", () => {
    const checkpoint = buildTimelineCheckpoints([{
      id: "turn-1",
      kind: "conversation",
      status: "completed",
      userText: "I love indigo.",
      assistantText: "Stored.",
      events: [{ type: "store", memory: indigo }, { type: "load", ids: [indigo.id] }],
      startedAt: "2026-07-13T10:00:00.000Z"
    }])[0]!;
    const branch = createMemoryBranch({
      checkpoint,
      id: "branch-1",
      createdAt: "2026-07-13T11:00:00.000Z",
      mutations: [{
        id: "mutation-1",
        type: "quarantine",
        memoryId: indigo.id,
        reason: "Test stale memory"
      }]
    });

    const result = applyMemoryBranch(checkpoint, branch);

    expect(result.memories).toEqual([]);
    expect(result.loadedMemoryIds).toEqual([]);
    expect(result.diff.quarantinedMemoryIds).toEqual([indigo.id]);
    expect(checkpoint.memories).toEqual([indigo]);
  });

  it("replaces a memory with an explicit branch-local correction", () => {
    const checkpoint = buildTimelineCheckpoints([{
      id: "turn-1",
      kind: "conversation",
      status: "completed",
      userText: "I live in San Francisco.",
      events: [{ type: "store", memory: { ...indigo, id: "memory-sf", text: "User lives in San Francisco.", topic: "location" } }],
      startedAt: "2026-07-13T10:00:00.000Z"
    }])[0]!;
    const original = checkpoint.memories[0]!;
    const replacement = createReplacementMemory({
      branchId: "branch-oakland",
      original,
      text: "User lives in Oakland.",
      createdAt: "2026-07-13T11:00:00.000Z"
    });
    const branch = createMemoryBranch({
      checkpoint,
      id: "branch-oakland",
      createdAt: "2026-07-13T11:00:00.000Z",
      mutations: [{
        id: "mutation-oakland",
        type: "replace",
        memoryId: original.id,
        replacement,
        reason: "Test current city"
      }]
    });

    const result = applyMemoryBranch(checkpoint, branch);

    expect(result.memories.map((memory) => memory.text)).toEqual(["User lives in Oakland."]);
    expect(result.diff.replacedMemoryIds).toEqual([original.id]);
    expect(result.diff.addedMemoryIds).toEqual([replacement.id]);
  });
});
