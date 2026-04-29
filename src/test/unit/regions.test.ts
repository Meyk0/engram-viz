import { describe, expect, it } from "vitest";
import { fixtureEvents } from "@/lib/events/fixtures";
import { getEventRegions, getRegionColor, getRegionPulseStrength, regionBounds } from "@/lib/regions";

describe("region metadata", () => {
  it("defines only the three honest memory regions", () => {
    expect(Object.keys(regionBounds).sort()).toEqual(["hippocampus", "prefrontal", "temporal"]);
  });

  it("maps every region to a cyberpunk palette color", () => {
    expect(getRegionColor("prefrontal")).toBe("#00d4ff");
    expect(getRegionColor("hippocampus")).toBe("#a855f7");
    expect(getRegionColor("temporal")).toBe("#3b82f6");
  });
});

describe("event to region mapping", () => {
  it("routes store events to the memory home region", () => {
    expect(getEventRegions(fixtureEvents[1])).toEqual(["hippocampus"]);
  });

  it("routes retrieve events to active context", () => {
    expect(getEventRegions(fixtureEvents[2])).toEqual(["prefrontal"]);
  });

  it("routes consolidation through hippocampus and temporal memory", () => {
    expect(getEventRegions(fixtureEvents[4])).toEqual(["hippocampus", "temporal"]);
  });

  it("computes pulse strength from recent events", () => {
    expect(getRegionPulseStrength(fixtureEvents.slice(1, 5).reverse(), "prefrontal")).toBeGreaterThan(0);
    expect(getRegionPulseStrength(fixtureEvents.slice(1, 5).reverse(), "temporal")).toBeGreaterThan(0);
  });
});
