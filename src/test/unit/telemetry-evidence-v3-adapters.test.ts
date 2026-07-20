import { describe, expect, it, vi } from "vitest";
import { instrumentLangGraphStore } from "@engramviz/adapter-langgraph";
import { instrumentMem0 } from "@engramviz/adapter-mem0";
import type { MemoryTelemetryEvent } from "@engramviz/core";
import { EngramClient } from "@engramviz/sdk";

describe("telemetry evidence v3 adapters", () => {
  it("captures Mem0 candidate content and owner without claiming selection", async () => {
    const requests: CapturedRequest[] = [];
    const engram = client(requests, "mem0-evidence");
    const mem0 = instrumentMem0({
      async search(_query?: string, _options?: unknown) {
        return { results: [{
          id: "memory-oakland",
          memory: "User lives in Oakland.",
          score: 0.91,
          metadata: { user_id: "user-a", topic: "location" }
        }] };
      }
    }, engram);

    await engram.withTurn({
      input: "Where do I live?",
      provider: { id: "fixture" },
      userId: "user-a"
    }, async () => {
      await mem0.search("Where do I live?", { filters: { user_id: "user-a" }, topK: 5 });
      return "No memory was loaded.";
    });

    const retrieval = telemetryEvents(requests)[0]!.retrieval;
    const candidates = retrieval?.candidates;
    if (!retrieval || !candidates) throw new Error("Expected Mem0 retrieval candidates.");
    expect(retrieval).not.toHaveProperty("selectedIds");
    expect(candidates[0]).toMatchObject({
      memoryId: "memory-oakland",
      rank: 1,
      score: 0.91,
      memory: {
        id: "memory-oakland",
        content: "User lives in Oakland.",
        owner: { userId: "user-a" },
        provider: "mem0"
      }
    });
    expect(candidates[0]).not.toHaveProperty("selected");
  });

  it("maps LangGraph namespaces into owner evidence without claiming selection", async () => {
    const requests: CapturedRequest[] = [];
    const engram = client(requests, "langgraph-evidence");
    const rawStore = {
      async search(_namespace?: string[], _options?: unknown) {
        return [{
          namespace: ["users", "user-b", "memories"],
          key: "favorite-color",
          value: { data: "User likes indigo." },
          score: 0.88
        }];
      }
    };
    const store = instrumentLangGraphStore(rawStore, engram);

    await engram.withTurn({
      input: "What color do I like?",
      provider: { id: "fixture" },
      userId: "user-b"
    }, async () => {
      await store.search(["users", "user-b", "memories"], { limit: 3 });
      return "No memory was loaded.";
    });

    const retrieval = telemetryEvents(requests)[0]!.retrieval;
    const candidates = retrieval?.candidates;
    if (!retrieval || !candidates) throw new Error("Expected LangGraph retrieval candidates.");
    expect(retrieval).not.toHaveProperty("selectedIds");
    expect(candidates[0]).toMatchObject({
      memoryId: "langgraph:users/user-b/memories/favorite-color",
      memory: {
        content: "User likes indigo.",
        owner: {
          userId: "user-b",
          namespace: ["users", "user-b", "memories"]
        },
        provider: "langgraph"
      }
    });
    expect(candidates[0]).not.toHaveProperty("selected");
  });
});

type CapturedRequest = { url: string; body: unknown };

function client(requests: CapturedRequest[], projectId: string) {
  return new EngramClient({
    endpoint: "http://localhost:3100",
    token: "token",
    projectId,
    sessionId: "session-shared",
    fetch: vi.fn(async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return Response.json({}, { status: 202 });
    }),
    strict: true
  });
}

function telemetryEvents(requests: CapturedRequest[]) {
  return requests
    .filter((request) => request.url.endsWith("/api/telemetry/v2"))
    .flatMap((request) => (request.body as { events: MemoryTelemetryEvent[] }).events);
}
