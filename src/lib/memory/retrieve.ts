import type { EngramMemory } from "@/types";

export type RetrievalResult = {
  memory: EngramMemory;
  score: number;
};

export type MemoryRetrievalInput = {
  memories: EngramMemory[];
  query: string;
  limit?: number;
};

export type MemoryRetrievalOutput = {
  provider: "lexical" | "semantic" | "fallback";
  reason?: string;
  results: RetrievalResult[];
};

export interface MemoryRetriever {
  readonly provider: MemoryRetrievalOutput["provider"];
  retrieve(input: MemoryRetrievalInput): MemoryRetrievalOutput | Promise<MemoryRetrievalOutput>;
}

const TOKEN_STOPWORDS = new Set([
  "about",
  "and",
  "are",
  "can",
  "did",
  "dislike",
  "does",
  "favorite",
  "favorites",
  "for",
  "from",
  "have",
  "how",
  "love",
  "loved",
  "loves",
  "like",
  "liked",
  "likes",
  "need",
  "needs",
  "note",
  "prefer",
  "preference",
  "preferences",
  "prefers",
  "remember",
  "should",
  "that",
  "the",
  "this",
  "user",
  "want",
  "wants",
  "what",
  "when",
  "where",
  "who",
  "why",
  "with",
  "you",
  "your"
]);

const COLOR_TOKENS = new Set([
  "amber",
  "black",
  "blue",
  "brown",
  "cyan",
  "gold",
  "gray",
  "green",
  "grey",
  "indigo",
  "orange",
  "pink",
  "purple",
  "red",
  "teal",
  "violet",
  "white",
  "yellow"
]);

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

export class LexicalMemoryRetriever implements MemoryRetriever {
  readonly provider = "lexical" as const;

  retrieve(input: MemoryRetrievalInput): MemoryRetrievalOutput {
    return {
      provider: this.provider,
      results: retrieveMemories(input.memories, input.query, input.limit)
    };
  }
}

export const lexicalMemoryRetriever = new LexicalMemoryRetriever();

export function scoreMemory(memory: EngramMemory, queryTokens: Set<string>): number {
  const memoryTokens = tokenize([memory.text, memory.topic].filter(Boolean).join(" "));
  let overlap = 0;

  queryTokens.forEach((token) => {
    if (memoryTokens.has(token)) overlap += 1;
  });

  if (overlap === 0) return 0;

  const lexicalScore = queryTokens.size === 0 ? 0 : overlap / queryTokens.size;
  const importanceBoost = memory.importance * 0.2;
  const accessBoost = Math.min(memory.access_count, 5) * 0.03;
  const colorPreferenceBoost =
    queryTokens.has("color") && memory.topic === "preference" && memoryTokens.has("color") ? 0.2 : 0;

  return lexicalScore + importanceBoost + accessBoost + colorPreferenceBoost;
}

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .flatMap((token) => {
        if (token.length <= 2 || TOKEN_STOPWORDS.has(token)) return [];
        const normalized = normalizeToken(token);
        if (normalized.length <= 2 || TOKEN_STOPWORDS.has(normalized)) return [];
        return COLOR_TOKENS.has(normalized) ? [normalized, "color"] : [normalized];
      })
  );
}

function normalizeToken(token: string): string {
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}
