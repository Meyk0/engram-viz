import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/lab/replay/route";
import { memoryBranchReplayResultSchema } from "@/lib/events/schema";
import { MAX_MEMORY_BRANCH_REPLAY_REQUEST_BYTES } from "@/lib/lab/replay";
import type { MemoryBranchReplayRequest } from "@/lib/lab/types";

afterEach(() => {
  delete process.env.ENGRAM_CHAT_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_LIVE_ENABLED;
});

describe("POST /api/lab/replay", () => {
  it("replays a recorded turn against an explicit branch context", async () => {
    const response = await POST(replayRequest());
    const result = memoryBranchReplayResultSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(result.evidence).toBe("replayed");
    expect(result.baselineMemoryIds).toEqual(["mem-color", "mem-location"]);
    expect(result.branchMemoryIds).toEqual(["mem-location"]);
    expect(result.baselineAnswer).toContain("Based on 2 retrieved memories");
    expect(result.branchAnswer).toContain("Based on the retrieved memory");
    expect(result.changed).toBe(true);
    expect(result.caveat).toContain("does not reproduce hidden model state");
  });

  it("rejects mutation-free and oversized requests", async () => {
    const noMutation = replayBody();
    noMutation.branch.mutations = [];
    const invalidResponse = await POST(requestFrom(noMutation));
    expect(invalidResponse.status).toBe(400);

    const sizeResponse = await POST(new Request("http://localhost/api/lab/replay", {
      method: "POST",
      headers: { "content-length": String(MAX_MEMORY_BRANCH_REPLAY_REQUEST_BYTES + 1) },
      body: "{}"
    }));
    expect(sizeResponse.status).toBe(413);
  });
});

function replayRequest() {
  return requestFrom(replayBody());
}

function requestFrom(body: MemoryBranchReplayRequest) {
  return new Request("http://localhost/api/lab/replay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function replayBody(): MemoryBranchReplayRequest {
  const colorMemory = {
    id: "mem-color",
    text: "User's favorite color is indigo.",
    importance: 0.9,
    region: "hippocampus" as const,
    created_at: "2026-07-13T09:00:00.000Z",
    access_count: 1
  };
  const locationMemory = {
    id: "mem-location",
    text: "User lives in San Francisco.",
    importance: 0.7,
    region: "temporal" as const,
    created_at: "2026-07-12T09:00:00.000Z",
    access_count: 2
  };

  return {
    record: {
      version: 1,
      id: "turn-branch-api",
      sessionId: "session-branch-api",
      startedAt: "2026-07-13T10:00:00.000Z",
      completedAt: "2026-07-13T10:00:01.000Z",
      userMessage: "What is my favorite color?",
      history: [],
      retrievedMemories: [colorMemory, locationMemory],
      events: [],
      originalAnswer: "Your favorite color is indigo.",
      provider: { id: "demo" }
    },
    branch: {
      version: 1,
      id: "branch-api",
      checkpointId: "checkpoint-api",
      title: "Without color memory",
      createdAt: "2026-07-13T10:01:00.000Z",
      mutations: [{
        id: "mutation-api",
        type: "quarantine",
        memoryId: "mem-color",
        reason: "Test branch"
      }]
    },
    branchContextMemories: [locationMemory]
  };
}
