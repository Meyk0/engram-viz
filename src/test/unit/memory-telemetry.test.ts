import { describe, expect, it } from "vitest";
import {
  brainRegionToMemoryTier,
  engramEventToTelemetry,
  memoryTierToBrainRegion,
  parseMemoryTelemetryEvent,
  telemetryEventToEngramEvent
} from "@/lib/telemetry";

const timestamp = "2026-07-14T18:00:00.000Z";

describe("memory telemetry v2", () => {
  it("accepts an anatomy-independent observed store event", () => {
    const event = parseMemoryTelemetryEvent({
      schemaVersion: 2,
      eventId: "event-1",
      traceId: "trace-1",
      timestamp,
      sequence: 0,
      operation: "store",
      memory: {
        id: "memory-1",
        content: "User prefers indigo.",
        tier: "episodic",
        scope: "user"
      },
      evidence: { level: "observed", adapter: "test-agent" }
    });

    expect(event.memory?.tier).toBe("episodic");
    expect(event).not.toHaveProperty("region");
  });

  it("requires operation-specific evidence", () => {
    expect(() => parseMemoryTelemetryEvent({
      schemaVersion: 2,
      eventId: "event-2",
      traceId: "trace-1",
      timestamp,
      sequence: 1,
      operation: "retrieve",
      evidence: { level: "observed", adapter: "test-agent" }
    })).toThrow(/retrieval evidence/i);

    expect(() => parseMemoryTelemetryEvent({
      schemaVersion: 2,
      eventId: "event-3",
      traceId: "trace-1",
      timestamp,
      sequence: 2,
      operation: "load",
      evidence: { level: "observed", adapter: "test-agent" }
    })).toThrow(/memory id/i);
  });

  it("maps v1 storage and retrieval into ordered telemetry", () => {
    const store = engramEventToTelemetry({
      type: "store",
      memory: {
        id: "memory-indigo",
        text: "User likes indigo.",
        importance: 0.8,
        region: "hippocampus",
        created_at: timestamp,
        access_count: 0
      }
    }, {
      traceId: "trace-1",
      timestamp,
      sequence: 3,
      scope: "user",
      evidence: { level: "observed", adapter: "engram-chat" }
    });

    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({
      schemaVersion: 2,
      eventId: "trace-1:memory:3",
      operation: "store",
      memory: { tier: "episodic", scope: "user" },
      evidence: { level: "observed", adapter: "engram-chat" }
    });

    const retrieval = engramEventToTelemetry({
      type: "retrieve",
      query: "favorite color",
      ids: ["memory-indigo"],
      retrieval: {
        provider: "semantic",
        limit: 3,
        matches: [{
          id: "memory-indigo",
          rank: 1,
          score: 0.91,
          basis: "semantic",
          selected: true
        }]
      }
    }, { traceId: "trace-1", timestamp, sequence: 4 });

    expect(retrieval[0]).toMatchObject({
      operation: "retrieve",
      retrieval: {
        query: "favorite color",
        limit: 3,
        selectedIds: ["memory-indigo"],
        candidates: [{ memoryId: "memory-indigo", rank: 1, score: 0.91, selected: true }]
      }
    });
  });

  it("round-trips supported episodic memories through the compatibility boundary", () => {
    const telemetry = parseMemoryTelemetryEvent({
      schemaVersion: 2,
      eventId: "event-roundtrip",
      traceId: "trace-roundtrip",
      timestamp,
      sequence: 0,
      operation: "store",
      memory: {
        id: "memory-roundtrip",
        content: "User lives in Oakland.",
        tier: "episodic",
        scope: "user",
        metadata: { importance: 0.82, accessCount: 2, topic: "location" }
      },
      evidence: { level: "observed", adapter: "test-agent" }
    });

    expect(telemetryEventToEngramEvent(telemetry)).toEqual({
      type: "store",
      memory: {
        id: "memory-roundtrip",
        text: "User lives in Oakland.",
        importance: 0.82,
        region: "hippocampus",
        created_at: timestamp,
        access_count: 2,
        topic: "location"
      }
    });
  });

  it("does not force unsupported operational tiers into anatomy", () => {
    expect(memoryTierToBrainRegion("procedural")).toBeUndefined();
    expect(memoryTierToBrainRegion("unknown")).toBeUndefined();
    expect(brainRegionToMemoryTier("prefrontal")).toBe("working");
  });
});
