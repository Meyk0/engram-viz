import type { BrainRegion, EngramEvent } from "@/types";

export type RegionBounds = {
  center: [number, number, number];
  size: [number, number, number];
  color: string;
  label: string;
  labelOffset: [number, number, number];
};

export const regionBounds: Record<BrainRegion, RegionBounds> = {
  prefrontal: {
    center: [-0.58, 0.24, 0.42],
    size: [0.4, 0.27, 0.12],
    color: "#00d4ff",
    label: "Prefrontal Cortex",
    labelOffset: [-0.02, 0.2, 0.04]
  },
  hippocampus: {
    center: [0.18, -0.2, 0.44],
    size: [0.16, 0.1, 0.08],
    color: "#a855f7",
    label: "Hippocampus",
    labelOffset: [0.02, 0.14, 0.04]
  },
  temporal: {
    center: [0.28, -0.34, 0.32],
    size: [0.4, 0.19, 0.1],
    color: "#3b82f6",
    label: "Temporal Cortex",
    labelOffset: [-0.02, 0.18, 0.03]
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
