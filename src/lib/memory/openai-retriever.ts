import {
  lexicalMemoryRetriever,
  type MemoryRetrievalInput,
  type MemoryRetrievalOutput,
  type MemoryRetriever,
  type RetrievalResult
} from "@/lib/memory/retrieve";
import type { EngramMemory } from "@/types";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_MIN_SCORE = 0.32;

export type OpenAISemanticMemoryRetrieverOptions = {
  apiKey?: string;
  fallbackRetriever?: MemoryRetriever;
  fetcher?: typeof fetch;
  minScore?: number;
  model?: string;
};

export class OpenAISemanticMemoryRetriever implements MemoryRetriever {
  readonly provider = "semantic" as const;
  private readonly apiKey?: string;
  private readonly fallbackRetriever: MemoryRetriever;
  private readonly fetcher: typeof fetch;
  private readonly minScore: number;
  private readonly model: string;

  constructor(options: OpenAISemanticMemoryRetrieverOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    this.fallbackRetriever = options.fallbackRetriever ?? lexicalMemoryRetriever;
    this.fetcher = options.fetcher ?? fetch;
    this.minScore = options.minScore ?? DEFAULT_MIN_SCORE;
    this.model =
      options.model ??
      process.env.OPENAI_EMBEDDING_MODEL ??
      process.env.OPENAI_RETRIEVAL_MODEL ??
      DEFAULT_OPENAI_EMBEDDING_MODEL;
  }

  async retrieve(input: MemoryRetrievalInput): Promise<MemoryRetrievalOutput> {
    if (input.memories.length === 0) {
      return {
        provider: this.provider,
        reason: "No memories are available for semantic retrieval.",
        results: []
      };
    }

    if (!this.apiKey) {
      return this.fallback(input, "OpenAI semantic retrieval is enabled but OPENAI_API_KEY is missing.");
    }

    let response: Response;
    try {
      response = await this.fetcher(OPENAI_EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.model,
          input: [input.query, ...input.memories.map(memoryEmbeddingText)]
        })
      });
    } catch (error) {
      return this.fallback(input, `OpenAI semantic retrieval request failed: ${formatError(error)}.`);
    }

    if (!response.ok) {
      return this.fallback(input, `OpenAI semantic retrieval returned HTTP ${response.status}.`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      return this.fallback(input, `OpenAI semantic retrieval response was not JSON: ${formatError(error)}.`);
    }

    try {
      const vectors = parseEmbeddings(payload, input.memories.length + 1);
      const [queryVector, ...memoryVectors] = vectors;

      return {
        provider: this.provider,
        reason: "OpenAI embeddings ranked stored memory traces by semantic similarity.",
        results: rankSemanticResults(input.memories, queryVector, memoryVectors, this.minScore, input.limit)
      };
    } catch (error) {
      return this.fallback(input, `OpenAI semantic retrieval output failed validation: ${formatError(error)}.`);
    }
  }

  private async fallback(input: MemoryRetrievalInput, reason: string): Promise<MemoryRetrievalOutput> {
    const result = await this.fallbackRetriever.retrieve(input);

    return {
      ...result,
      provider: "fallback",
      reason: `${reason} Lexical fallback returned ${result.results.length} result${result.results.length === 1 ? "" : "s"}.`
    };
  }
}

function rankSemanticResults(
  memories: EngramMemory[],
  queryVector: number[],
  memoryVectors: number[][],
  minScore: number,
  limit = 5
): RetrievalResult[] {
  return memories
    .map((memory, index) => {
      const semanticScore = cosineSimilarity(queryVector, memoryVectors[index] ?? []);
      const importanceBoost = memory.importance * 0.04;
      const accessBoost = Math.min(memory.access_count, 5) * 0.01;

      return {
        memory,
        score: semanticScore + importanceBoost + accessBoost
      };
    })
    .filter((result) => result.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function parseEmbeddings(payload: unknown, expectedCount: number): number[][] {
  if (!payload || typeof payload !== "object" || !("data" in payload) || !Array.isArray(payload.data)) {
    throw new Error("Missing embeddings data.");
  }

  if (payload.data.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} embeddings, received ${payload.data.length}.`);
  }

  return payload.data.map((item, index) => {
    if (!item || typeof item !== "object" || !("embedding" in item) || !Array.isArray(item.embedding)) {
      throw new Error(`Embedding ${index} is missing.`);
    }

    if (!item.embedding.every((value: unknown) => typeof value === "number")) {
      throw new Error(`Embedding ${index} contains non-numeric values.`);
    }

    return item.embedding;
  });
}

function cosineSimilarity(a: number[], b: number[]) {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let aMagnitude = 0;
  let bMagnitude = 0;

  for (let index = 0; index < a.length; index += 1) {
    const nextA = a[index] ?? 0;
    const nextB = b[index] ?? 0;
    dot += nextA * nextB;
    aMagnitude += nextA * nextA;
    bMagnitude += nextB * nextB;
  }

  if (aMagnitude === 0 || bMagnitude === 0) return 0;
  return dot / (Math.sqrt(aMagnitude) * Math.sqrt(bMagnitude));
}

function memoryEmbeddingText(memory: EngramMemory) {
  return [memory.text, memory.topic ? `Topic: ${memory.topic}` : undefined].filter(Boolean).join("\n");
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
