import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/semantic-layout/route";
import { MAX_SEMANTIC_MEMORIES, semanticLayoutSnapshotSchema } from "@/lib/semantic/schema";
import type { SemanticMemoryDescriptor } from "@/lib/semantic/types";

const ENV_KEYS = [
  "ENGRAM_SEMANTIC_LAYOUT_PROVIDER",
  "SEMANTIC_LAYOUT_PROVIDER",
  "OPENAI_SEMANTIC_LAYOUT_ENABLED",
  "OPENAI_API_KEY",
  "OPENAI_SEMANTIC_LAYOUT_MODEL",
  "OPENAI_EMBEDDING_MODEL"
] as const;

afterEach(() => {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  vi.restoreAllMocks();
});

describe("POST /api/semantic-layout", () => {
  it("returns a validated lexical layout without exposing vectors", async () => {
    const response = await POST(layoutRequest([memory("b"), memory("a")]));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(semanticLayoutSnapshotSchema.parse(body).provider).toBe("lexical-fallback");
    expect(JSON.stringify(body)).not.toContain("embedding");
    expect(JSON.stringify(body)).not.toContain("vector");
  });

  it("uses configured OpenAI embeddings but never returns them", async () => {
    process.env.ENGRAM_SEMANTIC_LAYOUT_PROVIDER = "openai";
    process.env.OPENAI_SEMANTIC_LAYOUT_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_SEMANTIC_LAYOUT_MODEL = "embedding-test";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        data: [
          { index: 0, embedding: [1, 0, 0] },
          { index: 1, embedding: [0.8, 0.2, 0] }
        ]
      })
    );

    const response = await POST(layoutRequest([memory("b"), memory("a")]));
    const body = await response.json();
    const openAIBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));

    expect(response.status).toBe(200);
    expect(body.provider).toBe("openai");
    expect(body.model).toBe("embedding-test");
    expect(openAIBody.input[0]).toContain("Memory a");
    expect(allKeys(body)).not.toContain("embedding");
    expect(allKeys(body)).not.toContain("vector");
  });

  it("falls back cleanly when the embedding provider fails", async () => {
    process.env.ENGRAM_SEMANTIC_LAYOUT_PROVIDER = "openai";
    process.env.OPENAI_SEMANTIC_LAYOUT_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network unavailable"));

    const response = await POST(layoutRequest([memory("a"), memory("b")]));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.provider).toBe("lexical-fallback");
    expect(body).not.toHaveProperty("model");
  });

  it("rejects invalid and oversized requests", async () => {
    const duplicateResponse = await POST(layoutRequest([memory("a"), memory("a")]));
    expect(duplicateResponse.status).toBe(400);

    const oversizedResponse = await POST(
      layoutRequest(Array.from({ length: MAX_SEMANTIC_MEMORIES + 1 }, (_, index) => memory(String(index))))
    );
    expect(oversizedResponse.status).toBe(400);

    const contentLengthResponse = await POST(
      new Request("http://localhost/api/semantic-layout", {
        method: "POST",
        headers: { "content-length": "999999" },
        body: "{}"
      })
    );
    expect(contentLengthResponse.status).toBe(413);
  });
});

function layoutRequest(memories: SemanticMemoryDescriptor[]) {
  return new Request("http://localhost/api/semantic-layout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memories })
  });
}

function memory(id: string): SemanticMemoryDescriptor {
  return {
    id,
    text: `Memory ${id} describes a neural visualization project.`,
    topic: "visualization",
    region: "hippocampus",
    status: "active"
  };
}

function allKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(allKeys);
  return Object.entries(value).flatMap(([key, child]) => [key, ...allKeys(child)]);
}
