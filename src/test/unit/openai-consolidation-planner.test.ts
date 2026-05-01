import { describe, expect, it, vi } from "vitest";
import {
  OpenAIConsolidationPlanner,
  parseOpenAIConsolidationDecision
} from "@/lib/memory/openai-consolidation-planner";
import type { EngramMemory } from "@/types";

describe("OpenAIConsolidationPlanner", () => {
  it("does not call OpenAI when deterministic guardrails find no eligible candidate", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const planner = new OpenAIConsolidationPlanner({ apiKey: "test-key", fetcher });

    const decision = await planner.decide({
      memories: [makeMemory({ id: "mem-a", text: "User likes red", topic: "design" })]
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(decision).toMatchObject({
      provider: "deterministic",
      operation: "skip"
    });
  });

  it("requests a strict structured consolidation decision and accepts valid output", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        output_text: JSON.stringify({
          operation: "consolidate",
          confidence: 0.92,
          reason: "Both memories describe stable visual design preferences.",
          ids: ["mem-a", "mem-b"],
          consolidatedText: "User prefers restrained red medical interface design."
        })
      })
    );
    const planner = new OpenAIConsolidationPlanner({
      apiKey: "test-key",
      fetcher,
      minConfidence: 0.7,
      model: "test-model"
    });

    const decision = await planner.decide({
      memories: [
        makeMemory({ id: "mem-a", text: "User prefers red interface accents", topic: "design" }),
        makeMemory({ id: "mem-b", text: "User likes restrained medical UI", topic: "design" }),
        makeMemory({ id: "mem-c", text: "User likes the ocean", topic: "preference" })
      ]
    });

    expect(decision).toEqual({
      provider: "llm",
      operation: "consolidate",
      confidence: 0.92,
      reason: "Both memories describe stable visual design preferences.",
      ids: ["mem-a", "mem-b"],
      consolidatedText: "User prefers restrained red medical interface design."
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
      name: "engram_consolidation_decision",
      strict: true
    });
    expect(body.input).toContain("mem-a");
    expect(body.input).toContain("User likes restrained medical UI");
    expect(body.input).not.toContain("mem-c");
  });

  it("accepts valid skip output for eligible memories", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        output_text: JSON.stringify({
          operation: "skip",
          confidence: 0.87,
          reason: "The memories are adjacent but not the same semantic fact.",
          ids: [],
          consolidatedText: null
        })
      })
    );
    const planner = new OpenAIConsolidationPlanner({ apiKey: "test-key", fetcher });

    await expect(
      planner.decide({
        memories: [
          makeMemory({ id: "mem-a", text: "User likes red accents", topic: "design" }),
          makeMemory({ id: "mem-b", text: "User dislikes busy dashboards", topic: "design" })
        ]
      })
    ).resolves.toEqual({
      provider: "llm",
      operation: "skip",
      confidence: 0.87,
      reason: "The memories are adjacent but not the same semantic fact."
    });
  });

  it("falls back when the model selects an ineligible source id", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        output_text: JSON.stringify({
          operation: "consolidate",
          confidence: 0.91,
          reason: "Invalid id included.",
          ids: ["mem-a", "mem-c"],
          consolidatedText: "User has a mixed preference."
        })
      })
    );
    const planner = new OpenAIConsolidationPlanner({ apiKey: "test-key", fetcher });

    const decision = await planner.decide({
      memories: [
        makeMemory({ id: "mem-a", text: "User likes red accents", topic: "design" }),
        makeMemory({ id: "mem-b", text: "User likes restrained medical UI", topic: "design" }),
        makeMemory({ id: "mem-c", text: "User likes the ocean", topic: "preference" })
      ]
    });

    expect(decision.provider).toBe("fallback");
    expect(decision.operation).toBe("consolidate");
    if (decision.operation !== "consolidate") throw new Error("expected consolidation decision");
    expect(decision.ids).toEqual(["mem-a", "mem-b"]);
    expect(decision.reason).toContain("failed validation");
  });

  it("falls back when model confidence is below threshold", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        output_text: JSON.stringify({
          operation: "skip",
          confidence: 0.31,
          reason: "Unsure.",
          ids: [],
          consolidatedText: null
        })
      })
    );
    const planner = new OpenAIConsolidationPlanner({ apiKey: "test-key", fetcher, minConfidence: 0.7 });

    const decision = await planner.decide({
      memories: [
        makeMemory({ id: "mem-a", text: "User likes red accents", topic: "design" }),
        makeMemory({ id: "mem-b", text: "User likes restrained medical UI", topic: "design" })
      ]
    });

    expect(decision.provider).toBe("fallback");
    expect(decision.operation).toBe("consolidate");
    expect(decision.reason).toContain("below 0.70");
  });

  it("falls back when no API key is configured", async () => {
    const previousApiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const fetcher = vi.fn<typeof fetch>();

    try {
      const planner = new OpenAIConsolidationPlanner({ apiKey: undefined, fetcher });
      const decision = await planner.decide({
        memories: [
          makeMemory({ id: "mem-a", text: "User likes red accents", topic: "design" }),
          makeMemory({ id: "mem-b", text: "User likes restrained medical UI", topic: "design" })
        ]
      });

      expect(fetcher).not.toHaveBeenCalled();
      expect(decision).toMatchObject({
        provider: "fallback",
        operation: "consolidate"
      });
    } finally {
      if (previousApiKey) {
        process.env.OPENAI_API_KEY = previousApiKey;
      }
    }
  });
});

describe("parseOpenAIConsolidationDecision", () => {
  it("rejects consolidation decisions without consolidated text", () => {
    expect(() =>
      parseOpenAIConsolidationDecision(
        JSON.stringify({
          operation: "consolidate",
          confidence: 0.82,
          reason: "Missing summary text.",
          ids: ["mem-a", "mem-b"],
          consolidatedText: null
        }),
        {
          memories: [
            makeMemory({ id: "mem-a", text: "User likes red accents", topic: "design" }),
            makeMemory({ id: "mem-b", text: "User likes restrained medical UI", topic: "design" })
          ]
        }
      )
    ).toThrow();
  });
});

function makeMemory(input: { id: string; text: string; topic?: string }): EngramMemory {
  return {
    id: input.id,
    text: input.text,
    importance: 0.78,
    topic: input.topic,
    region: "hippocampus",
    created_at: "2026-04-29T17:00:00.000Z",
    access_count: 0
  };
}
