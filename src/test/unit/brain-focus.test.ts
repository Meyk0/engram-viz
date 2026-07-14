import { describe, expect, it } from "vitest";
import { resolveBrainFocus } from "@/lib/lab/brain-focus";
import type { BrainRegion } from "@/types";

const regionByMemoryId = new Map<string, BrainRegion>([
  ["memory-new", "hippocampus"],
  ["memory-stable", "temporal"]
]);

const base = {
  activePanel: null,
  contextMemoryIds: [],
  contextPulseKey: 0,
  integrityFindingMemoryIds: [],
  integrityFocusMemoryIds: [],
  lineageMemoryIds: [],
  lineageRegions: [],
  regionByMemoryId,
  retrievalMemoryIds: [],
  timeMachineMemoryIds: []
};

describe("resolveBrainFocus", () => {
  it("gives selected timeline evidence priority over every open panel", () => {
    expect(resolveBrainFocus({
      ...base,
      activePanel: "retrieval",
      retrievalMemoryIds: ["ignored"],
      timelineFocus: {
        memoryIds: ["memory-new", "memory-new"],
        regions: ["hippocampus", "prefrontal", "hippocampus"]
      },
      timelinePulseKey: "timeline-turn-1"
    })).toEqual({
      memoryIds: ["memory-new"],
      pulseKey: "timeline-turn-1",
      regions: ["hippocampus", "prefrontal"]
    });
  });

  it("maps Time Machine memory evidence back to honest anatomical regions", () => {
    expect(resolveBrainFocus({
      ...base,
      activePanel: "timeMachine",
      timeMachineMemoryIds: ["memory-new", "missing", "memory-stable"]
    })).toEqual({
      memoryIds: ["memory-new", "missing", "memory-stable"],
      pulseKey: "time-machine-memory-new.missing.memory-stable",
      regions: ["hippocampus", "temporal"]
    });
  });

  it("uses an explicit integrity selection before report-wide findings", () => {
    expect(resolveBrainFocus({
      ...base,
      activePanel: "integrity",
      integrityFindingMemoryIds: ["memory-new"],
      integrityFocusMemoryIds: ["memory-stable"]
    }).memoryIds).toEqual(["memory-stable"]);
  });

  it("falls back to all integrity finding memories when no finding is selected", () => {
    expect(resolveBrainFocus({
      ...base,
      activePanel: "integrity",
      integrityFindingMemoryIds: ["memory-new", "memory-stable", "memory-new"]
    })).toEqual({
      memoryIds: ["memory-new", "memory-stable"],
      pulseKey: "integrity-memory-new.memory-stable",
      regions: ["hippocampus", "temporal"]
    });
  });

  it("focuses the prefrontal cortex only when retrieval has candidates", () => {
    expect(resolveBrainFocus({
      ...base,
      activePanel: "retrieval",
      retrievalMemoryIds: ["memory-new"],
      retrievalQuery: "What do I like?"
    })).toEqual({
      memoryIds: ["memory-new"],
      pulseKey: "retrieval-What do I like?-memory-new",
      regions: ["prefrontal"]
    });

    expect(resolveBrainFocus({
      ...base,
      activePanel: "retrieval",
      retrievalQuery: "Nothing matched"
    }).regions).toEqual([]);
  });

  it("represents loaded context as prefrontal working memory", () => {
    expect(resolveBrainFocus({
      ...base,
      activePanel: "context",
      contextMemoryIds: ["memory-stable"],
      contextPulseKey: 4
    })).toEqual({
      memoryIds: ["memory-stable"],
      pulseKey: "context-4-memory-stable",
      regions: ["prefrontal"]
    });
  });

  it("keeps causal and lineage focus distinct", () => {
    expect(resolveBrainFocus({
      ...base,
      activePanel: "xray",
      causalMemoryId: "memory-new"
    })).toEqual({
      memoryIds: ["memory-new"],
      pulseKey: "xray-memory-new",
      regions: ["prefrontal"]
    });

    expect(resolveBrainFocus({
      ...base,
      activePanel: "lineage",
      lineageFocusMemoryId: "memory-stable",
      lineageMemoryIds: ["memory-stable", "memory-new"],
      lineageRegions: ["temporal", "hippocampus"]
    })).toEqual({
      memoryIds: ["memory-stable", "memory-new"],
      pulseKey: "lineage-memory-stable",
      regions: ["temporal", "hippocampus"]
    });
  });

  it("returns no focus for unrelated panels", () => {
    expect(resolveBrainFocus({ ...base, activePanel: "help" })).toEqual({
      memoryIds: [],
      regions: []
    });
  });
});
