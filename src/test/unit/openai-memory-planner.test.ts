import { describe, expect, it, vi } from "vitest";
import { OpenAIMemoryDecisionPlanner, parseOpenAIDecision } from "@/lib/memory/openai-planner";

describe("OpenAIMemoryDecisionPlanner", () => {
  it("requests a strict structured memory decision and accepts valid store output", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        output_text: JSON.stringify({
          operation: "store",
          confidence: 0.91,
          reason: "The user stated a durable UI preference.",
          memoryText: "User prefers deep red interfaces.",
          topic: "design",
          importance: 0.83,
          relatedMemoryIds: ["mem-red"]
        })
      })
    );
    const planner = new OpenAIMemoryDecisionPlanner({
      apiKey: "test-key",
      fetcher,
      minConfidence: 0.65,
      model: "test-model"
    });

    const decision = await planner.decide({
      message: "Deep red interfaces are my thing.",
      relatedMemoryIds: ["mem-red"],
      relatedMemories: [
        {
          id: "mem-red",
          text: "User likes red",
          topic: "design",
          importance: 0.78
        }
      ]
    });

    expect(decision).toEqual({
      provider: "llm",
      operation: "store",
      confidence: 0.91,
      reason: "The user stated a durable UI preference.",
      memoryText: "User prefers deep red interfaces.",
      topic: "design",
      importance: 0.83,
      relatedMemoryIds: ["mem-red"]
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" })
      })
    );

    const request = fetcher.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body));
    expect(body.model).toBe("test-model");
    expect(body.text.format).toMatchObject({
      type: "json_schema",
      name: "engram_memory_decision",
      strict: true
    });
    expect(body.input).toContain("Deep red interfaces are my thing.");
    expect(body.input).toContain("mem-red");
  });

  it("accepts valid ignore output", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        output_text: JSON.stringify({
          operation: "ignore",
          confidence: 0.93,
          reason: "This is a transient command.",
          memoryText: null,
          topic: null,
          importance: null,
          relatedMemoryIds: []
        })
      })
    );
    const planner = new OpenAIMemoryDecisionPlanner({ apiKey: "test-key", fetcher });

    await expect(planner.decide({ message: "Please rewrite this sentence." })).resolves.toEqual({
      provider: "llm",
      operation: "ignore",
      confidence: 0.93,
      reason: "This is a transient command.",
      relatedMemoryIds: []
    });
  });

  it("falls back to deterministic planning for invalid model output", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ output_text: "{bad json" }));
    const planner = new OpenAIMemoryDecisionPlanner({ apiKey: "test-key", fetcher });

    const decision = await planner.decide({ message: "I like the color blue" });

    expect(decision.provider).toBe("fallback");
    expect(decision.operation).toBe("store");
    if (decision.operation !== "store") throw new Error("expected store decision");
    expect(decision.memoryText).toBe("I like the color blue");
    expect(decision.reason).toContain("failed validation");
  });

  it("falls back when model confidence is below threshold", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        output_text: JSON.stringify({
          operation: "ignore",
          confidence: 0.2,
          reason: "Unsure.",
          memoryText: null,
          topic: null,
          importance: null,
          relatedMemoryIds: []
        })
      })
    );
    const planner = new OpenAIMemoryDecisionPlanner({ apiKey: "test-key", fetcher, minConfidence: 0.65 });

    const decision = await planner.decide({ message: "I like the ocean" });

    expect(decision.provider).toBe("fallback");
    expect(decision.operation).toBe("store");
    expect(decision.reason).toContain("below 0.65");
  });

  it("falls back when no API key is configured", async () => {
    const previousApiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const fetcher = vi.fn<typeof fetch>();

    try {
      const planner = new OpenAIMemoryDecisionPlanner({ apiKey: undefined, fetcher });
      const decision = await planner.decide({ message: "What is my favorite color?" });

      expect(fetcher).not.toHaveBeenCalled();
      expect(decision).toMatchObject({
        provider: "fallback",
        operation: "ignore"
      });
    } finally {
      if (previousApiKey) {
        process.env.OPENAI_API_KEY = previousApiKey;
      }
    }
  });
});

describe("parseOpenAIDecision", () => {
  it("rejects store decisions without memory text", () => {
    expect(() =>
      parseOpenAIDecision(
        JSON.stringify({
          operation: "store",
          confidence: 0.8,
          reason: "Missing required memory text.",
          memoryText: null,
          topic: "preference",
          importance: 0.8,
          relatedMemoryIds: []
        }),
        { message: "I like red" }
      )
    ).toThrow();
  });
});
