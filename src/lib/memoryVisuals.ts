import { regionBounds } from "@/lib/regions";
import type { BrainRegion, EngramEvent, EngramMemory } from "@/types";

export const activeContextCapacity = 10;

export type MemoryVisual = {
  memory: EngramMemory;
  position: [number, number, number];
  color: string;
  isHighImportance: boolean;
};

export const memoryColors: Record<BrainRegion | "importance" | "store", string> = {
  prefrontal: "#00d4ff",
  hippocampus: "#a855f7",
  temporal: "#14f195",
  importance: "#f97316",
  store: "#fbbf24"
};

export function getMemoryVisuals(events: EngramEvent[]): MemoryVisual[] {
  return getVisibleMemories(events).map((memory) => ({
    memory,
    position: getMemoryPosition(memory),
    color: memoryColors[memory.region],
    isHighImportance: memory.importance >= 0.8
  }));
}

export function getVisibleMemories(events: EngramEvent[]): EngramMemory[] {
  const memories = new Map<string, EngramMemory>();

  events
    .slice()
    .reverse()
    .forEach((event) => {
      if (event.type === "init") {
        event.memories.forEach((memory) => memories.set(memory.id, memory));
      }
      if (event.type === "store") {
        event.memory.supersedes?.forEach((id) => {
          const memory = memories.get(id);
          if (memory) memories.set(id, { ...memory, status: "superseded" });
        });
        memories.set(event.memory.id, event.memory);
      }
      if (event.type === "consolidate") {
        event.removed.forEach((id) => memories.delete(id));
        memories.set(event.added.id, event.added);
      }
      if (event.type === "dream_apply") {
        event.proposal.operations.forEach((operation) => {
          const supersededIds = operation.type === "supersede"
            ? operation.supersedeIds ?? operation.sourceIds
            : operation.supersedeIds ?? [];
          supersededIds.forEach((id) => {
            const memory = memories.get(id);
            if (memory) memories.set(id, { ...memory, status: "superseded" });
          });

          if (operation.type === "merge") {
            operation.sourceIds.forEach((id) => memories.delete(id));
          }

          if (operation.result) memories.set(operation.result.id, operation.result);
        });
      }
    });

  return [...memories.values()].filter((memory) => memory.status !== "superseded");
}

export function getDreamEligibleMemories(
  events: EngramEvent[],
  visibleMemories: EngramMemory[] = getVisibleMemories(events)
): EngramMemory[] {
  const supersededIds = new Set<string>();
  const byId = new Map<string, EngramMemory>();

  events.forEach((event) => {
    if (event.type === "store") {
      event.memory.supersedes?.forEach((id) => supersededIds.add(id));
    }
    if (event.type === "dream_apply") {
      event.proposal.operations.forEach((operation) => {
        const operationSupersededIds =
          operation.type === "supersede" ? operation.supersedeIds ?? operation.sourceIds : operation.supersedeIds ?? [];
        operationSupersededIds.forEach((id) => supersededIds.add(id));
      });
    }
  });

  visibleMemories
    .filter((memory) => memory.status !== "superseded")
    .forEach((memory) => byId.set(memory.id, memory));

  events
    .slice()
    .reverse()
    .forEach((event) => {
      if (event.type === "store" && !supersededIds.has(event.memory.id)) {
        byId.set(event.memory.id, event.memory);
      }
    });

  return [...byId.values()]
    .filter((memory) => memory.status !== "superseded")
    .sort(
      (left, right) =>
        Date.parse(left.created_at) - Date.parse(right.created_at) ||
        dreamRegionOrder(left.region) - dreamRegionOrder(right.region)
    );
}

export function getMemoryPosition(memory: Pick<EngramMemory, "id" | "region">): [number, number, number] {
  const bounds = regionBounds[memory.region];
  const seed = hash(memory.id);
  const x = normalizedHash(seed);
  const y = normalizedHash(seed * 31 + 17);
  const z = normalizedHash(seed * 131 + 43);

  return [
    bounds.center[0] + (x - 0.5) * bounds.size[0] * 1.2,
    bounds.center[1] + (y - 0.5) * bounds.size[1] * 1.15,
    bounds.center[2] + (z - 0.5) * bounds.size[2] * 1.25
  ];
}

export function getLatestStoreEvent(events: EngramEvent[]) {
  return events.find((event): event is Extract<EngramEvent, { type: "store" }> => event.type === "store");
}

export function getLatestRetrieveEvent(events: EngramEvent[]) {
  return events.find((event): event is Extract<EngramEvent, { type: "retrieve" }> => event.type === "retrieve");
}

export function getLatestFireEvent(events: EngramEvent[]) {
  return events.find((event): event is Extract<EngramEvent, { type: "fire" }> => event.type === "fire");
}

export function getLatestLoadEvent(events: EngramEvent[]) {
  return events.find((event): event is Extract<EngramEvent, { type: "load" }> => event.type === "load");
}

export function getLatestConsolidateEvent(events: EngramEvent[]) {
  return events.find(
    (event): event is Extract<EngramEvent, { type: "consolidate" }> => event.type === "consolidate"
  );
}

export function getLatestDreamProposal(events: EngramEvent[]) {
  const event = events.find(
    (item): item is Extract<EngramEvent, { type: "dream_start" | "dream_complete" | "dream_apply" | "dream_dismiss" }> =>
      item.type === "dream_start" ||
      item.type === "dream_complete" ||
      item.type === "dream_apply" ||
      item.type === "dream_dismiss"
  );

  return event?.proposal;
}

export function isDreaming(events: EngramEvent[]) {
  const latestDreamEvent = events.find((event) => event.type.startsWith("dream_"));
  return Boolean(
    latestDreamEvent &&
      latestDreamEvent.type !== "dream_complete" &&
      latestDreamEvent.type !== "dream_apply" &&
      latestDreamEvent.type !== "dream_dismiss"
  );
}

export function getActiveMemoryIds(events: EngramEvent[]): string[] {
  const retrieveIndex = events.findIndex((event) => event.type === "retrieve");
  const fireIndex = events.findIndex(
    (event) => event.type === "fire" && event.region === "prefrontal" && event.ids.length > 0
  );

  if (fireIndex === -1) return [];
  if (retrieveIndex !== -1 && retrieveIndex < fireIndex) return [];
  if (hasContextClearingEventBefore(events, fireIndex)) return [];

  const fire = events[fireIndex];
  return fire.type === "fire" ? fire.ids : [];
}

export function getLoadedMemoryIds(events: EngramEvent[]): string[] {
  const retrieveIndex = events.findIndex((event) => event.type === "retrieve");
  const loadIndex = events.findIndex((event) => event.type === "load");

  if (loadIndex === -1) return [];
  if (retrieveIndex !== -1 && retrieveIndex < loadIndex) return [];
  if (hasContextClearingEventBefore(events, loadIndex)) return [];

  const load = events[loadIndex];
  return load.type === "load" ? load.ids : [];
}

export function getActiveContextFill(ids: string[]) {
  const used = Math.min(ids.length, activeContextCapacity);
  return {
    used,
    capacity: activeContextCapacity,
    ratio: used / activeContextCapacity
  };
}

export function getMemoryPositionById(events: EngramEvent[], id: string): [number, number, number] {
  const memory = findMemoryById(events, id);
  return getMemoryPosition(memory ?? { id, region: "hippocampus" });
}

function findMemoryById(events: EngramEvent[], id: string): Pick<EngramMemory, "id" | "region"> | undefined {
  for (const event of events) {
    if (event.type === "store" && event.memory.id === id) return event.memory;
    if (event.type === "consolidate" && event.added.id === id) return event.added;
    if (event.type === "init") {
      const memory = event.memories.find((item) => item.id === id);
      if (memory) return memory;
    }
  }

  return undefined;
}

function hash(value: string): number {
  let next = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    next ^= value.charCodeAt(index);
    next = Math.imul(next, 16777619);
  }
  return next >>> 0;
}

function normalizedHash(value: number): number {
  const next = Math.sin(value) * 10000;
  return next - Math.floor(next);
}

function dreamRegionOrder(region: BrainRegion) {
  switch (region) {
    case "hippocampus":
      return 0;
    case "temporal":
      return 1;
    case "prefrontal":
      return 2;
  }
}

function hasContextClearingEventBefore(events: EngramEvent[], index: number) {
  return events.slice(0, index).some(clearsActiveContext);
}

function clearsActiveContext(event: EngramEvent) {
  if (event.type === "retrieve") return true;
  if (event.type === "store") return (event.decision?.relatedMemoryIds?.length ?? 0) === 0;
  if (event.type !== "plan") return false;

  const relatedCount = event.decision.relatedMemoryIds?.length ?? 0;
  return !(event.decision.operation === "ignore" && relatedCount > 0);
}
