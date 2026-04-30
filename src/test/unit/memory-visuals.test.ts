import { describe, expect, it } from "vitest";
import {
  getActiveMemoryIds,
  getActiveContextFill,
  getLatestConsolidateEvent,
  getLatestLoadEvent,
  getLatestRetrieveEvent,
  getLatestStoreEvent,
  getMemoryPositionById,
  getMemoryPosition,
  getMemoryVisuals,
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
