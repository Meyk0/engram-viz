import { describe, expect, it, vi } from "vitest";
import { parseMemoryTelemetryEvent, type MemoryTelemetryEvent } from "@engramviz/core";
import { EngramClient } from "../../../packages/sdk/src/index";

describe("telemetry evidence v3 contracts", () => {
  it("accepts candidate memory snapshots with structured ownership", () => {
    const event = parseMemoryTelemetryEvent({
      schemaVersion: 2,
      eventId: "candidate-snapshot",
      traceId: "trace-candidate",
      sessionId: "session-a",
      userId: "user-a",
      owner: { userId: "user-a" },
      timestamp: "2026-07-20T12:00:00.000Z",
      sequence: 0,
      operation: "retrieve",
      retrieval: {
        query: "Where do I live?",
        candidates: [{
          memoryId: "memory-city",
          memory: {
            id: "memory-city",
            content: "User lives in Oakland.",
            tier: "episodic",
            scope: "user",
            owner: { userId: "user-a", namespace: ["users", "user-a", "memories"] },
            provider: "fixture"
          },
          rank: 1,
          score: 0.93
        }]
      },
      evidence: { level: "observed", adapter: "fixture" }
    });

    expect(event.retrieval?.candidates?.[0]?.memory).toMatchObject({
      content: "User lives in Oakland.",
      owner: { userId: "user-a", namespace: ["users", "user-a", "memories"] }
    });
    expect(event.retrieval?.selectedIds).toBeUndefined();
  });

  it("keeps legacy id-only retrieval candidates valid", () => {
    expect(() => parseMemoryTelemetryEvent({
      schemaVersion: 2,
      eventId: "legacy-candidate",
      traceId: "trace-legacy",
      timestamp: "2026-07-20T12:00:00.000Z",
      sequence: 0,
      operation: "retrieve",
      retrieval: {
        query: "legacy",
        candidates: [{ memoryId: "memory-legacy", rank: 1 }]
      },
      evidence: { level: "mapped", adapter: "legacy" }
    })).not.toThrow();
  });

  it("rejects a snapshot whose id disagrees with its candidate id", () => {
    expect(() => parseMemoryTelemetryEvent({
      schemaVersion: 2,
      eventId: "invalid-candidate",
      traceId: "trace-invalid",
      timestamp: "2026-07-20T12:00:00.000Z",
      sequence: 0,
      operation: "retrieve",
      retrieval: {
        candidates: [{
          memoryId: "memory-a",
          memory: { id: "memory-b", tier: "episodic", scope: "user" }
        }]
      },
      evidence: { level: "observed", adapter: "fixture" }
    })).toThrow(/snapshot id must match/i);
  });

  it("does not manufacture selection evidence for candidate-only SDK capture", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const client = new EngramClient({
      endpoint: "http://localhost:3100",
      token: "token",
      projectId: "evidence-test",
      sessionId: "session-a",
      fetch: vi.fn(async (input, init) => {
        requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        return Response.json({}, { status: 202 });
      }),
      strict: true
    });

    await client.withTurn({
      input: "Where do I live?",
      provider: { id: "fixture" },
      userId: "user-a"
    }, async (turn) => {
      await turn.retrieve({
        query: "Where do I live?",
        candidates: [{
          memoryId: "memory-city",
          memory: {
            id: "memory-city",
            content: "User lives in Oakland.",
            tier: "episodic",
            scope: "user",
            owner: { userId: "user-a" }
          },
          rank: 1,
          score: 0.93
        }]
      });
      return "I have not loaded a memory yet.";
    });

    const event = telemetryEvents(requests)[0]!;
    const candidates = event.retrieval?.candidates;
    if (!candidates) throw new Error("Expected retrieval candidates.");
    expect(event).not.toHaveProperty("memoryIds");
    expect(event.retrieval).not.toHaveProperty("selectedIds");
    expect(candidates[0]).not.toHaveProperty("selected");
    expect(event).toMatchObject({
      userId: "user-a",
      owner: { userId: "user-a" }
    });
  });
});

function telemetryEvents(requests: Array<{ url: string; body: unknown }>) {
  return requests
    .filter((request) => request.url.endsWith("/api/telemetry/v2"))
    .flatMap((request) => (request.body as { events: MemoryTelemetryEvent[] }).events);
}
