import { describe, expect, it, vi } from "vitest";
import { OpenAIChatProvider } from "@/lib/chat/providers/openai";
import type { EngramMemory } from "@/types";

describe("OpenAIChatProvider", () => {
  it("sends prior history, current message, and retrieved memories to the Responses API", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        output_text: "I connected that to your saved design preference."
      })
    );
    const provider = new OpenAIChatProvider(fetcher, "test-key", "test-model");
    const controller = new AbortController();

    const chunks = [];
    for await (const chunk of provider.streamTurn({
      message: "What design style do I prefer?",
      history: [{ role: "user", content: "remember that I like cyberpunk medical interfaces" }],
      retrievedMemories: [memory("mem-style", "I like restrained cyberpunk medical interfaces.")],
      signal: controller.signal,
      storedMemories: [],
      turnIntent: "memory_question"
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { kind: "text", delta: "I connected that to your saved design preference." },
      { kind: "done" }
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "Content-Type": "application/json"
        })
      })
    );

    const request = fetcher.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body));

    expect(body.model).toBe("test-model");
    expect(request?.signal).toBe(controller.signal);
    expect(body.input).toEqual([
      { role: "user", content: "remember that I like cyberpunk medical interfaces" },
      {
        role: "user",
        content: expect.stringContaining("I like restrained cyberpunk medical interfaces.")
      }
    ]);
    expect(body.input[1].content).toContain("What design style do I prefer?");
    expect(body.input[1].content).toContain("Turn intent: memory_question");
  });

  it("yields an error chunk when no API key is configured", async () => {
    const provider = new OpenAIChatProvider(vi.fn<typeof fetch>(), undefined, "test-model");
    const chunks = [];

    for await (const chunk of provider.streamTurn({
      message: "hello",
      history: [],
      retrievedMemories: []
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      {
        kind: "error",
        message: "OpenAI provider is selected, but OPENAI_API_KEY is not configured."
      }
    ]);
  });
});

function memory(id: string, text: string): EngramMemory {
  return {
    id,
    text,
    importance: 0.8,
    topic: "design",
    region: "hippocampus",
    created_at: "2026-04-29T00:00:00.000Z",
    access_count: 0
  };
}
