import { describe, expect, it, vi } from "vitest";
import { OpenAIEmbeddingsClient } from "@/lib/semantic/openai-embeddings";
import {
  configuredSemanticLayoutProvider,
  getSemanticLayoutProviderConfig
} from "@/lib/semantic/provider-config";

describe("semantic layout provider config", () => {
  it("defaults to the synchronous lexical provider", () => {
    expect(configuredSemanticLayoutProvider({})).toBe("lexical-fallback");
  });

  it("requires explicit enablement and a key for OpenAI", () => {
    expect(
      configuredSemanticLayoutProvider({
        ENGRAM_SEMANTIC_LAYOUT_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key"
      })
    ).toBe("lexical-fallback");

    expect(
      getSemanticLayoutProviderConfig({
        ENGRAM_SEMANTIC_LAYOUT_PROVIDER: "openai",
        OPENAI_SEMANTIC_LAYOUT_ENABLED: "true",
        OPENAI_API_KEY: "test-key",
        OPENAI_SEMANTIC_LAYOUT_MODEL: "embedding-test"
      })
    ).toEqual({ provider: "openai", apiKey: "test-key", model: "embedding-test" });
  });
});

describe("OpenAIEmbeddingsClient", () => {
  it("validates and restores embedding order by index", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] }
        ]
      })
    );
    const client = new OpenAIEmbeddingsClient({ apiKey: "test-key", fetcher, model: "embedding-test" });

    await expect(client.embed(["first", "second"])).resolves.toEqual([
      [1, 0],
      [0, 1]
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" })
      })
    );
  });

  it("rejects malformed or inconsistent vectors", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: [
          { index: 0, embedding: [1, 0] },
          { index: 1, embedding: [1] }
        ]
      })
    );
    const client = new OpenAIEmbeddingsClient({ apiKey: "test-key", fetcher });

    await expect(client.embed(["first", "second"])).rejects.toThrow("inconsistent dimensions");
  });
});
