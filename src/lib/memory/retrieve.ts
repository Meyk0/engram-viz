import type { EngramMemory } from "@/types";

export type RetrievalResult = {
  memory: EngramMemory;
  score: number;
};

export function retrieveMemories(
  memories: EngramMemory[],
  query: string,
  limit = 5
): RetrievalResult[] {
  const queryTokens = tokenize(query);

  return memories
    .map((memory) => ({
      memory,
      score: scoreMemory(memory, queryTokens)
    }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function scoreMemory(memory: EngramMemory, queryTokens: Set<string>): number {
  const memoryTokens = tokenize([memory.text, memory.topic].filter(Boolean).join(" "));
  let overlap = 0;

  queryTokens.forEach((token) => {
    if (memoryTokens.has(token)) overlap += 1;
  });

  const lexicalScore = queryTokens.size === 0 ? 0 : overlap / queryTokens.size;
  const importanceBoost = memory.importance * 0.2;
  const accessBoost = Math.min(memory.access_count, 5) * 0.03;

  return lexicalScore + importanceBoost + accessBoost;
}

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2)
  );
}
