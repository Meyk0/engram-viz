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
      "trace-sdk:memory:0",
      "trace-sdk:memory:1"
    ]);
    const turnRequest = requests.find((request) => request.url.endsWith("/api/turns/v1"))!;
    expect(turnRequest.body).toMatchObject({
      turnId: "turn-sdk",
      traceId: "trace-sdk",
      status: "completed",
      output: "You live in Oakland.",
      telemetryEventIds: ["trace-sdk:memory:0", "trace-sdk:memory:1"]
    });
    expect(getActiveEngramTurn()).toBeUndefined();
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
