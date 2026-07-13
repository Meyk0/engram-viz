import { z } from "zod";
import { DEFAULT_SEMANTIC_EMBEDDING_MODEL } from "@/lib/semantic/provider-config";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const MAX_EMBEDDING_INPUTS = 128;

const embeddingsResponseSchema = z.object({
  data: z
    .array(
      z.object({
        index: z.number().int().min(0),
        embedding: z.array(z.number().finite()).min(1).max(8192)
      })
    )
    .max(MAX_EMBEDDING_INPUTS)
});

export type OpenAIEmbeddingsOptions = {
  apiKey?: string;
  fetcher?: typeof fetch;
  model?: string;
};

export class OpenAIEmbeddingsClient {
  readonly model: string;
  private readonly apiKey?: string;
  private readonly fetcher: typeof fetch;

  constructor(options: OpenAIEmbeddingsOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    this.fetcher = options.fetcher ?? fetch;
    this.model =
      options.model ??
      process.env.OPENAI_SEMANTIC_LAYOUT_MODEL ??
      process.env.OPENAI_EMBEDDING_MODEL ??
      DEFAULT_SEMANTIC_EMBEDDING_MODEL;
  }

  async embed(input: readonly string[]): Promise<number[][]> {
    if (input.length === 0) return [];
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is not configured for semantic layout.");
    if (input.length > MAX_EMBEDDING_INPUTS) {
      throw new Error(`Semantic layout embedding input exceeds ${MAX_EMBEDDING_INPUTS} items.`);
    }

    const response = await this.fetcher(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model: this.model, input })
    });

    if (!response.ok) {
      throw new Error(`OpenAI embeddings returned HTTP ${response.status}.`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("OpenAI embeddings response was not valid JSON.");
    }

    const parsed = embeddingsResponseSchema.safeParse(payload);
    if (!parsed.success) throw new Error("OpenAI embeddings response failed validation.");
    if (parsed.data.data.length !== input.length) {
      throw new Error(`Expected ${input.length} embeddings, received ${parsed.data.data.length}.`);
    }

    const ordered = [...parsed.data.data].sort((a, b) => a.index - b.index);
    const dimension = ordered[0]?.embedding.length ?? 0;
    ordered.forEach((item, index) => {
      if (item.index !== index) throw new Error("OpenAI embeddings response contained invalid indices.");
      if (item.embedding.length !== dimension) {
        throw new Error("OpenAI embeddings response contained inconsistent dimensions.");
      }
    });

    return ordered.map((item) => item.embedding);
  }
}

export async function fetchOpenAIEmbeddings(
  input: readonly string[],
  options: OpenAIEmbeddingsOptions = {}
): Promise<number[][]> {
  return new OpenAIEmbeddingsClient(options).embed(input);
}
