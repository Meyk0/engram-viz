import type { BrainRegion } from "@/types";

export type BrainFocusPanel =
  | "timeMachine"
  | "integrity"
  | "lineage"
  | "xray"
  | "retrieval"
  | "context"
  | string
  | null;

export type BrainFocus = {
  memoryIds: string[];
  pulseKey?: string;
  regions: BrainRegion[];
};

type ResolveBrainFocusOptions = {
  activePanel: BrainFocusPanel;
  causalMemoryId?: string;
  contextMemoryIds: string[];
  contextPulseKey: number;
  integrityFindingMemoryIds: string[];
  integrityFocusMemoryIds: string[];
  lineageFocusMemoryId?: string;
  lineageMemoryIds: string[];
  lineageRegions: BrainRegion[];
  regionByMemoryId: ReadonlyMap<string, BrainRegion>;
  retrievalMemoryIds: string[];
  retrievalQuery?: string;
  timeMachineMemoryIds: string[];
  timelineFocus?: {
    memoryIds: string[];
    regions: BrainRegion[];
  };
  timelinePulseKey?: string;
};

export function resolveBrainFocus({
  activePanel,
  causalMemoryId,
  contextMemoryIds,
  contextPulseKey,
  integrityFindingMemoryIds,
  integrityFocusMemoryIds,
  lineageFocusMemoryId,
  lineageMemoryIds,
  lineageRegions,
  regionByMemoryId,
  retrievalMemoryIds,
  retrievalQuery,
  timeMachineMemoryIds,
  timelineFocus,
  timelinePulseKey
}: ResolveBrainFocusOptions): BrainFocus {
  if (timelineFocus) {
    return {
      memoryIds: unique(timelineFocus.memoryIds),
      pulseKey: timelinePulseKey,
      regions: unique(timelineFocus.regions)
    };
  }

  switch (activePanel) {
    case "timeMachine": {
      const memoryIds = unique(timeMachineMemoryIds);
      return {
        memoryIds,
        pulseKey: memoryIds.length > 0 ? `time-machine-${memoryIds.join(".")}` : undefined,
        regions: regionsForMemories(memoryIds, regionByMemoryId)
      };
    }
    case "integrity": {
      const memoryIds = unique(
        integrityFocusMemoryIds.length > 0
          ? integrityFocusMemoryIds
          : integrityFindingMemoryIds
      );
      return {
        memoryIds,
        pulseKey: memoryIds.length > 0 ? `integrity-${memoryIds.join(".")}` : undefined,
        regions: regionsForMemories(memoryIds, regionByMemoryId)
      };
    }
    case "lineage": {
      const memoryIds = unique(lineageMemoryIds);
      return {
        memoryIds,
        pulseKey: lineageFocusMemoryId ? `lineage-${lineageFocusMemoryId}` : undefined,
        regions: unique(lineageRegions)
      };
    }
    case "xray":
      return {
        memoryIds: causalMemoryId ? [causalMemoryId] : [],
        pulseKey: causalMemoryId ? `xray-${causalMemoryId}` : undefined,
        regions: ["prefrontal"]
      };
    case "retrieval": {
      const memoryIds = unique(retrievalMemoryIds);
      return {
        memoryIds,
        pulseKey: retrievalQuery
          ? `retrieval-${retrievalQuery}-${memoryIds.join(".")}`
          : undefined,
        regions: memoryIds.length > 0 ? ["prefrontal"] : []
      };
    }
    case "context": {
      const memoryIds = unique(contextMemoryIds);
      return {
        memoryIds,
        pulseKey: memoryIds.length > 0
          ? `context-${contextPulseKey}-${memoryIds.join(".")}`
          : undefined,
        regions: memoryIds.length > 0 ? ["prefrontal"] : []
      };
    }
    default:
      return { memoryIds: [], regions: [] };
  }
}

function regionsForMemories(
  memoryIds: string[],
  regionByMemoryId: ReadonlyMap<string, BrainRegion>
): BrainRegion[] {
  return unique(
    memoryIds
      .map((id) => regionByMemoryId.get(id))
      .filter((region): region is BrainRegion => Boolean(region))
  );
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
