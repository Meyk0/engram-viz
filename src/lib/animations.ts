import type { BrainRegion, DreamOperationType, EngramEvent } from "@/types";

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
  triggerKey?: string;
  to: BrainRegion;
  strength: number;
};

export type BrainAnimationState = {
  regions: RegionAnimationState;
  hippocampusMarker: number;
  transfer: TransferAnimationState;
  decayDimming: number;
  dream: {
    active: boolean;
    operation?: DreamOperationType;
    operationKey?: string;
    prefrontalQuiet: number;
    reviewPulse: number;
    sleepDimming: number;
    supersedePulse: number;
  };
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
    triggerKey: undefined,
    to: "temporal",
    strength: 0
  };
  let decayDimming = 0;
  let dreamOperation: DreamOperationType | undefined;
  let dreamOperationKey: string | undefined;
  let prefrontalQuiet = 0;
  let reviewPulse = 0;
  let sleepDimming = 0;
  let supersedePulse = 0;

  recent.forEach((event, index) => {
    const recency = Math.max(0.18, 1 - index * 0.16);
    const eventWeight = getEventWeight(event);

    getAnimatedRegions(event).forEach((region) => {
      regionState[region] = Math.max(regionState[region], eventWeight * recency);
    });

    if (event.type === "store" || event.type === "dream_start" || event.type === "dream_review") {
      hippocampusMarker = Math.max(hippocampusMarker, recency);
    }

    if (event.type === "consolidate") {
      const strength = Math.max(0, 1 - index * 0.2);
      if (strength > transfer.strength) {
        transfer = {
          active: true,
          from: "hippocampus",
          triggerKey: `${event.added.id}-${event.removed.join(".")}`,
          to: event.added.region,
          strength
        };
      }
    }

    if (event.type === "decay") {
      decayDimming = Math.max(decayDimming, 0.42 * recency);
    }

    if (isDreamEvent(event)) {
      prefrontalQuiet = Math.max(prefrontalQuiet, 0.75 * recency);
      sleepDimming = Math.max(sleepDimming, 0.58 * recency);
      reviewPulse = Math.max(reviewPulse, getDreamReviewWeight(event) * recency);
    }

    if (event.type === "dream_merge" || event.type === "dream_insight") {
      const strength = Math.max(0, 1 - index * 0.2);
      if (strength > transfer.strength) {
        transfer = {
          active: true,
          from: "hippocampus",
          triggerKey: `${event.proposalId}-${event.operation.id}`,
          to: "temporal",
          strength
        };
      }
      dreamOperation = event.operation.type;
      dreamOperationKey = `${event.proposalId}-${event.operation.id}`;
    }

    if (event.type === "dream_supersede") {
      dreamOperation = event.operation.type;
      dreamOperationKey = `${event.proposalId}-${event.operation.id}`;
      supersedePulse = Math.max(supersedePulse, recency);
    }
  });

  return {
    regions: regionState,
    hippocampusMarker,
    transfer,
    decayDimming,
    dream: {
      active: sleepDimming > 0,
      operation: dreamOperation,
      operationKey: dreamOperationKey,
      prefrontalQuiet,
      reviewPulse,
      sleepDimming,
      supersedePulse
    }
  };
}

export function getAnimatedRegions(event: EngramEvent): BrainRegion[] {
  switch (event.type) {
    case "store":
      return ["hippocampus"];
    case "plan":
      return [];
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
    case "dream_start":
    case "dream_review":
    case "dream_complete":
    case "dream_apply":
    case "dream_dismiss":
      return ["hippocampus"];
    case "dream_merge":
    case "dream_insight":
      return ["hippocampus", "temporal"];
    case "dream_supersede":
      return ["hippocampus", "temporal"];
  }
}

function getEventWeight(event: EngramEvent): number {
  switch (event.type) {
    case "consolidate":
      return 1;
    case "store":
      return 0.92;
    case "plan":
      return 0;
    case "retrieve":
    case "fire":
      return 0.82;
    case "decay":
      return 0.24;
    case "init":
    case "load":
      return 0.36;
    case "dream_start":
    case "dream_review":
    case "dream_complete":
      return 0.7;
    case "dream_merge":
    case "dream_insight":
      return 0.92;
    case "dream_supersede":
      return 0.82;
    case "dream_apply":
      return 0.88;
    case "dream_dismiss":
      return 0.42;
  }
}

function getDreamReviewWeight(event: EngramEvent) {
  switch (event.type) {
    case "dream_start":
    case "dream_review":
      return 1;
    case "dream_merge":
    case "dream_supersede":
    case "dream_insight":
      return 0.76;
    case "dream_complete":
    case "dream_apply":
    case "dream_dismiss":
      return 0.48;
    default:
      return 0;
  }
}

function isDreamEvent(event: EngramEvent) {
  return event.type.startsWith("dream_");
}

function uniqueRegions(nextRegions: BrainRegion[]): BrainRegion[] {
  return [...new Set(nextRegions)];
}
