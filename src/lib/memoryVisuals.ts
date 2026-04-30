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
        memories.set(event.memory.id, event.memory);
      }
      if (event.type === "consolidate") {
        event.removed.forEach((id) => memories.delete(id));
        memories.set(event.added.id, event.added);
      }
    });

  return [...memories.values()];
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

export function getActiveMemoryIds(events: EngramEvent[]): string[] {
  const fire = getLatestFireEvent(events);
  if (fire?.ids.length) return fire.ids;

  const retrieve = getLatestRetrieveEvent(events);
  return retrieve?.ids ?? [];
}

export function getLoadedMemoryIds(events: EngramEvent[]): string[] {
  return getLatestLoadEvent(events)?.ids ?? [];
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
