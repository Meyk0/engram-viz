import type { BrainRegion, EngramEvent } from "@/types";

export type RegionBounds = {
  center: [number, number, number];
  size: [number, number, number];
  color: string;
  label: string;
};

export const regionBounds: Record<BrainRegion, RegionBounds> = {
  prefrontal: {
    center: [0, 0.58, 0.78],
    size: [0.9, 0.45, 0.38],
    color: "#00d4ff",
    label: "Prefrontal Cortex"
  },
  hippocampus: {
    center: [0, -0.28, 0.18],
    size: [0.58, 0.28, 0.46],
    color: "#a855f7",
    label: "Hippocampus"
  },
  temporal: {
    center: [0.68, -0.08, -0.12],
    size: [0.5, 0.48, 0.54],
    color: "#3b82f6",
    label: "Temporal Cortex"
  }
};

export function getRegionColor(region: BrainRegion): string {
  return regionBounds[region].color;
}

export function getEventRegions(event: EngramEvent): BrainRegion[] {
  switch (event.type) {
    case "store":
      return [event.memory.region];
    case "fire":
      return [event.region];
    case "consolidate":
      return ["hippocampus", event.added.region];
    case "load":
    case "retrieve":
      return ["prefrontal"];
    case "decay":
      return ["hippocampus", "temporal"];
    case "init":
      return [...new Set(event.memories.map((memory) => memory.region))];
  }
}

export function getRegionPulseStrength(events: EngramEvent[], region: BrainRegion): number {
  const recent = events.slice(0, 6);
  return recent.reduce((strength, event, index) => {
    if (!getEventRegions(event).includes(region)) return strength;
    const eventWeight = event.type === "consolidate" ? 1 : 0.72;
    return Math.max(strength, eventWeight * Math.max(0.18, 1 - index * 0.16));
  }, 0);
}
