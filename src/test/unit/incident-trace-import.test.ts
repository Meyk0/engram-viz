import { describe, expect, it } from "vitest";
import {
  buildMemoryIncidentFromTrace,
  IncidentTraceImportError
} from "@/lib/incidents/from-trace";
import { importAgentTrace } from "@/lib/traces/import";

describe("incident trace import", () => {
  it("builds a replayable incident from an OpenAI Agents trace", () => {
    const trace = importAgentTrace(openAIIncidentTrace()).trace;
    const incident = buildMemoryIncidentFromTrace(trace, { expectedAnswer: "Oakland" });

    expect(incident.question).toBe("What city do I live in now?");
    expect(incident.observedAnswer).toBe("You live in San Francisco.");
    expect(incident.expectedAnswer).toBe("Oakland");
    expect(incident.record.provider.id).toBe("openai");
    expect(incident.record.retrievedMemories.map((memory) => memory.id)).toEqual(["memory-sf"]);
    expect(incident.diagnosis.kind).toBe("update");
    expect(incident.evidence.find((item) => item.stage === "memory_state")?.origin).toBe("observed");
    expect(incident.evidence.find((item) => item.stage === "active_context")?.origin).toBe("observed");
  });

  it("keeps uninstrumented context loading as unavailable instead of treating it as a failure", () => {
    const trace = importAgentTrace(mappedMemoryToolTrace()).trace;
    const incident = buildMemoryIncidentFromTrace(trace, { expectedAnswer: "Oakland" });

    expect(incident.evidence.find((item) => item.stage === "retrieval")?.origin).toBe("mapped");
    expect(incident.evidence.find((item) => item.stage === "active_context")?.origin).toBe("unavailable");
    expect(incident.stages.find((stage) => stage.kind === "active_context")?.status).toBe("unknown");
    expect(incident.diagnosis.kind).toBe("retrieval");
  });

  it("does not infer a correction from topic and recency alone", () => {
    const fixture = openAIIncidentTrace();
    const oakland = fixture.items.find((item) => item.id === "store-oakland") as unknown as {
      span_data: { data: { event: { memory: { supersedes?: string[] } } } };
    };
    delete oakland.span_data.data.event.memory.supersedes;

    const incident = buildMemoryIncidentFromTrace(importAgentTrace(fixture).trace, { expectedAnswer: "Oakland" });

    expect(incident.diagnosis.kind).toBe("ranking");
    expect(incident.diagnosis.stage).toBe("retrieval");
  });

  it("rejects traces without a recorded model answer", () => {
    const trace = importAgentTrace({
      items: [
        { object: "trace", id: "trace-no-answer", workflow_name: "Incomplete trace" },
        memorySpan("store-only", {
          type: "store",
          memory: memory("memory-only", "User likes coffee.", "preference", "2026-07-14T10:00:00.000Z")
        })
      ]
    }).trace;

    expect(() => buildMemoryIncidentFromTrace(trace, { expectedAnswer: "coffee" }))
      .toThrow(IncidentTraceImportError);
    expect(() => buildMemoryIncidentFromTrace(trace, { expectedAnswer: "coffee" }))
      .toThrow(/no recorded model answer/i);
  });
});

function openAIIncidentTrace() {
  return {
    items: [
      { object: "trace", id: "trace-location-incident", workflow_name: "Location agent" },
      memorySpan("store-sf", {
        type: "store",
        memory: memory("memory-sf", "User moved to San Francisco in 2022.", "current location", "2026-07-14T10:00:00.000Z")
      }),
      memorySpan("store-oakland", {
        type: "store",
        memory: {
          ...memory("memory-oakland", "User lives in Oakland now.", "current location", "2026-07-14T10:10:00.000Z"),
          supersedes: ["memory-sf"]
        }
      }),
      memorySpan("retrieve-location", {
        type: "retrieve",
        query: "What city do I live in now?",
        ids: ["memory-sf"],
        retrieval: {
          provider: "semantic",
          candidateCount: 2,
          eligibleCount: 2,
          selectedCount: 1,
          matches: [
            { id: "memory-sf", rank: 1, score: 0.84, basis: "semantic", selected: true, eligible: true },
            { id: "memory-oakland", rank: 2, score: 0.82, basis: "semantic", selected: false, eligible: true }
          ]
        }
      }),
      memorySpan("load-location", { type: "load", ids: ["memory-sf"] }),
      {
        object: "trace.span",
        id: "generation-answer",
        trace_id: "trace-location-incident",
        started_at: "2026-07-14T10:20:00.000Z",
        ended_at: "2026-07-14T10:20:01.000Z",
        span_data: {
          type: "generation",
          model: "gpt-5",
          input: "What city do I live in now?",
          output: "You live in San Francisco."
        }
      }
    ]
  };
}

function mappedMemoryToolTrace() {
  return {
    items: [
      { object: "trace", id: "trace-mapped-location", workflow_name: "Mapped location agent" },
      toolSpan("mapped-store-sf", "store_memory", {
        memory: memory("mapped-memory-sf", "User moved to San Francisco.", "current location", "2026-07-14T10:00:00.000Z")
      }),
      toolSpan("mapped-store-oakland", "store_memory", {
        memory: memory("mapped-memory-oakland", "User lives in Oakland now.", "current location", "2026-07-14T10:10:00.000Z")
      }),
      toolSpan(
        "mapped-retrieve",
        "retrieve_memory",
        { query: "What city do I live in now?" },
        { results: [memory("mapped-memory-sf", "User moved to San Francisco.", "current location", "2026-07-14T10:00:00.000Z")] }
      ),
      {
        object: "trace.span",
        id: "mapped-generation-answer",
        trace_id: "trace-mapped-location",
        started_at: "2026-07-14T10:20:00.000Z",
        ended_at: "2026-07-14T10:20:01.000Z",
        span_data: {
          type: "generation",
          input: "What city do I live in now?",
          output: "You live in San Francisco."
        }
      }
    ]
  };
}

function memorySpan(id: string, event: Record<string, unknown>) {
  return {
    object: "trace.span",
    id,
    trace_id: "trace-location-incident",
    started_at: "2026-07-14T10:00:00.000Z",
    ended_at: "2026-07-14T10:00:00.100Z",
    span_data: { type: "custom", name: "engram.memory", data: { event } }
  };
}

function toolSpan(
  id: string,
  name: string,
  input: Record<string, unknown>,
  output: Record<string, unknown> = input
) {
  return {
    object: "trace.span",
    id,
    trace_id: "trace-mapped-location",
    started_at: "2026-07-14T10:00:00.000Z",
    ended_at: "2026-07-14T10:00:00.100Z",
    span_data: { type: "function", name, input, output }
  };
}

function memory(id: string, text: string, topic: string, createdAt: string) {
  return {
    id,
    text,
    topic,
    kind: "location",
    entities: text.includes("Oakland") ? ["Oakland"] : ["San Francisco"],
    importance: 0.8,
    region: "hippocampus",
    created_at: createdAt,
    access_count: 0,
    status: "active"
  };
}
