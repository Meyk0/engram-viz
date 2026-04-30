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
    const state = getBrainAnimationState([fixtureEvents[4]]);

    expect(state.transfer).toMatchObject({
      active: true,
      from: "hippocampus",
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
});
