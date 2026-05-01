import { describe, expect, it, vi } from "vitest";
import { OpenAISemanticMemoryRetriever } from "@/lib/memory/openai-retriever";
import type { EngramMemory } from "@/types";

describe("OpenAISemanticMemoryRetriever", () => {
  it("does not call OpenAI when there are no memories", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const retriever = new OpenAISemanticMemoryRetriever({ apiKey: "test-key", fetcher });

    const result = await retriever.retrieve({ memories: [], query: "What color do I like?" });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result).toEqual({
      provider: "semantic",
      reason: "No memories are available for semantic retrieval.",
      results: []
    });
  });

  it("ranks memories by OpenAI embedding similarity", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: [
          { embedding: [1, 0, 0] },
          { embedding: [0.98, 0.02, 0] },
          { embedding: [0, 1, 0] }
        ]
      })
    );
    const retriever = new OpenAISemanticMemoryRetriever({
      apiKey: "test-key",
      fetcher,
      minScore: 0.5,
      model: "test-embedding-model"
    });

    const result = await retriever.retrieve({
      query: "What visual style should the app use?",
      memories: [
        memory("style", "User prefers calm, clinical cyberpunk interfaces.", "design"),
        memory("food", "User likes ramen.", "preference")
      ],
      limit: 1
    });

    expect(result.provider).toBe("semantic");
    expect(result.results.map((item) => item.memory.id)).toEqual(["style"]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" })
      })
    );

    const request = fetcher.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({
      model: "test-embedding-model",
      input: expect.arrayContaining([
        "What visual style should the app use?",
        expect.stringContaining("User prefers calm, clinical cyberpunk interfaces.")
      ])
    });
  });

  it("falls back to lexical retrieval when OpenAI returns invalid embeddings", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ embedding: [1, 0] }] }));
    const retriever = new OpenAISemanticMemoryRetriever({ apiKey: "test-key", fetcher });

    const result = await retriever.retrieve({
      query: "favorite color",
      memories: [memory("blue", "User likes the color blue.", "design")]
    });

    expect(result.provider).toBe("fallback");
    expect(result.results.map((item) => item.memory.id)).toEqual(["blue"]);
    expect(result.reason).toContain("failed validation");
  });

  it("falls back to lexical retrieval when no API key is configured", async () => {
    const previousApiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const fetcher = vi.fn<typeof fetch>();

    try {
      const retriever = new OpenAISemanticMemoryRetriever({ apiKey: undefined, fetcher });
      const result = await retriever.retrieve({
        query: "favorite color",
        memories: [memory("blue", "User likes the color blue.", "design")]
      });

      expect(fetcher).not.toHaveBeenCalled();
      expect(result.provider).toBe("fallback");
      expect(result.results.map((item) => item.memory.id)).toEqual(["blue"]);
    } finally {
      if (previousApiKey) {
        process.env.OPENAI_API_KEY = previousApiKey;
      }
    }
  });
});

function memory(id: string, text: string, topic?: string): EngramMemory {
  return {
    id,
    text,
    importance: 0.8,
    topic,
    region: "hippocampus",
    created_at: "2026-04-30T00:00:00.000Z",
    access_count: 0
  };
}
