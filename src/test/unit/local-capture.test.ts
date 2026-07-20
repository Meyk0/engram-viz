import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentTurnEnvelopeSchema, type AgentTurnEnvelope, type MemoryTelemetryEvent } from "@engramviz/core";
import { FileMemoryTelemetryStore } from "@/lib/ingest/file-store";
import type { StoredMemoryTelemetryEvent, TelemetryTenantContext } from "@/lib/ingest/types";
import { buildMemoryIncidentFromTrace } from "@/lib/incidents/from-trace";
import { buildTelemetryTraces } from "@/lib/traces/from-telemetry";
import { FileAgentTurnStore, type StoredAgentTurn } from "@/lib/turns/store";

const directories: string[] = [];
const context: TelemetryTenantContext = { tenantId: "local", projectId: "demo", keyId: "local-key" };

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("local agent capture", () => {
  it("validates completed and failed turn envelopes", () => {
    expect(agentTurnEnvelopeSchema.parse(turn("turn-1", "trace-1")).status).toBe("completed");
    expect(() => agentTurnEnvelopeSchema.parse({ ...turn("turn-2", "trace-2"), output: "" })).toThrow();
    expect(agentTurnEnvelopeSchema.parse({
      ...turn("turn-3", "trace-3"),
      status: "error",
      output: undefined,
      error: { message: "Model unavailable" }
    }).status).toBe("error");
  });

  it("persists telemetry idempotently and restores it after restart", async () => {
    const directory = await temporaryDirectory();
    const first = new FileMemoryTelemetryStore({ directory, now: () => "2026-07-14T10:00:01.000Z" });
    const stored = memoryEvent("event-sf", "trace-store", "memory-sf", "User lives in San Francisco.");
    expect(await first.append(context, [stored, stored])).toEqual({
      acceptedEventIds: ["event-sf"],
      duplicateEventIds: ["event-sf"],
      highWaterCursor: 1
    });

    const restarted = new FileMemoryTelemetryStore({ directory });
    const read = await restarted.read(context, { afterCursor: 0, limit: 10 });
    expect(read.events.map((record) => record.eventId)).toEqual(["event-sf"]);
    expect((await readFile(first.filePath, "utf8")).trim().split("\n")).toHaveLength(1);
  });

  it("persists turn envelopes without duplicating retries", async () => {
    const directory = await temporaryDirectory();
    const first = new FileAgentTurnStore(directory);
    expect(await first.append(context, turn("turn-1", "trace-1"))).toMatchObject({ duplicate: false, cursor: 1 });
    expect(await first.append(context, turn("turn-1", "trace-1"))).toMatchObject({ duplicate: true, cursor: 1 });

    const restarted = new FileAgentTurnStore(directory);
    expect((await restarted.read(context)).map((record) => record.turn.turnId)).toEqual(["turn-1"]);
  });

  it("reconstructs a stale-location incident from observed memory evidence", () => {
    const storeSanFrancisco = turn("turn-store-sf", "trace-store-sf", "I moved to San Francisco.", "That sounds exciting.");
    storeSanFrancisco.startedAt = "2026-07-14T10:00:00.000Z";
    storeSanFrancisco.completedAt = "2026-07-14T10:00:01.000Z";
    const storeOakland = turn("turn-store-oak", "trace-store-oak", "Actually, I live in Oakland now.", "Got it.");
    storeOakland.startedAt = "2026-07-14T10:01:00.000Z";
    storeOakland.completedAt = "2026-07-14T10:01:01.000Z";
    const answer = turn("turn-answer", "trace-answer", "What city do I live in now?", "You live in San Francisco.");
    answer.startedAt = "2026-07-14T10:02:00.000Z";
    answer.completedAt = "2026-07-14T10:02:01.000Z";
    const turns: StoredAgentTurn[] = [
      storedTurn(1, storeSanFrancisco),
      storedTurn(2, storeOakland),
      storedTurn(3, answer)
    ];
    const telemetry: StoredMemoryTelemetryEvent[] = [
      storedEvent(1, memoryEvent("event-sf", "trace-store-sf", "memory-sf", "User moved to San Francisco.")),
      storedEvent(2, memoryEvent("event-oak", "trace-store-oak", "memory-oak", "User lives in Oakland now.", {
        timestamp: "2026-07-14T10:01:00.000Z",
        operation: "update",
        mutation: { sourceMemoryIds: ["memory-sf"], targetMemoryIds: ["memory-oak"], reason: "Current city changed" }
      })),
      storedEvent(3, { ...retrievalEvent(), timestamp: "2026-07-14T10:02:00.100Z" }),
      storedEvent(4, {
        ...baseEvent("event-load", "trace-answer", 2),
        timestamp: "2026-07-14T10:02:00.200Z",
        operation: "load",
        memoryIds: ["memory-sf"],
        retrieval: { loadedIds: ["memory-sf"] }
      })
    ];

    const traces = buildTelemetryTraces(turns, telemetry);
    const answerTrace = traces.at(-1)!;
    const incident = buildMemoryIncidentFromTrace(answerTrace, { expectedAnswer: "You live in Oakland." });

    expect(incident.question).toBe("What city do I live in now?");
    expect(incident.record.retrievedMemories.map((memory) => memory.id)).toEqual(["memory-sf"]);
    expect(incident.record.retrievedMemories[0]?.provider).toBe("mem0");
    expect(incident.memories.map((memory) => memory.id)).toContain("memory-oak");
    expect(incident.evidence.find((item) => item.stage === "retrieval")?.origin).toBe("observed");
    expect(incident.evidence.find((item) => item.stage === "active_context")?.origin).toBe("observed");
    expect(incident.diagnosis.kind).toBe("update");
  });
});

function turn(
  turnId: string,
  traceId: string,
  input = "What city do I live in?",
  output = "Oakland."
): AgentTurnEnvelope {
  return {
    schemaVersion: 1,
    turnId,
    traceId,
    sessionId: "session-1",
    projectId: "demo",
    startedAt: "2026-07-14T10:00:00.000Z",
    completedAt: "2026-07-14T10:00:01.000Z",
    input,
    output,
    status: "completed",
    provider: { id: "openai", model: "gpt-5" }
  };
}

function baseEvent(eventId: string, traceId: string, sequence = 0): MemoryTelemetryEvent {
  return {
    schemaVersion: 2,
    eventId,
    traceId,
    projectId: "demo",
    timestamp: `2026-07-14T10:00:0${sequence}.000Z`,
    sequence,
    operation: "retrieve",
    retrieval: { query: "placeholder" },
    evidence: { level: "observed", adapter: "mem0" }
  };
}

function memoryEvent(
  eventId: string,
  traceId: string,
  memoryId: string,
  content: string,
  overrides: Partial<MemoryTelemetryEvent> = {}
): MemoryTelemetryEvent {
  return {
    ...baseEvent(eventId, traceId),
    operation: "store",
    retrieval: undefined,
    memory: {
      id: memoryId,
      content,
      tier: "episodic",
      scope: "user",
      provider: "mem0"
    },
    ...overrides
  };
}

function retrievalEvent(): MemoryTelemetryEvent {
  return {
    ...baseEvent("event-retrieve", "trace-answer", 1),
    operation: "retrieve",
    memoryIds: ["memory-sf"],
    retrieval: {
      query: "What city do I live in now?",
      selectedIds: ["memory-sf"],
      candidates: [
        { memoryId: "memory-sf", rank: 1, score: 0.91, selected: true },
        { memoryId: "memory-oak", rank: 2, score: 0.88, selected: false }
      ]
    }
  };
}

function storedEvent(cursor: number, event: MemoryTelemetryEvent): StoredMemoryTelemetryEvent {
  return {
    cursor,
    tenantId: context.tenantId,
    projectId: context.projectId,
    eventId: event.eventId,
    sequence: event.sequence,
    occurredAt: event.timestamp,
    receivedAt: event.timestamp,
    event
  };
}

function storedTurn(cursor: number, value: AgentTurnEnvelope): StoredAgentTurn {
  return {
    cursor,
    tenantId: context.tenantId,
    projectId: context.projectId,
    receivedAt: value.completedAt,
    turn: value
  };
}

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "engram-local-capture-"));
  directories.push(directory);
  return directory;
}
