import { describe, expect, it } from "vitest";
import { createConsolidatedMemory } from "@/lib/memory/consolidate";
import { retrieveMemories } from "@/lib/memory/retrieve";
import { MemoryEngine } from "@/lib/memory/engine";
import {
  createMemory,
  createMemorySession,
  listMemories,
  markAccessed
} from "@/lib/memory/store";
import { InMemoryMemoryStore } from "@/lib/memory/store-interface";

describe("memory store", () => {
  it("stores new memories in the hippocampus", () => {
    const session = createMemorySession("session-a");
    const memory = createMemory(session, {
      text: "User likes cyberpunk medical interfaces",
      importance: 0.8,
      topic: "design",
      now: "2026-04-29T17:00:00.000Z"
    });

    expect(memory.id).toBe("session-a-mem-1");
    expect(memory.region).toBe("hippocampus");
    expect(listMemories(session)).toHaveLength(1);
  });

  it("moves repeatedly accessed hippocampal memories to temporal memory", () => {
    const session = createMemorySession("session-b");
    const memory = createMemory(session, {
      text: "Repeated fact",
      now: "2026-04-29T17:00:00.000Z"
    });

    markAccessed(session, [memory.id], "2026-04-29T17:01:00.000Z");
    markAccessed(session, [memory.id], "2026-04-29T17:02:00.000Z");
    const [updated] = markAccessed(session, [memory.id], "2026-04-29T17:03:00.000Z");

    expect(updated.access_count).toBe(3);
    expect(updated.region).toBe("temporal");
  });
});

describe("memory retrieval", () => {
  it("ranks deterministic lexical matches by relevance", () => {
    const session = createMemorySession("session-c");
    const design = createMemory(session, {
      text: "User wants a glowing brain interface",
      importance: 0.7,
      topic: "design"
    });
    createMemory(session, {
      text: "The deployment target is Vercel",
      importance: 0.7,
      topic: "deployment"
    });

    const results = retrieveMemories(listMemories(session), "glowing brain design", 1);
    expect(results[0].memory.id).toBe(design.id);
  });
});

describe("memory consolidation", () => {
  it("creates a temporal summary with source importance", () => {
    const consolidated = createConsolidatedMemory({
      id: "summary",
      text: "User cares about honest memory metaphors",
      now: "2026-04-29T17:10:00.000Z",
      sourceMemories: [
        {
          id: "a",
          text: "User likes honest metaphors",
          importance: 0.9,
          topic: "product",
          region: "hippocampus",
          created_at: "2026-04-29T17:00:00.000Z",
          access_count: 2
        }
      ]
    });

    expect(consolidated.region).toBe("temporal");
    expect(consolidated.importance).toBe(0.9);
    expect(consolidated.topic).toBe("product");
  });
});

describe("memory engine", () => {
  it("initializes, stores, retrieves, and fires through a store interface", async () => {
    const engine = new MemoryEngine(new InMemoryMemoryStore());
    const init = await engine.initialize("engine-a");
    const store = await engine.storeMemory({
      sessionId: "engine-a",
      text: "User prefers restrained cyberpunk interfaces",
      topic: "design",
      now: "2026-04-29T18:00:00.000Z"
    });
    const retrieve = await engine.retrieve({
      sessionId: "engine-a",
      query: "cyberpunk design preference",
      now: "2026-04-29T18:01:00.000Z"
    });

    expect(init).toEqual({ type: "init", memories: [] });
    expect(store.type).toBe("store");
    expect(retrieve.type).toBe("retrieve");
    if (retrieve.type !== "retrieve") throw new Error("expected retrieve event");
    expect(retrieve.ids).toHaveLength(1);
    expect(engine.fire("prefrontal", retrieve.ids)).toEqual({
      type: "fire",
      region: "prefrontal",
      ids: retrieve.ids
    });
  });
});
