import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/causal-xray/route";
import { MAX_CAUSAL_ABLATION_REQUEST_BYTES } from "@/lib/evidence/ablation";
import { causalAblationResultSchema } from "@/lib/events/schema";
import type { CausalAblationRequest } from "@/lib/evidence/types";

afterEach(() => {
  delete process.env.ENGRAM_CHAT_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_LIVE_ENABLED;
  vi.restoreAllMocks();
});

describe("POST /api/causal-xray", () => {
  it("returns a validated two-run ablation result in configured demo mode", async () => {
    const response = await POST(ablationRequest());
    const body = await response.json();
    const result = causalAblationResultSchema.parse(body);

    expect(response.status).toBe(200);
    expect(result.baselineAnswer).toContain("2 prior memory traces");
    expect(result.counterfactualAnswer).toContain("1 prior memory trace");
    expect(result.changed).toBe(true);
    expect(result.estimatedInfluence).toBeGreaterThan(0);
    expect(result.caveat).toContain("estimated counterfactual, not proof of causality");
  });

  it("rejects invalid exclusions and request size violations", async () => {
    const unknownIdResponse = await POST(ablationRequest(["not-retrieved"]));
    expect(unknownIdResponse.status).toBe(400);

    const duplicateIdResponse = await POST(ablationRequest(["mem-color", "mem-color"]));
    expect(duplicateIdResponse.status).toBe(400);

    const tooManyIds = Array.from({ length: 11 }, (_, index) => `mem-${index}`);
    const tooManyResponse = await POST(ablationRequest(tooManyIds));
    expect(tooManyResponse.status).toBe(400);

    const contentLengthResponse = await POST(
      new Request("http://localhost/api/causal-xray", {
        method: "POST",
        headers: { "content-length": String(MAX_CAUSAL_ABLATION_REQUEST_BYTES + 1) },
        body: "{}"
      })
    );
    expect(contentLengthResponse.status).toBe(413);

    const bodySizeResponse = await POST(
      new Request("http://localhost/api/causal-xray", {
        method: "POST",
        body: JSON.stringify({ padding: "x".repeat(MAX_CAUSAL_ABLATION_REQUEST_BYTES) })
      })
    );
    expect(bodySizeResponse.status).toBe(413);
  });

  it("does not expose configured provider failures", async () => {
    process.env.ENGRAM_CHAT_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_LIVE_ENABLED = "true";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("upstream secret: account and request details")
    );

    const response = await POST(ablationRequest());
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(body.error).toBe("Causal X-ray provider replay failed.");
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});

function ablationRequest(excludedMemoryIds = ["mem-color"]): Request {
  const body: CausalAblationRequest = {
    record: {
      version: 1,
      id: "turn-api-ablation",
      sessionId: "session-api-ablation",
      startedAt: "2026-07-13T10:00:00.000Z",
      completedAt: "2026-07-13T10:00:01.000Z",
      userMessage: "What is my favorite color?",
      history: [],
      retrievedMemories: [
        {
          id: "mem-color",
          text: "User's favorite color is indigo.",
          importance: 0.9,
          region: "hippocampus",
          created_at: "2026-07-13T09:00:00.000Z",
          access_count: 1
        },
        {
          id: "mem-location",
          text: "User lives in San Francisco.",
          importance: 0.7,
          region: "temporal",
          created_at: "2026-07-12T09:00:00.000Z",
          access_count: 2
        }
      ],
      events: [],
      originalAnswer: "Your favorite color is indigo.",
      provider: { id: "demo" }
    },
    excludedMemoryIds
  };

  return new Request("http://localhost/api/causal-xray", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
