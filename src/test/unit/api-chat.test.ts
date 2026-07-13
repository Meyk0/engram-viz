import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/chat/route";
import { decodeSseChunks } from "@/lib/events/sse";
import { createLiveMemoryStream, resetLiveMemoryStore } from "@/lib/chat/live";
import {
  deterministicMemoryConsolidationPlanner,
  type MemoryConsolidationPlanner
} from "@/lib/memory/consolidationPolicy";
import { deterministicMemoryDecisionPlanner, type MemoryDecisionPlanner } from "@/lib/memory/decision";
import type { MemoryRetriever } from "@/lib/memory/retrieve";
import type { TurnMemoryPlanner } from "@/lib/memory/turn-planner";

describe("/api/chat", () => {
  it("returns live memory SSE chunks in demo mode", async () => {
    resetLiveMemoryStore();

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "api-chat-a",
          message: "remember that I like luminous interfaces"
        })
      })
    );

    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const text = await response.text();
    const chunks = decodeSseChunks(text);

    expect(chunks[0]).toEqual({ kind: "event", event: { type: "init", memories: [] } });
    expect(chunks.some((chunk) => chunk.kind === "event" && chunk.event.type === "retrieve")).toBe(false);
    expect(chunks.some((chunk) => chunk.kind === "event" && chunk.event.type === "store")).toBe(true);
    expect(chunks.at(-1)).toEqual({ kind: "done" });
    expect(chunks.slice(0, -1).some((chunk) => chunk.kind === "done")).toBe(false);
  });

  it("retrieves memories stored by prior turns in the same session", async () => {
    resetLiveMemoryStore();

    await drainResponse(
      await POST(
        new Request("http://localhost/api/chat", {
          method: "POST",
          body: JSON.stringify({
            sessionId: "api-chat-b",
            message: "remember that I prefer restrained medical cyberpunk design"
          })
        })
      )
    );

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "api-chat-b",
          message: "what design style do I prefer?"
        })
      })
    );
    const chunks = decodeSseChunks(await response.text());
    const retrieveChunk = chunks.find(
      (chunk) => chunk.kind === "event" && chunk.event.type === "retrieve"
    );
    const loadChunk = chunks.find((chunk) => chunk.kind === "event" && chunk.event.type === "load");
    const fireChunk = chunks.find((chunk) => chunk.kind === "event" && chunk.event.type === "fire");

    expect(retrieveChunk?.kind).toBe("event");
    if (retrieveChunk?.kind === "event" && retrieveChunk.event.type === "retrieve") {
      expect(retrieveChunk.event.ids.length).toBeGreaterThan(0);
    }
    expect(loadChunk?.kind).toBe("event");
    expect(fireChunk?.kind).toBe("event");
  });

  it("loads retrieved memories into active context before firing prefrontal", async () => {
    resetLiveMemoryStore();

    await drainResponse(
      await POST(
        new Request("http://localhost/api/chat", {
          method: "POST",
          body: JSON.stringify({
            sessionId: "api-chat-load",
            message: "remember that I love red"
          })
        })
      )
    );

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "api-chat-load",
          message: "what color do I love?"
        })
      })
    );
    const chunks = decodeSseChunks(await response.text());
    const eventTypes = chunks
      .filter((chunk) => chunk.kind === "event")
      .map((chunk) => (chunk.kind === "event" ? chunk.event.type : "none"));

    expect(eventTypes.indexOf("retrieve")).toBeLessThan(eventTypes.indexOf("load"));
    expect(eventTypes.indexOf("load")).toBeLessThan(eventTypes.indexOf("fire"));
  });

  it("retrieves indigo preference before answering a favorite-color question", async () => {
    resetLiveMemoryStore();

    await drainResponse(
      await POST(
        new Request("http://localhost/api/chat", {
          method: "POST",
          body: JSON.stringify({
            sessionId: "api-chat-indigo",
            message: "I love the color indigo"
          })
        })
      )
    );

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "api-chat-indigo",
          message: "what is my favorite color?"
        })
      })
    );
    const chunks = decodeSseChunks(await response.text());
    const retrieveChunk = chunks.find(
      (chunk) => chunk.kind === "event" && chunk.event.type === "retrieve"
    );
    const planChunk = chunks.find((chunk) => chunk.kind === "event" && chunk.event.type === "plan");

    expect(retrieveChunk?.kind).toBe("event");
    if (retrieveChunk?.kind !== "event" || retrieveChunk.event.type !== "retrieve") {
      throw new Error("expected retrieve event");
    }
    expect(retrieveChunk.event.ids).toHaveLength(1);
    expect(planChunk?.kind).toBe("event");
    if (planChunk?.kind === "event" && planChunk.event.type === "plan") {
      expect(planChunk.event.decision.relatedMemoryIds).toEqual(retrieveChunk.event.ids);
    }
  });

  it("hydrates client-visible memories before retrieval when server memory was reset", async () => {
    resetLiveMemoryStore();

    const storeChunks = await createLiveMemoryStream({
      sessionId: "api-chat-client-hydration",
      message: "I love the color indigo"
    });
    const storeChunk = storeChunks.find(
      (chunk) => chunk.kind === "event" && chunk.event.type === "store"
    );

    expect(storeChunk?.kind).toBe("event");
    if (storeChunk?.kind !== "event" || storeChunk.event.type !== "store") {
      throw new Error("expected store event");
    }

    resetLiveMemoryStore();

    const chunks = await createLiveMemoryStream({
      sessionId: "api-chat-client-hydration",
      message: "What color do I love?",
      clientMemories: [storeChunk.event.memory]
    });
    const initChunk = chunks.find((chunk) => chunk.kind === "event" && chunk.event.type === "init");
    const retrieveChunk = chunks.find(
      (chunk) => chunk.kind === "event" && chunk.event.type === "retrieve"
    );
    const fireChunk = chunks.find(
      (chunk) => chunk.kind === "event" && chunk.event.type === "fire" && chunk.event.region === "prefrontal"
    );

    expect(initChunk?.kind).toBe("event");
    if (initChunk?.kind === "event" && initChunk.event.type === "init") {
      expect(initChunk.event.memories).toHaveLength(1);
    }
    expect(retrieveChunk?.kind).toBe("event");
    if (retrieveChunk?.kind === "event" && retrieveChunk.event.type === "retrieve") {
      expect(retrieveChunk.event.ids).toEqual([storeChunk.event.memory.id]);
    }
    expect(fireChunk?.kind).toBe("event");
  });

  it("does not load active context for unrelated standalone preference stores", async () => {
    resetLiveMemoryStore();

    await drainResponse(
      await POST(
        new Request("http://localhost/api/chat", {
          method: "POST",
          body: JSON.stringify({
            sessionId: "api-chat-unrelated-store",
            message: "I like the color blue"
          })
        })
      )
    );

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "api-chat-unrelated-store",
          message: "I like the ocean"
        })
      })
    );
    const chunks = decodeSseChunks(await response.text());
    const events = chunks
      .filter((chunk) => chunk.kind === "event")
      .map((chunk) => (chunk.kind === "event" ? chunk.event : null))
      .filter((event): event is NonNullable<typeof event> => Boolean(event));
    const eventTypes = events.map((event) => event.type);

    expect(eventTypes).toContain("store");
    expect(eventTypes).not.toContain("retrieve");
    expect(eventTypes).not.toContain("load");
    expect(events.some((event) => event.type === "fire" && event.region === "prefrontal")).toBe(false);
  });

  it("emits store-only memory visuals before response text without prefrontal activity", async () => {
    resetLiveMemoryStore();

    const chunks = await createLiveMemoryStream({
      sessionId: "api-chat-store-first",
      message: "I love the color indigo"
    });
    const firstTextIndex = chunks.findIndex((chunk) => chunk.kind === "text");
    const storeIndex = chunks.findIndex((chunk) => chunk.kind === "event" && chunk.event.type === "store");
    const fireIndex = chunks.findIndex(
      (chunk) => chunk.kind === "event" && chunk.event.type === "fire" && chunk.event.region === "hippocampus"
    );

    expect(storeIndex).toBeGreaterThan(-1);
    expect(fireIndex).toBeGreaterThan(storeIndex);
    expect(firstTextIndex).toBeGreaterThan(storeIndex);
    expect(chunks.some((chunk) => chunk.kind === "event" && chunk.event.type === "retrieve")).toBe(false);
    expect(chunks.some((chunk) => chunk.kind === "event" && chunk.event.type === "load")).toBe(false);
    expect(chunks.some((chunk) => chunk.kind === "event" && chunk.event.type === "fire" && chunk.event.region === "prefrontal")).toBe(false);
  });

  it("does not retrieve before declarative memory stores even when a retriever would match", async () => {
    resetLiveMemoryStore();

    await createLiveMemoryStream({
      sessionId: "api-chat-store-gate",
      message: "I like the color blue"
    });

    let retrievalCalls = 0;
    const retriever: MemoryRetriever = {
      provider: "semantic",
      retrieve: ({ memories }) => {
        retrievalCalls += 1;
        return {
          provider: "semantic",
          reason: "Mock retriever would over-match blue to ocean.",
          results: memories.map((memory) => ({ memory, score: 0.92 }))
        };
      }
    };

    const chunks = await createLiveMemoryStream({
      sessionId: "api-chat-store-gate",
      message: "I like the ocean",
      memoryRetriever: retriever
    });
    const eventTypes = chunks
      .filter((chunk) => chunk.kind === "event")
      .map((chunk) => (chunk.kind === "event" ? chunk.event.type : "none"));

    expect(retrievalCalls).toBe(0);
    expect(eventTypes).toContain("store");
    expect(eventTypes).not.toContain("retrieve");
    expect(eventTypes).not.toContain("load");
    expect(eventTypes).not.toContain("consolidate");
    expect(chunks.some((chunk) => chunk.kind === "event" && chunk.event.type === "fire" && chunk.event.region === "prefrontal")).toBe(false);
  });

  it("stores San Francisco life statements without loading active context and then consolidates them", async () => {
    resetLiveMemoryStore();

    const deterministicPlanners = {
      memoryConsolidationPlanner: deterministicMemoryConsolidationPlanner,
      memoryDecisionPlanner: deterministicMemoryDecisionPlanner
    };

    await createLiveMemoryStream({
      ...deterministicPlanners,
      sessionId: "api-chat-sf-life",
      message: "I moved to san francisco a couple years ago"
    });

    const secondTurn = await createLiveMemoryStream({
      ...deterministicPlanners,
      sessionId: "api-chat-sf-life",
      message: "I love the access to nature and beaches in San Fransciso"
    });

    expect(eventTypes(secondTurn)).not.toContain("consolidate");

    const chunks = await createLiveMemoryStream({
      ...deterministicPlanners,
      sessionId: "api-chat-sf-life",
      message: "San Francisco has amazing coffee roasters"
    });
    const events = chunks
      .filter((chunk) => chunk.kind === "event")
      .map((chunk) => (chunk.kind === "event" ? chunk.event : null))
      .filter((event): event is NonNullable<typeof event> => Boolean(event));
    const types = events.map((event) => event.type);
    const store = events.find((event) => event.type === "store");
    const consolidate = events.find((event) => event.type === "consolidate");

    expect(types).toContain("store");
    expect(types).toContain("consolidate");
    expect(types).not.toContain("retrieve");
    expect(types).not.toContain("load");
    expect(events.some((event) => event.type === "fire" && event.region === "prefrontal")).toBe(false);
    expect(store?.type).toBe("store");
    if (store?.type !== "store") throw new Error("expected store event");
    expect(store.memory.topic).toBe("location");
    expect(consolidate?.type).toBe("consolidate");
    if (consolidate?.type !== "consolidate") throw new Error("expected consolidate event");
    expect(consolidate.removed).toHaveLength(3);
    expect(consolidate.added.region).toBe("temporal");
    expect(consolidate.added.topic).toBe("location");
    expect(consolidate.added.text).toContain("place and life-context");
  });

  it("does not store standalone world facts as user memories", async () => {
    resetLiveMemoryStore();

    const chunks = await createLiveMemoryStream({
      sessionId: "api-chat-world-fact",
      message: "San Francisco has amazing coffee roasters"
    });
    const eventTypes = chunks
      .filter((chunk) => chunk.kind === "event")
      .map((chunk) => (chunk.kind === "event" ? chunk.event.type : "none"));

    expect(eventTypes).not.toContain("store");
    expect(eventTypes).not.toContain("retrieve");
    expect(eventTypes).not.toContain("load");
  });

  it("stores corrections and avoids retrieving superseded memories", async () => {
    resetLiveMemoryStore();

    const firstTurn = await createLiveMemoryStream({
      sessionId: "api-chat-correction",
      message: "I live in San Francisco"
    });
    const original = firstTurn.find((chunk) => chunk.kind === "event" && chunk.event.type === "store");
    expect(original?.kind).toBe("event");
    if (original?.kind !== "event" || original.event.type !== "store") {
      throw new Error("expected original store event");
    }

    const correctionTurn = await createLiveMemoryStream({
      sessionId: "api-chat-correction",
      message: "Actually, I live in Oakland now"
    });
    const correction = correctionTurn.find((chunk) => chunk.kind === "event" && chunk.event.type === "store");
    expect(correction?.kind).toBe("event");
    if (correction?.kind !== "event" || correction.event.type !== "store") {
      throw new Error("expected correction store event");
    }
    expect(correction.event.memory.supersedes).toEqual([original.event.memory.id]);

    const questionTurn = await createLiveMemoryStream({
      sessionId: "api-chat-correction",
      message: "Where do I live?"
    });
    const retrieve = questionTurn.find((chunk) => chunk.kind === "event" && chunk.event.type === "retrieve");

    expect(retrieve?.kind).toBe("event");
    if (retrieve?.kind !== "event" || retrieve.event.type !== "retrieve") {
      throw new Error("expected retrieve event");
    }
    expect(retrieve.event.ids).toContain(correction.event.memory.id);
    expect(retrieve.event.ids).not.toContain(original.event.memory.id);
  });

  it("does not store trivial questions but still streams a response and done", async () => {
    resetLiveMemoryStore();

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "api-chat-c",
          message: "What is this app?"
        })
      })
    );

    const chunks = decodeSseChunks(await response.text());

    expect(chunks.some((chunk) => chunk.kind === "text" && chunk.delta.length > 0)).toBe(true);
    expect(chunks.some((chunk) => chunk.kind === "event" && chunk.event.type === "store")).toBe(
      false
    );
    expect(chunks.at(-1)).toEqual({ kind: "done" });
  });

  it("stores through an injected memory decision planner", async () => {
    resetLiveMemoryStore();

    const planner: MemoryDecisionPlanner = {
      provider: "llm",
      decide: () => ({
        provider: "llm",
        operation: "store",
        confidence: 0.91,
        reason: "Mock planner extracted a durable preference.",
        memoryText: "User wants concise summaries",
        topic: "preference",
        importance: 0.82,
        relatedMemoryIds: []
      })
    };

    const chunks = await createLiveMemoryStream({
      sessionId: "api-chat-planner-store",
      message: "Please summarize this paragraph for me.",
      memoryDecisionPlanner: planner
    });
    const storeChunk = chunks.find((chunk) => chunk.kind === "event" && chunk.event.type === "store");

    expect(storeChunk?.kind).toBe("event");
    if (storeChunk?.kind !== "event" || storeChunk.event.type !== "store") {
      throw new Error("expected store event");
    }
    expect(storeChunk.event.memory.text).toBe("User wants concise summaries");
    expect(storeChunk.event.memory.importance).toBe(0.82);
    expect(storeChunk.event.decision).toMatchObject({
      provider: "llm",
      operation: "store",
      reason: "Mock planner extracted a durable preference."
    });
  });

  it("passes current memories into the injected turn planner before retrieval", async () => {
    resetLiveMemoryStore();

    await createLiveMemoryStream({
      sessionId: "api-chat-planner-related",
      message: "I like the color blue"
    });

    let visibleMemoryTexts: string[] = [];
    const planner: TurnMemoryPlanner = {
      provider: "llm",
      decide: (input) => {
        visibleMemoryTexts = input.memories?.map((memory) => memory.text) ?? [];
        return {
          provider: "llm",
          confidence: 0.96,
          reason: "Question should retrieve memory.",
          intent: "memory_question",
          shouldRetrieve: true,
          retrieveQuery: input.message,
          memories: [],
          supersedeMemoryIds: []
        };
      }
    };

    await createLiveMemoryStream({
      sessionId: "api-chat-planner-related",
      message: "What is my favorite color?",
      turnMemoryPlanner: planner
    });

    expect(visibleMemoryTexts).toContain("I like the color blue");
  });

  it("emits planner provenance when a memory decision skips storage", async () => {
    resetLiveMemoryStore();

    const planner: MemoryDecisionPlanner = {
      provider: "llm",
      decide: () => ({
        provider: "llm",
        operation: "ignore",
        confidence: 0.94,
        reason: "This is a question, not a durable memory.",
        relatedMemoryIds: []
      })
    };

    const chunks = await createLiveMemoryStream({
      sessionId: "api-chat-planner-ignore",
      message: "What color do I like?",
      memoryDecisionPlanner: planner
    });
    const planChunk = chunks.find((chunk) => chunk.kind === "event" && chunk.event.type === "plan");

    expect(planChunk?.kind).toBe("event");
    if (planChunk?.kind !== "event" || planChunk.event.type !== "plan") {
      throw new Error("expected plan event");
    }
    expect(planChunk.event.decision).toMatchObject({
      stage: "memory",
      operation: "ignore",
      provider: "llm",
      reason: "This is a question, not a durable memory."
    });
  });

  it("can retrieve through an injected semantic retriever", async () => {
    resetLiveMemoryStore();

    await createLiveMemoryStream({
      sessionId: "api-chat-semantic-retriever",
      message: "remember that I prefer calm clinical cyberpunk interfaces"
    });

    const retriever: MemoryRetriever = {
      provider: "semantic",
      retrieve: ({ memories }) => ({
        provider: "semantic",
        reason: "Mock semantic retriever matched visual style intent.",
        results: memories.map((memory) => ({ memory, score: 0.92 }))
      })
    };

    const chunks = await createLiveMemoryStream({
      sessionId: "api-chat-semantic-retriever",
      message: "What visual style should this app use?",
      memoryRetriever: retriever
    });
    const retrieveChunk = chunks.find(
      (chunk) => chunk.kind === "event" && chunk.event.type === "retrieve"
    );

    expect(retrieveChunk?.kind).toBe("event");
    if (retrieveChunk?.kind !== "event" || retrieveChunk.event.type !== "retrieve") {
      throw new Error("expected retrieve event");
    }
    expect(retrieveChunk.event.ids).toHaveLength(1);
    expect(retrieveChunk.event.retrieval).toEqual({
      provider: "semantic",
      reason: "Mock semantic retriever matched visual style intent.",
      matches: [
        expect.objectContaining({
          basis: "semantic",
          rank: 1,
          score: 0.92,
          selected: true
        })
      ]
    });
  });

  it("consolidates repeated same-topic hippocampus memories into temporal memory", async () => {
    resetLiveMemoryStore();

    await drainResponse(
      await POST(
        new Request("http://localhost/api/chat", {
          method: "POST",
          body: JSON.stringify({
            sessionId: "api-chat-d",
            message: "remember that I prefer quiet cyberpunk medical interfaces"
          })
        })
      )
    );

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "api-chat-d",
          message: "remember that I like restrained interface design"
        })
      })
    );

    const chunks = decodeSseChunks(await response.text());
    const consolidateChunk = chunks.find(
      (chunk) => chunk.kind === "event" && chunk.event.type === "consolidate"
    );

    expect(consolidateChunk?.kind).toBe("event");
    if (consolidateChunk?.kind !== "event" || consolidateChunk.event.type !== "consolidate") {
      throw new Error("expected consolidate event");
    }
    expect(consolidateChunk.event.removed).toHaveLength(2);
    expect(consolidateChunk.event.added.region).toBe("temporal");
    expect(consolidateChunk.event.added.text).toContain("recurring design memories");
  });

  it("consolidates through an injected async consolidation planner", async () => {
    resetLiveMemoryStore();

    const planner: MemoryConsolidationPlanner = {
      provider: "llm",
      decide: async ({ memories }) => {
        const hippocampusMemories = memories.filter((memory) => memory.region === "hippocampus");

        if (hippocampusMemories.length < 2) {
          return {
            provider: "llm",
            operation: "skip",
            confidence: 0.94,
            reason: "Not enough raw memories yet."
          };
        }

        return {
          provider: "llm",
          operation: "consolidate",
          confidence: 0.93,
          reason: "Mock planner found a stable design preference.",
          ids: hippocampusMemories.slice(0, 2).map((memory) => memory.id),
          consolidatedText: "User prefers restrained red medical interface design."
        };
      }
    };

    await createLiveMemoryStream({
      sessionId: "api-chat-consolidation-planner",
      message: "remember that I prefer red interface accents",
      memoryConsolidationPlanner: planner
    });

    const chunks = await createLiveMemoryStream({
      sessionId: "api-chat-consolidation-planner",
      message: "remember that I like restrained medical UI",
      memoryConsolidationPlanner: planner
    });
    const consolidateChunk = chunks.find(
      (chunk) => chunk.kind === "event" && chunk.event.type === "consolidate"
    );

    expect(consolidateChunk?.kind).toBe("event");
    if (consolidateChunk?.kind !== "event" || consolidateChunk.event.type !== "consolidate") {
      throw new Error("expected consolidate event");
    }
    expect(consolidateChunk.event.removed).toHaveLength(2);
    expect(consolidateChunk.event.added.region).toBe("temporal");
    expect(consolidateChunk.event.added.text).toBe(
      "User prefers restrained red medical interface design."
    );
    expect(consolidateChunk.event.decision).toMatchObject({
      provider: "llm",
      operation: "consolidate",
      reason: "Mock planner found a stable design preference."
    });
  });
});

async function drainResponse(response: Response) {
  await response.text();
}

function eventTypes(chunks: Awaited<ReturnType<typeof createLiveMemoryStream>>) {
  return chunks
    .filter((chunk) => chunk.kind === "event")
    .map((chunk) => (chunk.kind === "event" ? chunk.event.type : "none"));
}
