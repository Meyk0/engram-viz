import { describe, expect, it } from "vitest";
import {
  getActiveMemoryIds,
  getLatestRetrieveEvent,
  getLatestStoreEvent,
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
