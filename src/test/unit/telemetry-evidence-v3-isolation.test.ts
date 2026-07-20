import type { AgentTurnEnvelope, MemoryTelemetryEvent } from "@engramviz/core";
import { describe, expect, it } from "vitest";
import type { StoredMemoryTelemetryEvent } from "@/lib/ingest/types";
import type { StoredAgentTurn } from "@/lib/turns/store";
import { buildTelemetryTraces } from "@/lib/traces/from-telemetry";
import type { EngramEvent } from "@/types";

describe("telemetry evidence v3 reconstruction isolation", () => {
  it("keeps same-id memories isolated by user even when sessions are shared", () => {
    const turns = [
      storedTurn(1, turn("store-a", "trace-store-a", "user-a", "2026-07-20T10:00:00.000Z", ["event-store-a"])),
      storedTurn(2, turn("store-b", "trace-store-b", "user-b", "2026-07-20T10:01:00.000Z", ["event-store-b"])),
      storedTurn(3, turn("recall-a", "trace-recall-a", "user-a", "2026-07-20T10:02:00.000Z")),
      storedTurn(4, turn("recall-b", "trace-recall-b", "user-b", "2026-07-20T10:03:00.000Z"))
    ];
    const events = [
      storedEvent(1, storeEvent("event-store-a", "trace-store-a", "user-a", "User A lives in Oakland.")),
      storedEvent(2, storeEvent("event-store-b", "trace-store-b", "user-b", "User B lives in Berlin."))
    ];

    const traces = buildTelemetryTraces(turns, events);

    expect(initialMemoryTexts(traces[2]!)).toEqual(["User A lives in Oakland."]);
    expect(initialMemoryTexts(traces[3]!)).toEqual(["User B lives in Berlin."]);
  });

  it("keeps legacy identity-less state isolated by session", () => {
    const turns = [
      storedTurn(1, legacyTurn("store-a", "trace-store-a", "session-a", "2026-07-20T10:00:00.000Z", ["event-store-a"])),
      storedTurn(2, legacyTurn("store-b", "trace-store-b", "session-b", "2026-07-20T10:01:00.000Z", ["event-store-b"])),
      storedTurn(3, legacyTurn("recall-a", "trace-recall-a", "session-a", "2026-07-20T10:02:00.000Z")),
      storedTurn(4, legacyTurn("recall-b", "trace-recall-b", "session-b", "2026-07-20T10:03:00.000Z"))
    ];
    const events = [
      storedEvent(1, storeEvent("event-store-a", "trace-store-a", undefined, "Session A memory.", "session-a")),
      storedEvent(2, storeEvent("event-store-b", "trace-store-b", undefined, "Session B memory.", "session-b"))
    ];

    const traces = buildTelemetryTraces(turns, events);

    expect(initialMemoryTexts(traces[2]!)).toEqual(["Session A memory."]);
    expect(initialMemoryTexts(traces[3]!)).toEqual(["Session B memory."]);
  });

  it("uses a consistent provider owner before falling back to a shared session", () => {
    const turns = [
      storedTurn(1, legacyTurn("store-a", "trace-store-a", "session-shared", "2026-07-20T10:00:00.000Z", ["event-store-a"])),
      storedTurn(2, legacyTurn("store-b", "trace-store-b", "session-shared", "2026-07-20T10:01:00.000Z", ["event-store-b"])),
      storedTurn(3, legacyTurn("recall-a", "trace-recall-a", "session-shared", "2026-07-20T10:02:00.000Z", ["event-recall-a"])),
      storedTurn(4, legacyTurn("recall-b", "trace-recall-b", "session-shared", "2026-07-20T10:03:00.000Z", ["event-recall-b"]))
    ];
    const events = [
      storedEvent(1, ownerStoreEvent("event-store-a", "trace-store-a", "owner-a", "Owner A memory.")),
      storedEvent(2, ownerStoreEvent("event-store-b", "trace-store-b", "owner-b", "Owner B memory.")),
      storedEvent(3, ownerRetrievalEvent("event-recall-a", "trace-recall-a", "owner-a")),
      storedEvent(4, ownerRetrievalEvent("event-recall-b", "trace-recall-b", "owner-b"))
    ];

    const traces = buildTelemetryTraces(turns, events);

    expect(initialMemoryTexts(traces[2]!)).toEqual(["Owner A memory."]);
    expect(initialMemoryTexts(traces[3]!)).toEqual(["Owner B memory."]);
  });

  it("reconstructs selected memory content from a candidate snapshot without a prior store event", () => {
    const recall = turn("recall-a", "trace-recall-a", "user-a", "2026-07-20T10:00:00.000Z", ["event-retrieve-a"]);
    const retrieval: MemoryTelemetryEvent = {
      schemaVersion: 2,
      eventId: "event-retrieve-a",
      traceId: recall.traceId,
      sessionId: recall.sessionId,
      userId: "user-a",
      owner: { userId: "user-a" },
      timestamp: recall.startedAt,
      sequence: 0,
      operation: "retrieve",
      memoryIds: ["memory-city"],
      retrieval: {
        query: "Where do I live?",
        selectedIds: ["memory-city"],
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
          selected: true
        }]
      },
      evidence: { level: "observed", adapter: "fixture" }
    };

    const [trace] = buildTelemetryTraces([storedTurn(1, recall)], [storedEvent(1, retrieval)]);
    const retrieve = trace!.steps
      .flatMap((step) => step.memoryMappings)
      .map((mapping) => mapping.event)
      .find((event): event is Extract<EngramEvent, { type: "retrieve" }> => event?.type === "retrieve");

    expect(retrieve?.accessed).toEqual([expect.objectContaining({
      id: "memory-city",
      text: "User lives in Oakland."
    })]);
  });
});

function turn(
  turnId: string,
  traceId: string,
  userId: string,
  startedAt: string,
  telemetryEventIds: string[] = []
): AgentTurnEnvelope {
  return {
    ...legacyTurn(turnId, traceId, "session-shared", startedAt, telemetryEventIds),
    userId,
    owner: { userId }
  };
}

function legacyTurn(
  turnId: string,
  traceId: string,
  sessionId: string,
  startedAt: string,
  telemetryEventIds: string[] = []
): AgentTurnEnvelope {
  return {
    schemaVersion: 1,
    turnId,
    traceId,
    sessionId,
    projectId: "project",
    startedAt,
    completedAt: startedAt,
    input: turnId,
    output: "Done.",
    status: "completed",
    provider: { id: "fixture" },
    telemetryEventIds
  };
}

function storeEvent(
  eventId: string,
  traceId: string,
  userId: string | undefined,
  content: string,
  sessionId = "session-shared"
): MemoryTelemetryEvent {
  return {
    schemaVersion: 2,
    eventId,
    traceId,
    sessionId,
    ...(userId ? { userId, owner: { userId } } : {}),
    projectId: "project",
    timestamp: "2026-07-20T10:00:00.000Z",
    sequence: 0,
    operation: "store",
    memory: {
      id: "memory-shared-id",
      content,
      tier: "episodic",
      scope: "user",
      ...(userId ? { owner: { userId } } : {})
    },
    evidence: { level: "observed", adapter: "fixture" }
  };
}

function ownerStoreEvent(
  eventId: string,
  traceId: string,
  ownerId: string,
  content: string
): MemoryTelemetryEvent {
  return {
    ...storeEvent(eventId, traceId, undefined, content),
    memory: {
      id: "memory-shared-id",
      content,
      tier: "episodic",
      scope: "user",
      owner: { ownerId }
    }
  };
}

function ownerRetrievalEvent(
  eventId: string,
  traceId: string,
  ownerId: string
): MemoryTelemetryEvent {
  return {
    schemaVersion: 2,
    eventId,
    traceId,
    sessionId: "session-shared",
    projectId: "project",
    timestamp: "2026-07-20T10:02:00.000Z",
    sequence: 0,
    operation: "retrieve",
    retrieval: {
      query: "owner memory",
      candidates: [{
        memoryId: "memory-shared-id",
        memory: {
          id: "memory-shared-id",
          tier: "episodic",
          scope: "user",
          owner: { ownerId }
        },
        rank: 1
      }]
    },
    evidence: { level: "observed", adapter: "fixture" }
  };
}

function storedTurn(cursor: number, value: AgentTurnEnvelope): StoredAgentTurn {
  return {
    cursor,
    tenantId: "tenant",
    projectId: "project",
    receivedAt: value.startedAt,
    turn: value
  };
}

function storedEvent(cursor: number, event: MemoryTelemetryEvent): StoredMemoryTelemetryEvent {
  return {
    cursor,
    tenantId: "tenant",
    projectId: "project",
    eventId: event.eventId,
    sequence: event.sequence,
    occurredAt: event.timestamp,
    receivedAt: event.timestamp,
    event
  };
}

function initialMemoryTexts(trace: ReturnType<typeof buildTelemetryTraces>[number]) {
  const init = trace.steps
    .flatMap((step) => step.memoryMappings)
    .map((mapping) => mapping.event)
    .find((event): event is Extract<EngramEvent, { type: "init" }> => event?.type === "init");
  return init?.memories.map((memory) => memory.text) ?? [];
}
