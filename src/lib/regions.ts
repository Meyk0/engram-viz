import type { BrainRegion, EngramEvent } from "@/types";

export type RegionBounds = {
  center: [number, number, number];
  size: [number, number, number];
  color: string;
  label: string;
  labelAnchor: [number, number, number];
  labelOffset: [number, number, number];
};

export const regionBounds: Record<BrainRegion, RegionBounds> = {
  prefrontal: {
    center: [-0.66, 0.22, 0.34],
    size: [0.34, 0.23, 0.1],
    color: "#00d4ff",
    label: "Prefrontal Cortex",
    labelAnchor: [-0.66, 0.22, 0.4],
    labelOffset: [0.34, 0.07, 0.24]
  },
  hippocampus: {
    center: [-0.18, -0.14, -0.05],
    size: [0.14, 0.09, 0.08],
    color: "#a855f7",
    label: "Hippocampus",
    labelAnchor: [-0.18, -0.14, 0.02],
    labelOffset: [0.24, 0.1, 0.2]
  },
  temporal: {
    center: [-0.1, -0.34, -0.02],
    size: [0.34, 0.16, 0.1],
    color: "#14f195",
    label: "Temporal Cortex",
    labelAnchor: [-0.08, -0.34, 0.04],
    labelOffset: [0.28, -0.04, 0.2]
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
      return event.ids.length > 0 ? [event.region] : [];
    case "consolidate":
      return ["hippocampus", event.added.region];
    case "load":
      return event.ids.length > 0 ? ["prefrontal"] : [];
    case "retrieve":
      return event.ids.length > 0 ? ["prefrontal"] : [];
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
