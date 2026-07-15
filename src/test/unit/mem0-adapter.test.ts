import { describe, expect, it, vi } from "vitest";
import { instrumentMem0, mem0MemoryIds, mem0MemoryRecords } from "@engramviz/adapter-mem0";
import { EngramClient } from "@engramviz/sdk";

describe("@engramviz/adapter-mem0", () => {
  it("captures concrete OSS mutations, ranking, and explicit context loading", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const engram = client(requests);
    const raw = {
      async add() {
        return { results: [{ id: "memory-sf", memory: "User lives in San Francisco.", event: "ADD", metadata: { topic: "location" } }] };
      },
      async search() {
        return { results: [
          { id: "memory-sf", memory: "User lives in San Francisco.", score: 0.91 },
          { id: "memory-oak", memory: "User lives in Oakland now.", score: 0.88 }
        ] };
      },
      async update(id: string, value: { text: string }) { return { id, memory: value.text }; },
      async delete(id: string) { return { id }; }
    };
    const mem0 = instrumentMem0(raw, engram, {
      selectedIds: (records) => [records[0]!.id]
    });

    await engram.withTurn({ input: "Test memory flow", provider: { id: "fixture" }, traceId: "trace-mem0" }, async (turn) => {
      await mem0.add();
      const result = await mem0.search();
      await turn.load(mem0MemoryIds(result));
      await mem0.update("memory-sf", { text: "User lived in San Francisco." });
      await mem0.delete("memory-sf");
      return "Done.";
    });

    const events = requests
      .filter((request) => request.url.endsWith("/api/telemetry/v2"))
      .flatMap((request) => (request.body as { events: Array<Record<string, unknown>> }).events);
    expect(events.map((event) => event.operation)).toEqual(["store", "retrieve", "load", "update", "delete"]);
    expect(events[1]).toMatchObject({
      retrieval: {
        selectedIds: ["memory-sf"],
        candidates: [
          { memoryId: "memory-sf", rank: 1, score: 0.91, selected: true },
          { memoryId: "memory-oak", rank: 2, score: 0.88, selected: false }
        ]
      },
      evidence: { level: "observed", adapter: "mem0" }
    });
    expect(events[2]).toMatchObject({ memoryIds: ["memory-sf", "memory-oak"] });
  });

  it("does not invent a store event for a pending Platform add", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const gaps: string[] = [];
    const engram = client(requests);
    const mem0 = instrumentMem0({
      async add() { return { status: "PENDING", event_id: "mem0-event-1" }; }
    }, engram, { onInstrumentationGap: (gap) => gaps.push(gap.reason) });

    await engram.withTurn({ input: "Remember this", provider: { id: "fixture" } }, async () => {
      await mem0.add();
      return "Okay.";
    });

    expect(requests.some((request) => request.url.endsWith("/api/telemetry/v2"))).toBe(false);
    expect(gaps[0]).toMatch(/did not expose the resulting memory IDs/i);
  });

  it("normalizes Platform, OSS, and nested response containers", () => {
    expect(mem0MemoryIds([{ id: "a" }, { memory_id: "b" }])).toEqual(["a", "b"]);
    expect(mem0MemoryIds({ data: { results: [{ memoryId: "c" }] } })).toEqual(["c"]);
    expect(mem0MemoryRecords({ results: [{ id: "a", memory: "Alpha", score: 0.5 }] })[0])
      .toMatchObject({ id: "a", memory: "Alpha", score: 0.5 });
  });
});

function client(requests: Array<{ url: string; body: unknown }>) {
  return new EngramClient({
    endpoint: "http://localhost:3100",
    token: "token",
    projectId: "mem0-test",
    fetch: vi.fn(async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return Response.json({}, { status: 202 });
    }),
    strict: true
  });
}
