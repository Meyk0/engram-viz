import { describe, expect, it } from "vitest";
import { getAnimatedRegions, getBrainAnimationState } from "@/lib/animations";
import { fixtureEvents, fixtureMemories } from "@/lib/events/fixtures";
import type { EngramEvent } from "@/types";

describe("brain animation state", () => {
  it("routes store events to a hippocampus marker pulse", () => {
    const state = getBrainAnimationState([{ type: "store", memory: fixtureMemories[1] }]);

    expect(state.hippocampusMarker).toBe(1);
    expect(state.regions.hippocampus).toBeGreaterThan(0);
  });

  it("routes retrieve and fire events to visible region pulses", () => {
    const retrieve: EngramEvent = { type: "retrieve", query: "project", ids: ["mem-engram-goal"] };
    const fire: EngramEvent = { type: "fire", ids: ["mem-engram-goal"], region: "temporal" };

    expect(getAnimatedRegions(retrieve)).toEqual(["prefrontal"]);
    expect(getAnimatedRegions(fire)).toEqual(["temporal"]);

    const state = getBrainAnimationState([fire, retrieve]);
    expect(state.regions.temporal).toBeGreaterThan(0);
    expect(state.regions.prefrontal).toBeGreaterThan(0);
  });

  it("does not animate prefrontal for empty retrieval searches", () => {
    expect(getAnimatedRegions({ type: "retrieve", query: "new fact", ids: [] })).toEqual([]);
    expect(getAnimatedRegions({ type: "load", ids: [] })).toEqual([]);
    expect(getAnimatedRegions({ type: "fire", ids: [], region: "prefrontal" })).toEqual([]);

    const state = getBrainAnimationState([{ type: "retrieve", query: "new fact", ids: [] }]);
    expect(state.regions.prefrontal).toBe(0);
  });

  it("marks consolidation as hippocampus-to-memory-region transfer", () => {
    const consolidate = fixtureEvents[4];
    if (consolidate.type !== "consolidate") throw new Error("expected consolidation fixture");
    const state = getBrainAnimationState([consolidate]);

    expect(state.transfer).toMatchObject({
      active: true,
      from: "hippocampus",
      triggerKey: `${consolidate.added.id}-${consolidate.removed.join(".")}`,
      to: "temporal",
      strength: 1
    });
    expect(state.regions.hippocampus).toBeGreaterThan(0);
    expect(state.regions.temporal).toBeGreaterThan(0);
  });

  it("turns decay into subtle global dimming", () => {
    const state = getBrainAnimationState([fixtureEvents[5]]);

    expect(state.decayDimming).toBeGreaterThan(0);
    expect(state.decayDimming).toBeLessThan(0.5);
    expect(Object.values(state.regions).every((pulse) => pulse > 0)).toBe(true);
  });

  it("routes dream review through quiet sleep and hippocampus pulses", () => {
    const event: EngramEvent = {
      type: "dream_review",
      proposalId: "dream-1",
      ids: ["mem-engram-goal", "mem-indigo"]
    };
    const state = getBrainAnimationState([event]);

    expect(getAnimatedRegions(event)).toEqual(["hippocampus"]);
    expect(state.dream.active).toBe(true);
    expect(state.dream.prefrontalQuiet).toBeGreaterThan(0);
    expect(state.dream.reviewPulse).toBeGreaterThan(0);
    expect(state.dream.sleepDimming).toBeGreaterThan(0);
  });

  it("routes dream merge and insight operations to temporal transfer arcs", () => {
    const event: EngramEvent = {
      type: "dream_merge",
      proposalId: "dream-1",
      operation: {
        id: "op-1",
        type: "merge",
        sourceIds: ["mem-a", "mem-b"],
        reason: "Related durable memories.",
        confidence: 0.86,
        result: fixtureMemories[0]
      }
    };

    const state = getBrainAnimationState([event]);

    expect(getAnimatedRegions(event)).toEqual(["hippocampus", "temporal"]);
    expect(state.transfer).toMatchObject({
      active: true,
      from: "hippocampus",
      triggerKey: "dream-1-op-1",
      to: "temporal",
      strength: 1
    });
    expect(state.dream.operation).toBe("merge");
  });
});
