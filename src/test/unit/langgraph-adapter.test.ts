import { Annotation, END, InMemoryStore, START, StateGraph } from "@langchain/langgraph";
import {
  instrumentLangGraphStore,
  langGraphMemoryId,
  langGraphMemoryIds,
  langGraphStoreItems
} from "@engramviz/adapter-langgraph";
import { EngramClient, getActiveEngramTurn } from "@engramviz/sdk";
import { describe, expect, it, vi } from "vitest";

describe("@engramviz/adapter-langgraph", () => {
  it("captures real StateGraph Store writes, retrieval, and explicit context loading", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const engram = client(requests);
    const store = instrumentLangGraphStore(new InMemoryStore(), engram, {
      storeId: "langgraph-test"
    });
    const namespace = ["users", "user-1", "memories"];
    const State = Annotation.Root({
      input: Annotation<string>(),
      output: Annotation<string>()
    });
    const graph = new StateGraph(State)
      .addNode("memory", async (state, runtime) => {
        await runtime.store.put(namespace, "city", { data: "User lives in Oakland." });
        const memories = await runtime.store.search(namespace, { limit: 3 });
        await getActiveEngramTurn()?.load(langGraphMemoryIds(memories));
        return { output: String(memories[0]?.value.data) };
      })
      .addEdge(START, "memory")
      .addEdge("memory", END)
      .compile({ store });

    const output = await engram.withTurn({
      input: "Where do I live?",
      provider: { id: "langgraph" },
      traceId: "trace-langgraph"
    }, async () => {
      const result = await graph.invoke({ input: "Where do I live?", output: "" });
      return result.output;
    });

    expect(output).toBe("User lives in Oakland.");
    const events = telemetryEvents(requests);
    expect(events.map((event) => event.operation)).toEqual(["store", "retrieve", "load"]);
    expect(events[0]).toMatchObject({
      memory: {
        id: "langgraph:users/user-1/memories/city",
        content: "User lives in Oakland.",
        provider: "langgraph",
        storeId: "langgraph-test",
        metadata: { namespace, key: "city", upsert: true }
      },
      evidence: { level: "mapped", adapter: "langgraph", sourcePath: "langgraph.store.put" }
    });
    expect(events[1]).toMatchObject({
      retrieval: {
        query: "namespace:users/user-1/memories",
        selectedIds: ["langgraph:users/user-1/memories/city"],
        candidates: [{
          memoryId: "langgraph:users/user-1/memories/city",
          rank: 1,
          selected: true
        }],
        limit: 3
      }
    });
    expect(events[2]).toMatchObject({ memoryIds: ["langgraph:users/user-1/memories/city"] });
  });

  it("captures direct batch search, get, update classification, and delete", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const engram = client(requests);
    const namespace = ["users", "user-2", "memories"];
    const store = instrumentLangGraphStore(new InMemoryStore(), engram, {
      classifyPut: "update"
    });

    await engram.withTurn({ input: "Batch memory maintenance", provider: { id: "langgraph" } }, async () => {
      await store.put(namespace, "preference", { data: "User likes indigo." });
      await store.batch([
        { namespacePrefix: namespace, limit: 5 },
        { namespace, key: "preference" },
        { namespace, key: "preference", value: null }
      ]);
      return "Done.";
    });

    const events = telemetryEvents(requests);
    expect(events.map((event) => event.operation)).toEqual(["update", "retrieve", "retrieve", "delete"]);
    expect(events[1]).toMatchObject({ retrieval: { limit: 5 } });
    expect(events[2]).toMatchObject({ retrieval: { limit: 1 } });
    expect(events[3]).toMatchObject({
      memoryIds: ["langgraph:users/user-2/memories/preference"]
    });
  });

  it("normalizes Store items into stable namespace-qualified memory IDs", () => {
    const item = {
      namespace: ["users", "a/b"],
      key: "favorite color",
      value: { data: "indigo" },
      score: 0.92,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z")
    };
    expect(langGraphMemoryId(item.namespace, item.key))
      .toBe("langgraph:users/a%2Fb/favorite%20color");
    expect(langGraphMemoryIds([item])).toEqual(["langgraph:users/a%2Fb/favorite%20color"]);
    expect(langGraphStoreItems([item])[0]).toMatchObject({
      score: 0.92,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z"
    });
  });
});

function telemetryEvents(requests: Array<{ url: string; body: unknown }>) {
  return requests
    .filter((request) => request.url.endsWith("/api/telemetry/v2"))
    .flatMap((request) => (request.body as { events: Array<Record<string, unknown>> }).events);
}

function client(requests: Array<{ url: string; body: unknown }>) {
  return new EngramClient({
    endpoint: "http://localhost:3100",
    token: "token",
    projectId: "langgraph-test",
    fetch: vi.fn(async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return Response.json({}, { status: 202 });
    }),
    strict: true
  });
}
