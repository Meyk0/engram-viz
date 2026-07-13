"use client";

import { useMemo } from "react";
import type { EngramEvent, EngramMemory } from "@/types";

export function useMemoryStore(events: EngramEvent[]) {
  return useMemo(() => {
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
        if (event.type === "retrieve") {
          event.accessed?.forEach((memory) => memories.set(memory.id, memory));
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

    return [...memories.values()];
  }, [events]);
}
