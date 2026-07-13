import { describe, expect, it } from "vitest";
import { createConsolidatedMemory } from "@/lib/memory/consolidate";
import { findConsolidationCandidate } from "@/lib/memory/consolidationPolicy";
import { evaluateMemoryCandidate } from "@/lib/memory/rules";
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

  it("does not retrieve memories by importance alone", () => {
    const session = createMemorySession("session-d");
    createMemory(session, {
      text: "User likes the color blue",
      importance: 0.9,
      topic: "design"
    });

    expect(retrieveMemories(listMemories(session), "I like the ocean")).toEqual([]);
  });

  it("maps concrete color words so color questions retrieve color memories", () => {
    const session = createMemorySession("session-e");
    const color = createMemory(session, {
      text: "User loves red",
      importance: 0.78,
      topic: "preference"
    });

    const results = retrieveMemories(listMemories(session), "what is my favorite color?");
    expect(results.map((result) => result.memory.id)).toEqual([color.id]);
  });

  it("normalizes simple plurals for interface and color follow-ups", () => {
    const session = createMemorySession("session-f");
    const design = createMemory(session, {
      text: "User prefers deep red interfaces and dark dashboards",
      importance: 0.78,
      topic: "design"
    });

    const results = retrieveMemories(listMemories(session), "What interface colors do I prefer?");
    expect(results.map((result) => result.memory.id)).toEqual([design.id]);
  });
});

describe("memory quality rules", () => {
  it("stores explicit user preferences with deterministic importance and topic", () => {
    const candidate = evaluateMemoryCandidate(
      "Remember that I prefer restrained medical cyberpunk interfaces."
    );

    expect(candidate.shouldStore).toBe(true);
    expect(candidate.reason).toBe("explicit-memory");
    expect(candidate.importance).toBeGreaterThanOrEqual(0.8);
    expect(candidate.topic).toBe("design");
  });

  it("stores personal facts without requiring explicit remember wording", () => {
    const candidate = evaluateMemoryCandidate("My project is an app for visualizing LLM memory.");

    expect(candidate.shouldStore).toBe(true);
    expect(candidate.reason).toBe("personal-fact");
    expect(candidate.topic).toBe("work");
  });

  it("stores moved-to-place facts as location memories", () => {
    const candidate = evaluateMemoryCandidate("I moved to San Francisco a couple years ago.");

    expect(candidate.shouldStore).toBe(true);
    expect(candidate.reason).toBe("personal-fact");
    expect(candidate.topic).toBe("location");
  });

  it("stores place appreciation statements as location memories", () => {
    const candidate = evaluateMemoryCandidate("San Francisco has amazing coffee roasters.");

    expect(candidate.shouldStore).toBe(true);
    expect(candidate.reason).toBe("place-fact");
    expect(candidate.topic).toBe("location");
  });

  it("recognizes common San Francisco misspellings in location memories", () => {
    const candidate = evaluateMemoryCandidate(
      "I love the access to nature and beaches in San Fransciso."
    );

    expect(candidate.shouldStore).toBe(true);
    expect(candidate.reason).toBe("preference");
    expect(candidate.topic).toBe("location");
  });

  it("rejects empty content and trivial questions", () => {
    expect(evaluateMemoryCandidate("   ").shouldStore).toBe(false);

    const question = evaluateMemoryCandidate("What is the weather today?");
    expect(question.shouldStore).toBe(false);
    expect(question.reason).toBe("trivial-question");

    const preferenceQuestion = evaluateMemoryCandidate("What interface style do I prefer?");
    expect(preferenceQuestion.shouldStore).toBe(false);
    expect(preferenceQuestion.reason).toBe("trivial-question");
  });

  it("rejects transient commands that are not durable user facts", () => {
    const candidate = evaluateMemoryCandidate("Please summarize this paragraph for me.");

    expect(candidate.shouldStore).toBe(false);
    expect(candidate.reason).toBe("transient");
  });
});

describe("memory consolidation", () => {
  it("selects same-topic hippocampus memories for deterministic consolidation", () => {
    const candidate = findConsolidationCandidate([
      {
        id: "a",
        text: "Remember that I prefer red interfaces",
        importance: 0.84,
        topic: "design",
        region: "hippocampus",
        created_at: "2026-04-29T17:00:00.000Z",
        access_count: 0
      },
      {
        id: "b",
        text: "Remember that I like restrained medical UI",
        importance: 0.84,
        topic: "design",
        region: "hippocampus",
        created_at: "2026-04-29T17:01:00.000Z",
        access_count: 0
      },
      {
        id: "c",
        text: "The deployment target is Vercel",
        importance: 0.68,
        topic: "technical",
        region: "hippocampus",
        created_at: "2026-04-29T17:02:00.000Z",
        access_count: 0
      }
    ]);

    expect(candidate?.ids).toEqual(["a", "b"]);
    expect(candidate?.consolidatedText).toContain("recurring design memories");
    expect(candidate?.consolidatedText).not.toContain("Remember that");
  });

  it("does not consolidate temporal memories or singleton topics", () => {
    const candidate = findConsolidationCandidate([
      {
        id: "a",
        text: "User likes red",
        importance: 0.84,
        topic: "design",
        region: "temporal",
        created_at: "2026-04-29T17:00:00.000Z",
        access_count: 0
      }
    ]);

    expect(candidate).toBeNull();
  });

  it("waits for three related location memories before consolidation", () => {
    const twoLocationMemories = [
      {
        id: "sf-move",
        text: "User moved to San Francisco a couple of years ago.",
        importance: 0.82,
        topic: "location",
        region: "hippocampus" as const,
        created_at: "2026-04-29T17:00:00.000Z",
        access_count: 0
      },
      {
        id: "sf-nature",
        text: "User loves access to nature and beaches in San Francisco.",
        importance: 0.74,
        topic: "location",
        region: "hippocampus" as const,
        created_at: "2026-04-29T17:01:00.000Z",
        access_count: 0
      }
    ];

    expect(findConsolidationCandidate(twoLocationMemories)).toBeNull();

    const candidate = findConsolidationCandidate([
      ...twoLocationMemories,
      {
        id: "sf-coffee",
        text: "User appreciates San Francisco coffee roasters.",
        importance: 0.7,
        topic: "location",
        region: "hippocampus",
        created_at: "2026-04-29T17:02:00.000Z",
        access_count: 0
      }
    ]);

    expect(candidate?.ids).toEqual(["sf-move", "sf-nature", "sf-coffee"]);
    expect(candidate?.consolidatedText).toContain("recurring place and life-context memories");
    expect(candidate?.consolidatedText).toContain("San Francisco coffee roasters");
  });

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
    expect(retrieve.accessed?.[0]).toMatchObject({
      id: retrieve.ids[0],
      access_count: 1
    });
    expect(engine.fire("prefrontal", retrieve.ids)).toEqual({
      type: "fire",
      region: "prefrontal",
      ids: retrieve.ids
    });
  });
});
