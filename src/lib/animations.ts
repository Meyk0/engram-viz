import type { BrainRegion, EngramEvent } from "@/types";

export const animationTimings = {
  storeMs: 800,
  retrieveMs: 600,
  consolidateMs: 1200,
  decayMs: 5000,
  initMs: 300
} as const;

export type RegionAnimationState = Record<BrainRegion, number>;

export type TransferAnimationState = {
  active: boolean;
  from: BrainRegion;
  to: BrainRegion;
  strength: number;
};

export type BrainAnimationState = {
  regions: RegionAnimationState;
  hippocampusMarker: number;
  transfer: TransferAnimationState;
  decayDimming: number;
};

const regions: BrainRegion[] = ["prefrontal", "hippocampus", "temporal"];

const emptyRegionState: RegionAnimationState = {
  prefrontal: 0,
  hippocampus: 0,
  temporal: 0
};

export function getBrainAnimationState(events: EngramEvent[]): BrainAnimationState {
  const recent = events.slice(0, 6);
  const regionState: RegionAnimationState = { ...emptyRegionState };
  let hippocampusMarker = 0;
  let transfer: TransferAnimationState = {
    active: false,
    from: "hippocampus",
    to: "temporal",
    strength: 0
  };
  let decayDimming = 0;

  recent.forEach((event, index) => {
    const recency = Math.max(0.18, 1 - index * 0.16);

    getAnimatedRegions(event).forEach((region) => {
      regionState[region] = Math.max(regionState[region], getEventWeight(event) * recency);
    });

    if (event.type === "store") {
      hippocampusMarker = Math.max(hippocampusMarker, recency);
    }

    if (event.type === "consolidate") {
      const strength = Math.max(0, 1 - index * 0.2);
      if (strength > transfer.strength) {
        transfer = {
          active: true,
          from: "hippocampus",
          to: event.added.region,
          strength
        };
      }
    }

    if (event.type === "decay") {
      decayDimming = Math.max(decayDimming, 0.42 * recency);
    }
  });

  return {
    regions: regionState,
    hippocampusMarker,
    transfer,
    decayDimming
  };
}

export function getAnimatedRegions(event: EngramEvent): BrainRegion[] {
  switch (event.type) {
    case "store":
      return ["hippocampus"];
    case "retrieve":
      return event.ids.length > 0 ? ["prefrontal"] : [];
    case "fire":
      return event.ids.length > 0 ? [event.region] : [];
    case "consolidate":
      return uniqueRegions(["hippocampus", event.added.region]);
    case "decay":
      return regions;
    case "init":
      return uniqueRegions(event.memories.map((memory) => memory.region));
    case "load":
      return event.ids.length > 0 ? ["prefrontal"] : [];
  }
}

function getEventWeight(event: EngramEvent): number {
  switch (event.type) {
    case "consolidate":
      return 1;
    case "store":
      return 0.92;
    case "retrieve":
    case "fire":
      return 0.82;
    case "decay":
      return 0.24;
    case "init":
    case "load":
      return 0.36;
  }
}

function uniqueRegions(nextRegions: BrainRegion[]): BrainRegion[] {
  return [...new Set(nextRegions)];
}
