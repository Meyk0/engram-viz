import { describe, expect, it } from "vitest";
import { resolveSemanticNodes } from "@/components/Brain/SemanticConstellation";
import { getSemanticContextSlots } from "@/components/Brain/SemanticContextRibbon";
import type { SemanticMemoryDescriptor } from "@/lib/semantic/types";

function memory(id: string, status?: "active" | "superseded"): SemanticMemoryDescriptor {
  return {
    id,
    text: `Memory ${id}`,
    region: "hippocampus",
    status
  };
}

describe("Reality Mode scene data", () => {
  it("keeps a single unpositioned memory visible at the constellation origin", () => {
    expect(resolveSemanticNodes([memory("solo")])).toEqual([
      {
        memory: memory("solo"),
        position: [0, 0, 0]
      }
    ]);
  });

  it("uses layout positions and omits superseded memories", () => {
    const layout = {
      nodes: [
        { memoryId: "active", position: [0.2, -0.1, 0.4] as [number, number, number], clusterId: "cluster-a" }
      ],
      edges: []
    };

    expect(resolveSemanticNodes([memory("active"), memory("old", "superseded")], layout)).toEqual([
      {
        memory: memory("active"),
        position: [0.2, -0.1, 0.4]
      }
    ]);
  });

  it("de-duplicates and caps loaded memories while retaining semantic source positions", () => {
    const ids = ["a", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "overflow"];
    const sourcePosition: [number, number, number] = [0.1, 0.2, 0.3];
    const slots = getSemanticContextSlots(ids, {
      nodes: [{ memoryId: "a", position: sourcePosition, clusterId: "cluster-a" }]
    });

    expect(slots).toHaveLength(10);
    expect(slots.map((slot) => slot.memoryId)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
    expect(slots[0]?.sourcePosition).toEqual(sourcePosition);
    expect(slots[1]?.sourcePosition).toBeUndefined();
  });
});
