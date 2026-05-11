import { describe, expect, it } from "vitest";
import {
  getActiveMemoryIds,
  getActiveContextFill,
  getDreamEligibleMemories,
  getLatestConsolidateEvent,
  getLatestDreamProposal,
  getLatestLoadEvent,
  getLatestRetrieveEvent,
  getLatestStoreEvent,
  getLoadedMemoryIds,
  getMemoryPositionById,
  getMemoryPosition,
  getMemoryVisuals,
  isDreaming,
  memoryColors
} from "@/lib/memoryVisuals";
import type { EngramEvent, EngramMemory } from "@/types";

describe("memory visual lifecycle", () => {
  it("turns stored memories into deterministic hippocampus neurons", () => {
    const memory = makeMemory("mem-style", "hippocampus");
    const events: EngramEvent[] = [{ type: "store", memory }];

    const visuals = getMemoryVisuals(events);

    expect(visuals).toHaveLength(1);
    expect(visuals[0]).toMatchObject({
      memory,
      color: memoryColors.hippocampus,
      isHighImportance: true
    });
    expect(getMemoryPosition(memory)).toEqual(getMemoryPosition(memory));
  });

  it("applies consolidation by replacing source memories with the semantic memory", () => {
    const rawA = makeMemory("mem-a", "hippocampus");
    const rawB = makeMemory("mem-b", "hippocampus");
    const semantic = makeMemory("mem-semantic", "temporal");
    const events: EngramEvent[] = [
      { type: "consolidate", removed: [rawA.id, rawB.id], added: semantic },
      { type: "store", memory: rawB },
      { type: "store", memory: rawA }
    ];

    expect(getMemoryVisuals(events).map((visual) => visual.memory.id)).toEqual([semantic.id]);
    expect(getMemoryVisuals(events)[0]?.color).toBe(memoryColors.temporal);
  });

  it("finds the newest store, retrieve, and active fire ids", () => {
    const memory = makeMemory("mem-style", "hippocampus");
    const events: EngramEvent[] = [
      { type: "fire", region: "prefrontal", ids: [memory.id] },
      { type: "retrieve", query: "style", ids: [memory.id] },
      { type: "store", memory }
    ];

    expect(getLatestStoreEvent(events)?.memory.id).toBe(memory.id);
    expect(getLatestRetrieveEvent(events)?.query).toBe("style");
    expect(getActiveMemoryIds(events)).toEqual([memory.id]);
  });

  it("tracks active context load ids and finite capacity", () => {
    const events: EngramEvent[] = [{ type: "load", ids: ["a", "b", "c"] }];

    expect(getLatestLoadEvent(events)?.ids).toEqual(["a", "b", "c"]);
    expect(getActiveContextFill(["a", "b", "c"])).toEqual({
      used: 3,
      capacity: 10,
      ratio: 0.3
    });
    expect(getActiveContextFill(Array.from({ length: 12 }, (_, index) => `mem-${index}`))).toEqual({
      used: 10,
      capacity: 10,
      ratio: 1
    });
  });

  it("reserves active context for prefrontal loads and clears it after empty searches", () => {
    const events: EngramEvent[] = [
      { type: "fire", region: "hippocampus", ids: ["new-store"] },
      { type: "store", memory: makeMemory("new-store", "hippocampus") }
    ];

    expect(getActiveMemoryIds(events)).toEqual([]);
    expect(getLoadedMemoryIds(events)).toEqual([]);

    const loadedEvents: EngramEvent[] = [
      { type: "fire", region: "prefrontal", ids: ["mem-a"] },
      { type: "load", ids: ["mem-a"] },
      { type: "retrieve", query: "red", ids: ["mem-a"] }
    ];

    expect(getActiveMemoryIds(loadedEvents)).toEqual(["mem-a"]);
    expect(getLoadedMemoryIds(loadedEvents)).toEqual(["mem-a"]);

    const staleContextEvents: EngramEvent[] = [
      { type: "retrieve", query: "unmatched new fact", ids: [] },
      ...loadedEvents
    ];

    expect(getActiveMemoryIds(staleContextEvents)).toEqual([]);
    expect(getLoadedMemoryIds(staleContextEvents)).toEqual([]);

    const storeOnlyEvents: EngramEvent[] = [
      { type: "fire", region: "hippocampus", ids: ["mem-new"] },
      { type: "store", memory: makeMemory("mem-new", "hippocampus") },
      ...loadedEvents
    ];

    expect(getActiveMemoryIds(storeOnlyEvents)).toEqual([]);
    expect(getLoadedMemoryIds(storeOnlyEvents)).toEqual([]);

    const mixedTurnEvents: EngramEvent[] = [
      {
        type: "store",
        memory: makeMemory("mem-related-new", "hippocampus"),
        decision: {
          stage: "memory",
          operation: "store",
          provider: "llm",
          confidence: 0.91,
          reason: "preference",
          relatedMemoryIds: ["mem-a"]
        }
      },
      ...loadedEvents
    ];

    expect(getActiveMemoryIds(mixedTurnEvents)).toEqual(["mem-a"]);
    expect(getLoadedMemoryIds(mixedTurnEvents)).toEqual(["mem-a"]);
  });

  it("keeps retrieved memories active after the final skip-plan event", () => {
    const events: EngramEvent[] = [
      {
        type: "plan",
        decision: {
          stage: "memory",
          operation: "ignore",
          provider: "llm",
          confidence: 0.92,
          reason: "Question turns are not stored.",
          relatedMemoryIds: ["mem-indigo"]
        }
      },
      { type: "fire", region: "prefrontal", ids: ["mem-indigo"] },
      { type: "load", ids: ["mem-indigo"] },
      { type: "retrieve", query: "what is my favorite color?", ids: ["mem-indigo"] }
    ];

    expect(getActiveMemoryIds(events)).toEqual(["mem-indigo"]);
    expect(getLoadedMemoryIds(events)).toEqual(["mem-indigo"]);
  });

  it("finds consolidation events and source positions from prior memory events", () => {
    const rawA = makeMemory("mem-a", "hippocampus");
    const rawB = makeMemory("mem-b", "hippocampus");
    const semantic = makeMemory("mem-semantic", "temporal");
    const events: EngramEvent[] = [
      { type: "consolidate", removed: [rawA.id, rawB.id], added: semantic },
      { type: "store", memory: rawB },
      { type: "store", memory: rawA }
    ];

    expect(getLatestConsolidateEvent(events)?.added.id).toBe(semantic.id);
    expect(getMemoryPositionById(events, rawA.id)).toEqual(getMemoryPosition(rawA));
    expect(getMemoryPositionById(events, "missing-memory")).toEqual(
      getMemoryPosition({ id: "missing-memory", region: "hippocampus" })
    );
  });

  it("keeps dream proposals non-mutating until apply", () => {
    const rawA = makeMemory("mem-a", "hippocampus");
    const rawB = makeMemory("mem-b", "hippocampus");
    const semantic = makeMemory("mem-semantic", "temporal");
    const proposal = {
      id: "dream-1",
      provider: "deterministic" as const,
      status: "proposed" as const,
      reason: "Merge related memories.",
      created_at: "2026-05-11T12:00:00.000Z",
      operations: [
        {
          id: "dream-op-1",
          type: "merge" as const,
          sourceIds: [rawA.id, rawB.id],
          supersedeIds: [rawA.id, rawB.id],
          result: semantic,
          reason: "Duplicate memories.",
          confidence: 0.86
        }
      ]
    };
    const proposalEvents: EngramEvent[] = [
      { type: "dream_complete", proposal },
      { type: "dream_merge", proposalId: proposal.id, operation: proposal.operations[0] },
      { type: "dream_review", proposalId: proposal.id, ids: [rawA.id, rawB.id] },
      { type: "dream_start", proposal },
      { type: "store", memory: rawB },
      { type: "store", memory: rawA }
    ];

    expect(getMemoryVisuals(proposalEvents).map((visual) => visual.memory.id).sort()).toEqual([rawA.id, rawB.id]);
    expect(getLatestDreamProposal(proposalEvents)).toBe(proposal);
    expect(isDreaming(proposalEvents)).toBe(false);

    const appliedEvents: EngramEvent[] = [{ type: "dream_apply", proposal }, ...proposalEvents];

    expect(getMemoryVisuals(appliedEvents).map((visual) => visual.memory.id)).toEqual([semantic.id]);
  });

  it("keeps historical stored traces eligible for dream review after consolidation", () => {
    const rawA = makeMemory("mem-a", "hippocampus");
    const rawB = makeMemory("mem-b", "hippocampus");
    const rawC = makeMemory("mem-c", "hippocampus");
    const semantic = {
      ...makeMemory("mem-semantic", "temporal"),
      sourceMemoryIds: [rawA.id, rawB.id, rawC.id]
    };
    const events: EngramEvent[] = [
      { type: "consolidate", removed: [rawA.id, rawB.id, rawC.id], added: semantic },
      { type: "store", memory: rawC },
      { type: "store", memory: rawB },
      { type: "store", memory: rawA }
    ];

    expect(getMemoryVisuals(events).map((visual) => visual.memory.id)).toEqual([semantic.id]);
    expect(getDreamEligibleMemories(events).map((memory) => memory.id)).toEqual([
      rawA.id,
      rawB.id,
      rawC.id,
      semantic.id
    ]);
  });
});

function makeMemory(id: string, region: EngramMemory["region"]): EngramMemory {
  return {
    id,
    text: `${id} text`,
    importance: 0.84,
    topic: "test",
    region,
    created_at: "2026-04-29T00:00:00.000Z",
    access_count: 0
  };
}
