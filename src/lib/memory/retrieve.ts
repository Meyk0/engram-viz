import type { EngramMemory, MemoryRetrievalBasis, MemoryRetrievalTrace } from "@/types";

export type RetrievalResult = {
  memory: EngramMemory;
  score: number;
  similarity?: number;
  basis?: MemoryRetrievalBasis;
  components?: NonNullable<NonNullable<MemoryRetrievalTrace["matches"]>[number]["components"]>;
};

export type RetrievalCandidate = RetrievalResult & {
  eligible: boolean;
  selected: boolean;
  filterReason?: string;
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
  candidates?: RetrievalCandidate[];
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
  return inspectLexicalMemories(memories, query, limit).results;
}

export function inspectLexicalMemories(
  memories: EngramMemory[],
  query: string,
  limit = 5
): { candidates: RetrievalCandidate[]; results: RetrievalResult[] } {
  const queryTokens = tokenize(query);
  const candidates = memories
    .map((memory, sourceIndex) => {
      const eligible = memory.status !== "superseded";
      const scored = scoreMemoryWithComponents(memory, queryTokens);
      return {
        memory,
        score: eligible ? scored.score : 0,
        basis: "lexical" as const,
        components: scored.components,
        eligible,
        selected: false,
        ...(eligible ? {} : { filterReason: "Superseded memory" }),
        sourceIndex
      };
    })
    .sort((left, right) => {
      if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
      return right.score - left.score || left.sourceIndex - right.sourceIndex;
    })
    .map(({ sourceIndex: _sourceIndex, ...candidate }, index) => ({
      ...candidate,
      selected: candidate.eligible && candidate.score > 0 && index < limit
    }));

  return {
    candidates,
    results: candidates.filter((candidate) => candidate.selected)
  };
}

export class LexicalMemoryRetriever implements MemoryRetriever {
  readonly provider = "lexical" as const;

  retrieve(input: MemoryRetrievalInput): MemoryRetrievalOutput {
    const inspection = inspectLexicalMemories(input.memories, input.query, input.limit);
    return {
      provider: this.provider,
      results: inspection.results,
      candidates: inspection.candidates
    };
  }
}

export const lexicalMemoryRetriever = new LexicalMemoryRetriever();

export function scoreMemory(memory: EngramMemory, queryTokens: Set<string>): number {
  return scoreMemoryWithComponents(memory, queryTokens).score;
}

export function scoreMemoryWithComponents(
  memory: EngramMemory,
  queryTokens: Set<string>
): {
  score: number;
  components: NonNullable<RetrievalResult["components"]>;
} {
  const memoryTokens = tokenize([memory.text, memory.topic].filter(Boolean).join(" "));
  let overlap = 0;

  queryTokens.forEach((token) => {
    if (memoryTokens.has(token)) overlap += 1;
  });

  if (overlap === 0) {
    return {
      score: 0,
      components: { lexical: 0, importance: 0, access: 0, guardrail: 0 }
    };
  }

  const lexicalScore = queryTokens.size === 0 ? 0 : overlap / queryTokens.size;
  const importanceBoost = memory.importance * 0.2;
  const accessBoost = Math.min(memory.access_count, 5) * 0.03;
  const colorPreferenceBoost =
    queryTokens.has("color") && memory.topic === "preference" && memoryTokens.has("color") ? 0.2 : 0;

  return {
    score: lexicalScore + importanceBoost + accessBoost + colorPreferenceBoost,
    components: {
      lexical: lexicalScore,
      importance: importanceBoost,
      access: accessBoost,
      guardrail: colorPreferenceBoost
    }
  };
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
