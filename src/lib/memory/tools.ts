import { createConsolidatedMemory } from "@/lib/memory/consolidate";
import {
  createMemory,
  getMemory,
  listMemories,
  markAccessed,
  replaceMemories,
  type MemorySession
} from "@/lib/memory/store";
import { retrieveMemories } from "@/lib/memory/retrieve";
import type { EngramEvent } from "@/types";

export function storeMemoryTool(
  session: MemorySession,
  input: { text: string; importance?: number; topic?: string; now?: string }
): EngramEvent {
  return {
    type: "store",
    memory: createMemory(session, input)
  };
}

export function retrieveMemoryTool(
  session: MemorySession,
  input: { query: string; limit?: number; now?: string }
): EngramEvent {
  const results = retrieveMemories(listMemories(session), input.query, input.limit);
  const ids = results.map((result) => result.memory.id);
  markAccessed(session, ids, input.now);

  return {
    type: "retrieve",
    query: input.query,
    ids
  };
}

export function consolidateMemoriesTool(
  session: MemorySession,
  input: { ids: string[]; consolidatedText: string; now?: string }
): EngramEvent {
  const sourceMemories = input.ids.flatMap((id) => {
    const memory = getMemory(session, id);
    return memory ? [memory] : [];
  });
  const added = createConsolidatedMemory({
    id: `${session.sessionId}-consolidated-${Date.now()}`,
    text: input.consolidatedText,
    sourceMemories,
    now: input.now
  });

  replaceMemories(session, input.ids, added);

  return {
    type: "consolidate",
    removed: input.ids,
    added
  };
}
