import { describe, expect, it } from "vitest";
import { BRAIN_BASE_ASSET_PATH, getRegionFromMeshName, regionMeshNames } from "@/lib/brainAsset";
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

  it("keeps region patches compact enough to read as anatomical highlights", () => {
    Object.values(regionBounds).forEach((bounds) => {
      expect(Math.max(...bounds.size)).toBeLessThanOrEqual(0.4);
    });
  });

  it("maps GLB mesh names to the three honest regions", () => {
    expect(BRAIN_BASE_ASSET_PATH).toBe("/lobes_of_the_cerebrum.glb");
    expect(regionMeshNames).toEqual({
      prefrontal: "prefrontal_region",
      hippocampus: "hippocampus_region",
      temporal: "temporal_region"
    });
    expect(getRegionFromMeshName("prefrontal_region")).toBe("prefrontal");
    expect(getRegionFromMeshName("hippocampus_region.001")).toBe("hippocampus");
    expect(getRegionFromMeshName("Brain_Part_01")).toBeUndefined();
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
