import type { EngramMemory } from "@/types";

export type MemoryInput = {
  text: string;
  importance?: number;
  topic?: string;
  kind?: string;
  entities?: string[];
  confidence?: number;
  sourceText?: string;
  cluster?: string;
  status?: EngramMemory["status"];
  supersedes?: string[];
  sourceMemoryIds?: string[];
  embedding?: number[];
  now?: string;
};

export type MemorySession = {
  sessionId: string;
  memories: Map<string, EngramMemory>;
  sequence: number;
};

export function createMemorySession(sessionId: string): MemorySession {
  return {
    sessionId,
    memories: new Map(),
    sequence: 0
  };
}

export function createMemory(session: MemorySession, input: MemoryInput): EngramMemory {
  session.sequence += 1;

  const memory: EngramMemory = {
    id: `${session.sessionId}-mem-${session.sequence}`,
    text: input.text.trim(),
    importance: clampImportance(input.importance ?? 0.5),
    topic: input.topic,
    kind: input.kind,
    entities: input.entities,
    confidence: input.confidence === undefined ? undefined : clampImportance(input.confidence),
    sourceText: input.sourceText,
    cluster: input.cluster,
    status: input.status,
    supersedes: input.supersedes,
    sourceMemoryIds: input.sourceMemoryIds,
    region: "hippocampus",
    created_at: input.now ?? new Date().toISOString(),
    access_count: 0,
    embedding: input.embedding
  };

  session.memories.set(memory.id, memory);
  return memory;
}

export function markSuperseded(
  session: MemorySession,
  ids: string[],
  retiredReason: EngramMemory["retiredReason"] = "corrected"
): EngramMemory[] {
  return ids.flatMap((id) => {
    const memory = session.memories.get(id);
    if (!memory || memory.status === "superseded") return [];

    const updated: EngramMemory = {
      ...memory,
      status: "superseded",
      retiredReason
    };
    session.memories.set(id, updated);
    return [updated];
  });
}

export function listMemories(session: MemorySession): EngramMemory[] {
  return [...session.memories.values()];
}

export function getMemory(session: MemorySession, id: string): EngramMemory | undefined {
  return session.memories.get(id);
}

export function markAccessed(
  session: MemorySession,
  ids: string[],
  now = new Date().toISOString()
): EngramMemory[] {
  return ids.flatMap((id) => {
    const memory = session.memories.get(id);
    if (!memory) return [];

    const updated: EngramMemory = {
      ...memory,
      access_count: memory.access_count + 1,
      last_accessed: now
    };
    session.memories.set(id, updated);
    return [updated];
  });
}

export function replaceMemories(
  session: MemorySession,
  removed: string[],
  added: EngramMemory
): EngramMemory {
  markSuperseded(session, removed, "consolidated");
  session.memories.set(added.id, added);
  return added;
}

function clampImportance(value: number): number {
  return Math.min(1, Math.max(0, value));
}
