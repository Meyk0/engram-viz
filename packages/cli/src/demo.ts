import type { AgentTurnEnvelope, MemoryTelemetryEvent } from "@engramviz/core";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { EngramLocalConfig } from "./config.js";
import { ingestCaptureBundle, type EngramCaptureBundle } from "./import.js";

export const STALE_LOCATION_DEMO = "stale-location";

export function createStaleLocationCapture(options: {
  projectId: string;
  runId?: string;
  now?: Date;
}): EngramCaptureBundle {
  const runId = options.runId ?? randomUUID();
  const started = options.now ?? new Date();
  const sessionId = `demo-session-${runId}`;
  const traceId = `demo-trace-${runId}`;
  const at = (offsetMs: number) => new Date(started.getTime() + offsetMs).toISOString();
  const eventIds = {
    storeSanFrancisco: `demo-event-sf-${runId}`,
    storeOakland: `demo-event-oakland-${runId}`,
    retrieve: `demo-event-retrieve-${runId}`,
    load: `demo-event-load-${runId}`
  };
  const commonEvent = {
    schemaVersion: 2 as const,
    traceId,
    sessionId,
    projectId: options.projectId,
    evidence: {
      level: "mapped" as const,
      adapter: "@engramviz/adapter-mem0",
      sourcePath: "deterministic stale-location demo"
    }
  };
  const telemetry: MemoryTelemetryEvent[] = [
    {
      ...commonEvent,
      eventId: eventIds.storeSanFrancisco,
      timestamp: at(0),
      sequence: 0,
      operation: "store",
      memory: {
        id: "memory-san-francisco",
        content: "User moved to San Francisco.",
        tier: "episodic",
        scope: "user",
        provider: "mem0",
        metadata: { topic: "current_location", status: "active" }
      }
    },
    {
      ...commonEvent,
      eventId: eventIds.storeOakland,
      timestamp: at(1_000),
      sequence: 1,
      operation: "store",
      memory: {
        id: "memory-oakland",
        content: "User lives in Oakland now.",
        tier: "episodic",
        scope: "user",
        provider: "mem0",
        metadata: { topic: "current_location", status: "active" }
      }
    },
    {
      ...commonEvent,
      eventId: eventIds.retrieve,
      timestamp: at(2_000),
      sequence: 2,
      operation: "retrieve",
      memoryIds: ["memory-san-francisco", "memory-oakland"],
      retrieval: {
        query: "What city do I live in now?",
        limit: 2,
        candidates: [
          { memoryId: "memory-san-francisco", rank: 1, score: 0.91, eligible: true, selected: true },
          { memoryId: "memory-oakland", rank: 2, score: 0.88, eligible: true, selected: false }
        ],
        selectedIds: ["memory-san-francisco"]
      }
    },
    {
      ...commonEvent,
      eventId: eventIds.load,
      timestamp: at(2_050),
      sequence: 3,
      operation: "load",
      memoryIds: ["memory-san-francisco"],
      retrieval: { loadedIds: ["memory-san-francisco"] }
    }
  ];
  const turns: AgentTurnEnvelope[] = [
    turn({
      runId,
      traceId,
      sessionId,
      projectId: options.projectId,
      index: 1,
      startedAt: at(0),
      completedAt: at(250),
      input: "I moved to San Francisco.",
      output: "I will remember that.",
      telemetryEventIds: [eventIds.storeSanFrancisco]
    }),
    turn({
      runId,
      traceId,
      sessionId,
      projectId: options.projectId,
      index: 2,
      startedAt: at(1_000),
      completedAt: at(1_250),
      input: "Actually, I live in Oakland now.",
      output: "I will remember the correction.",
      telemetryEventIds: [eventIds.storeOakland]
    }),
    turn({
      runId,
      traceId,
      sessionId,
      projectId: options.projectId,
      index: 3,
      startedAt: at(2_000),
      completedAt: at(2_300),
      input: "What city do I live in now?",
      output: "You live in San Francisco.",
      telemetryEventIds: [eventIds.retrieve, eventIds.load]
    })
  ];

  return { format: "engram.capture", version: 1, telemetry, turns };
}

export async function seedStaleLocationDemo(options: {
  endpoint: string;
  config: EngramLocalConfig;
  fetch?: typeof fetch;
  runId?: string;
  now?: Date;
}) {
  return ingestCaptureBundle(createStaleLocationCapture({
    projectId: options.config.projectId,
    ...(options.runId ? { runId: options.runId } : {}),
    ...(options.now ? { now: options.now } : {})
  }), options);
}

export async function waitForStudio(options: {
  endpoint: string;
  child?: ChildProcess;
  fetch?: typeof fetch;
  timeoutMs?: number;
}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  while (Date.now() < deadline) {
    if (options.child && options.child.exitCode !== null) {
      throw new Error(`Engram Studio exited before it became ready (${options.child.exitCode}).`);
    }
    try {
      const response = await fetchImpl(new URL("/api/local/traces", options.endpoint));
      if (response.ok) return;
    } catch {
      // Studio is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for Engram Studio at ${options.endpoint}.`);
}

function turn(input: {
  runId: string;
  traceId: string;
  sessionId: string;
  projectId: string;
  index: number;
  startedAt: string;
  completedAt: string;
  input: string;
  output: string;
  telemetryEventIds: string[];
}): AgentTurnEnvelope {
  return {
    schemaVersion: 1,
    turnId: `demo-turn-${input.index}-${input.runId}`,
    traceId: input.traceId,
    sessionId: input.sessionId,
    projectId: input.projectId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    input: input.input,
    output: input.output,
    status: "completed",
    provider: { id: "fixture-agent", model: "deterministic-stale-location" },
    telemetryEventIds: input.telemetryEventIds,
    metadata: { demo: STALE_LOCATION_DEMO, turnIndex: input.index }
  };
}
