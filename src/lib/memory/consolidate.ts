import type { EngramMemory } from "@/types";

export function createConsolidatedMemory(args: {
  id: string;
  text: string;
  sourceMemories: EngramMemory[];
  topic?: string;
  entities?: string[];
  confidence?: number;
  now?: string;
}): EngramMemory {
  const importance =
    args.sourceMemories.length === 0
      ? 0.6
      : Math.max(...args.sourceMemories.map((memory) => memory.importance));

  const access_count = args.sourceMemories.reduce(
    (total, memory) => total + memory.access_count,
    0
  );

  return {
    id: args.id,
    text: args.text.trim(),
    importance,
    topic: args.topic ?? mostCommonTopic(args.sourceMemories),
    kind: "semantic",
    entities: args.entities ?? uniqueFlatMap(args.sourceMemories, (memory) => memory.entities ?? []),
    confidence: args.confidence,
    sourceMemoryIds: args.sourceMemories.map((memory) => memory.id),
    status: "active",
    region: "temporal",
    created_at: args.now ?? new Date().toISOString(),
    access_count
  };
}

function mostCommonTopic(memories: EngramMemory[]): string | undefined {
  const counts = new Map<string, number>();

  memories.forEach((memory) => {
    if (!memory.topic) return;
    counts.set(memory.topic, (counts.get(memory.topic) ?? 0) + 1);
  });

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function uniqueFlatMap<T>(items: T[], mapper: (item: T) => string[]): string[] | undefined {
  const values = [...new Set(items.flatMap(mapper))];
  return values.length > 0 ? values : undefined;
}
