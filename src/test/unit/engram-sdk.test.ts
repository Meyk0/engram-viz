import { describe, expect, it, vi } from "vitest";
import { EngramClient, getActiveEngramTurn } from "../../../packages/sdk/src/index";

describe("@engramviz/sdk", () => {
  it("captures provider memory operations and the completed turn", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return Response.json({ ok: true }, { status: 202 });
    });
    const client = new EngramClient({
      endpoint: "http://localhost:3100",
      token: "local-token",
      projectId: "sdk-test",
      sessionId: "session-sdk",
      fetch: fetchMock,
      strict: true
    });

    const answer = await client.withTurn({
      input: "What city do I live in?",
      provider: { id: "openai", model: "gpt-test" },
      traceId: "trace-sdk",
      turnId: "turn-sdk"
    }, async (turn) => {
      expect(getActiveEngramTurn()).toBe(turn);
      await turn.retrieve({
        query: "What city do I live in?",
        candidates: [
          { memoryId: "memory-oak", rank: 1, score: 0.94, selected: true },
          { memoryId: "memory-sf", rank: 2, score: 0.82, selected: false }
        ]
      });
      await turn.load(["memory-oak"]);
      return "You live in Oakland.";
    });

    expect(answer).toBe("You live in Oakland.");
    const telemetryRequest = requests.find((request) => request.url.endsWith("/api/telemetry/v2"))!;
    const events = (telemetryRequest.body as { events: Array<Record<string, unknown>> }).events;
    expect(events.map((event) => event.operation)).toEqual(["retrieve", "load"]);
    expect(events.map((event) => event.eventId)).toEqual([
      "trace-sdk:turn-sdk:memory:0",
      "trace-sdk:turn-sdk:memory:1"
    ]);
    expect(events.map((event) => event.turnId)).toEqual(["turn-sdk", "turn-sdk"]);
    const turnRequest = requests.find((request) => request.url.endsWith("/api/turns/v1"))!;
    expect(turnRequest.body).toMatchObject({
      turnId: "turn-sdk",
      traceId: "trace-sdk",
      status: "completed",
      output: "You live in Oakland.",
      telemetryEventIds: ["trace-sdk:turn-sdk:memory:0", "trace-sdk:turn-sdk:memory:1"]
    });
    expect(getActiveEngramTurn()).toBeUndefined();
  });

  it("keeps event ids unique across turns that share one trace", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const client = new EngramClient({
      endpoint: "http://localhost:3100",
      token: "local-token",
      tenantId: "tenant-sdk",
      projectId: "sdk-test",
      sessionId: "session-sdk",
      namespace: ["users", "user-a", "memories"],
      fetch: vi.fn(async (input, init) => {
        requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        return Response.json({}, { status: 202 });
      }),
      strict: true
    });

    for (const turnId of ["turn-a", "turn-b"]) {
      await client.withTurn({
        input: `Input ${turnId}`,
        provider: { id: "fixture" },
        traceId: "trace-shared",
        turnId,
        userId: "user-a"
      }, async (turn) => {
        await turn.store({ id: `memory-${turnId}`, content: turnId });
        return "Done.";
      });
    }

    const telemetry = requests
      .filter((request) => request.url.endsWith("/api/telemetry/v2"))
      .flatMap((request) => (request.body as { events: Array<Record<string, unknown>> }).events);
    expect(telemetry.map((event) => event.eventId)).toEqual([
      "trace-shared:turn-a:memory:0",
      "trace-shared:turn-b:memory:0"
    ]);
    expect(new Set(telemetry.map((event) => event.eventId))).toHaveLength(2);
    expect(telemetry).toEqual(telemetry.map((event, index) => expect.objectContaining({
      turnId: index === 0 ? "turn-a" : "turn-b",
      tenantId: "tenant-sdk",
      projectId: "sdk-test",
      userId: "user-a",
      sessionId: "session-sdk",
      namespace: ["users", "user-a", "memories"],
      owner: {
        userId: "user-a",
        namespace: ["users", "user-a", "memories"]
      }
    })));
  });

  it("rejects contradictory turn and owner identities", async () => {
    const client = new EngramClient({
      endpoint: "http://localhost:3100",
      token: "local-token",
      projectId: "sdk-test",
      sessionId: "session-sdk",
      fetch: vi.fn(async () => Response.json({}, { status: 202 })),
      strict: true
    });

    await expect(client.withTurn({
      input: "Conflict",
      provider: { id: "fixture" },
      userId: "user-a",
      owner: { userId: "user-b" }
    }, async () => "Never runs"))
      .rejects.toThrow(/user id conflicts/i);

    await expect(client.withTurn({
      input: "Memory conflict",
      provider: { id: "fixture" },
      userId: "user-a"
    }, async (turn) => {
      await turn.store({ id: "memory-other-owner", owner: { userId: "user-b" } });
      return "Never completes";
    })).rejects.toThrow(/user id conflicts/i);
  });

  it("records an error envelope and preserves the application error", async () => {
    const bodies: unknown[] = [];
    const client = new EngramClient({
      endpoint: "http://localhost:3100",
      token: "local-token",
      projectId: "sdk-test",
      fetch: vi.fn(async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({}, { status: 202 });
      }),
      strict: true
    });

    await expect(client.withTurn({ input: "Fail", provider: { id: "test" } }, async () => {
      throw new TypeError("Model failed");
    })).rejects.toThrow("Model failed");
    expect(bodies.at(-1)).toMatchObject({
      status: "error",
      error: { name: "TypeError", message: "Model failed" }
    });
  });

  it("fails open by default when Engram is unavailable", async () => {
    const errors: unknown[] = [];
    const client = new EngramClient({
      endpoint: "http://localhost:3100",
      token: "local-token",
      projectId: "sdk-test",
      fetch: vi.fn(async () => { throw new Error("offline"); }),
      onError: (error) => errors.push(error)
    });

    await expect(client.withTurn({ input: "Hello", provider: { id: "test" } }, async (turn) => {
      await turn.store({ id: "memory-1", content: "User likes coffee." });
      return "Hello.";
    })).resolves.toBe("Hello.");
    expect(errors.length).toBeGreaterThan(0);
  });
});
