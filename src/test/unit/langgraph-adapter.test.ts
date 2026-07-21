import { Annotation, END, InMemoryStore, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import {
  captureLangGraphReplayCheckpoint,
  defineLangGraphExecutor,
  instrumentLangGraphStore,
  langGraphMemoryId,
  langGraphMemoryIds,
  langGraphReplayMetadata,
  langGraphStoreItems
} from "@engramviz/adapter-langgraph";
import {
  parseMemoryDecisionRunV3,
  type MemoryDecisionRunV3,
  type MemoryInterventionV2
} from "@engramviz/core";
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
        if (!runtime.store) throw new Error("LangGraph Store is required for this node.");
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
        candidates: [{
          memoryId: "langgraph:users/user-1/memories/city",
          rank: 1
        }],
        limit: 3
      }
    });
    expect((events[1]?.retrieval as { selectedIds?: string[] }).selectedIds).toBeUndefined();
    expect((events[1]?.retrieval as { candidates?: Array<{ selected?: boolean }> }).candidates?.[0]?.selected)
      .toBeUndefined();
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

  it("attaches an explicit replay checkpoint to the active Engram turn", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const engram = client(requests);
    await engram.withTurn({
      input: "Where should the replacement ship?",
      provider: { id: "langgraph" },
      metadata: { environment: "test" }
    }, async (turn) => {
      await captureLangGraphReplayCheckpoint({
        getState: vi.fn(async () => ({
          values: { question: "Where should the replacement ship?", selectedIds: [] },
          config: { configurable: { thread_id: "support-thread", checkpoint_id: "checkpoint-1" } },
          next: ["retrieve"]
        }))
      }, { configurable: { thread_id: "support-thread" } }, { asNode: "entry", turn });
      return "The graph will answer next.";
    });

    const envelope = requests.find((request) => request.url.endsWith("/api/turns/v1"))?.body as {
      metadata?: Record<string, unknown>;
    };
    expect(envelope.metadata).toMatchObject({
      environment: "test",
      langgraph: {
        replayCheckpoint: {
          values: { question: "Where should the replacement ship?", selectedIds: [] },
          asNode: "entry",
          threadId: "support-thread",
          checkpointId: "checkpoint-1",
          next: ["retrieve"]
        }
      }
    });
  });

  it("forks a real LangGraph checkpoint and reruns retrieval through answer generation", async () => {
    const source = staleLocationRun();
    const intervention: MemoryInterventionV2 = {
      format: "engram.memory-intervention",
      version: 2,
      id: "prefer-current-city",
      targetRunId: source.id,
      label: "Prefer current city",
      rationale: "Exclude the superseded city memory.",
      createdAt: "2026-07-21T10:01:00.000Z",
      operations: [{
        id: "exclude-superseded",
        type: "policy_rule",
        rule: "exclude_superseded",
        enabled: true,
        reason: "Current facts should win."
      }]
    };
    const invoked: string[] = [];
    const executor = defineLangGraphExecutor({
      id: "stale-location-agent",
      name: "Stale location agent",
      version: "1.0.0",
      deterministic: true,
      createRuntime({ variant, sideEffectMode }) {
        const State = Annotation.Root({
          question: Annotation<string>(),
          excludeSuperseded: Annotation<boolean>(),
          candidates: Annotation<Array<{ id: string; text: string; status: string; score: number }>>(),
          selectedIds: Annotation<string[]>(),
          loadedIds: Annotation<string[]>(),
          answer: Annotation<string>()
        });
        const memories = [
          { id: "city-sf", text: "User lives in San Francisco.", status: "superseded", score: 0.97 },
          { id: "city-oakland", text: "User lives in Oakland.", status: "active", score: 0.91 }
        ];
        const graph = new StateGraph(State)
          .addNode("entry", (state) => state)
          .addNode("retrieve", (state) => {
            invoked.push(`${variant}:retrieve`);
            const candidates = state.excludeSuperseded
              ? memories.filter((memory) => memory.status === "active")
              : memories;
            return { candidates, selectedIds: [candidates[0]!.id], loadedIds: [candidates[0]!.id] };
          })
          .addNode("generate", (state) => {
            invoked.push(`${variant}:answer`);
            const selected = state.candidates.find((memory) => memory.id === state.selectedIds[0]);
            return { answer: selected?.text ?? "I do not know." };
          })
          .addEdge(START, "entry")
          .addEdge("entry", "retrieve")
          .addEdge("retrieve", "generate")
          .addEdge("generate", END)
          .compile({ checkpointer: new MemorySaver() });
        return {
          graph,
          config: { configurable: { thread_id: `replay-${variant}` } },
          isolation: {
            checkpoint: "isolated" as const,
            memoryStore: "isolated" as const,
            sideEffects: sideEffectMode
          }
        };
      },
      applyIntervention({ checkpoint }) {
        return { ...checkpoint.values, excludeSuperseded: true };
      },
      observe({ finalState, source: observedSource, variant }) {
        const state = finalState.values as {
          candidates: Array<{ id: string; text: string; status: "active" | "superseded"; score: number }>;
          selectedIds: string[];
          loadedIds: string[];
          answer: string;
        };
        const selected = new Set(state.selectedIds);
        const loaded = new Set(state.loadedIds);
        return parseMemoryDecisionRunV3({
          ...structuredClone(observedSource),
          id: `${observedSource.id}-${variant}`,
          completedAt: variant === "baseline" ? "2026-07-21T10:00:01.000Z" : "2026-07-21T10:00:02.000Z",
          retrieval: {
            ...structuredClone(observedSource.retrieval),
            candidates: state.candidates.map((memory, index) => ({
              memoryId: memory.id,
              memory: observedSource.memoryState.before.find((candidate) => candidate.id === memory.id),
              rank: index + 1,
              score: memory.score,
              eligible: true,
              selected: selected.has(memory.id),
              loaded: loaded.has(memory.id),
              evidence: "observed"
            })),
            selectedIds: state.selectedIds,
            policy: {
              ...structuredClone(observedSource.retrieval.policy),
              configuration: { excludeSuperseded: variant === "treatment" },
              evidence: "observed"
            }
          },
          context: {
            loadedIds: state.loadedIds,
            orderedIds: state.loadedIds,
            truncatedIds: [],
            forcedIds: [],
            evidence: "observed"
          },
          answer: {
            content: state.answer,
            provider: { id: "stale-location-agent", model: "1.0.0" },
            evidence: "observed"
          },
          evidenceCoverage: {
            memory_state: "observed",
            retrieval: "observed",
            selection: "observed",
            active_context: "observed",
            answer: "observed"
          }
        });
      }
    });

    const result = await executor.replay({
      baseline: source,
      intervention,
      answerAssertion: { type: "contains_all", values: ["Oakland"], forbidden: ["San Francisco"] }
    });

    expect(invoked).toEqual(["baseline:retrieve", "baseline:answer", "treatment:retrieve", "treatment:answer"]);
    expect(result.reproduction.reproduced).toBe(true);
    expect(result.level).toBe("agent");
    expect(result.diff.earliestDivergence).toBe("retrieval");
    expect(result.baseline.answer.content).toContain("San Francisco");
    expect(result.treatment.answer.content).toContain("Oakland");
    expect(result.verification).toMatchObject({ passed: true, failures: [] });
    expect(result.capabilities).toMatchObject({
      rerunsCandidateGeneration: true,
      rerunsSelection: true,
      rerunsGeneration: true
    });
  });
});

function staleLocationRun(): MemoryDecisionRunV3 {
  const stale = {
    id: "city-sf",
    content: "User lives in San Francisco.",
    subject: "current_city",
    value: "San Francisco",
    status: "superseded" as const,
    tier: "semantic" as const,
    scope: "user" as const,
    evidence: "observed" as const
  };
  const current = {
    id: "city-oakland",
    content: "User lives in Oakland.",
    subject: "current_city",
    value: "Oakland",
    status: "active" as const,
    tier: "semantic" as const,
    scope: "user" as const,
    evidence: "observed" as const
  };
  return parseMemoryDecisionRunV3({
    format: "engram.memory-decision-run",
    version: 3,
    id: "run-stale-location",
    traceId: "trace-stale-location",
    turnId: "turn-stale-location",
    sessionId: "session-1",
    startedAt: "2026-07-21T10:00:00.000Z",
    completedAt: "2026-07-21T10:00:00.500Z",
    input: "Where do I live?",
    memoryState: { before: [stale, current], after: [stale, current] },
    retrieval: {
      query: "Where do I live?",
      limit: 1,
      candidates: [
        { memoryId: stale.id, memory: stale, rank: 1, score: 0.97, eligible: true, selected: true, loaded: true, evidence: "observed" },
        { memoryId: current.id, memory: current, rank: 2, score: 0.91, eligible: true, selected: false, loaded: false, evidence: "observed" }
      ],
      selectedIds: [stale.id],
      policy: { id: "location-policy", configuration: { excludeSuperseded: false }, evidence: "observed" }
    },
    context: { loadedIds: [stale.id], orderedIds: [stale.id], truncatedIds: [], forcedIds: [], evidence: "observed" },
    answer: { content: stale.content, provider: { id: "stale-location-agent", model: "1.0.0" }, evidence: "observed" },
    evidenceCoverage: {
      memory_state: "observed",
      retrieval: "observed",
      selection: "observed",
      active_context: "observed",
      answer: "observed"
    },
    metadata: langGraphReplayMetadata({
      values: { question: "Where do I live?", excludeSuperseded: false },
      asNode: "entry"
    })
  });
}

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
