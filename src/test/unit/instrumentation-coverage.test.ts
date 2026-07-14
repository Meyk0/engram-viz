import { describe, expect, it } from "vitest";
import { analyzeInstrumentationCoverage } from "@/lib/traces/coverage";
import type {
  NormalizedTrace,
  NormalizedTraceStep,
  TraceMemoryMapping
} from "@/lib/traces/types";
import type { EngramEvent } from "@/types";

describe("analyzeInstrumentationCoverage", () => {
  it("reports directly recorded execution and native memory evidence without overstating replay", () => {
    const trace = makeTrace([
      step("agent", "agent", { input: { task: "answer" }, output: { status: "done" } }),
      step("model", "model", { input: { messages: [] }, output: { text: "Indigo" } }),
      step("tool", "tool", { input: { query: "color" }, output: { ids: ["indigo"] } }),
      memoryStep("retrieve", {
        type: "retrieve",
        query: "What color?",
        ids: ["indigo"],
        retrieval: {
          provider: "semantic",
          candidateCount: 1,
          matches: [{ id: "indigo", rank: 1, score: 0.9, basis: "semantic", selected: true }]
        }
      }, "observed", "user"),
      memoryStep("load", { type: "load", ids: ["indigo"] }, "observed", "user")
    ]);

    const report = analyzeInstrumentationCoverage(trace);

    expect(statuses(report)).toEqual({
      agent_spans: "observed",
      model_calls: "observed",
      tool_calls: "observed",
      memory_operations: "observed",
      retrieval_candidates: "observed",
      loaded_context: "observed",
      memory_scope: "observed",
      replayability: "partial"
    });
    expect(coverage(report, "replayability").reason).toContain("does not attest complete instructions");
    expect(report.caveat).toContain("blind spot");
  });

  it("labels recognized memory tools as mapped and selected-only retrieval as partial", () => {
    const trace = makeTrace([
      memoryStep(
        "retrieve-tool",
        { type: "retrieve", query: "color", ids: ["indigo"] },
        "mapped",
        "shared",
        "mapped"
      ),
      memoryStep("load-tool", { type: "load", ids: ["indigo"] }, "mapped", "shared", "mapped")
    ]);

    const report = analyzeInstrumentationCoverage(trace);

    expect(coverage(report, "memory_operations").status).toBe("mapped");
    expect(coverage(report, "retrieval_candidates")).toMatchObject({ status: "partial" });
    expect(coverage(report, "retrieval_candidates").reason).toContain("no candidate lists");
    expect(coverage(report, "loaded_context").status).toBe("mapped");
    expect(coverage(report, "memory_scope").status).toBe("mapped");
  });

  it("keeps candidate, context, scope, and replay blind spots explicit", () => {
    const inferred: TraceMemoryMapping = {
      provenance: "inferred",
      event: null,
      sourcePath: "steps[0]",
      note: "A name looked memory-like, but no operation was recorded."
    };
    const trace = makeTrace([
      {
        ...step("custom", "possible-memory"),
        memoryMappings: [inferred]
      },
      step("model", "model", { input: { messages: [] } })
    ]);

    const report = analyzeInstrumentationCoverage(trace);

    expect(coverage(report, "memory_operations").status).toBe("unavailable");
    expect(coverage(report, "retrieval_candidates").status).toBe("unavailable");
    expect(coverage(report, "loaded_context").status).toBe("unavailable");
    expect(coverage(report, "memory_scope").status).toBe("unavailable");
    expect(coverage(report, "replayability")).toMatchObject({ status: "unavailable" });
    expect(coverage(report, "replayability").reason).toContain("model output");
  });

  it("reports partial memory provenance and scope instead of averaging away gaps", () => {
    const trace = makeTrace([
      memoryStep("native-store", { type: "store", memory: memory("one") }, "observed", "user"),
      memoryStep("mapped-store", { type: "store", memory: memory("two") }, "mapped")
    ]);

    const report = analyzeInstrumentationCoverage(trace);

    expect(coverage(report, "memory_operations")).toMatchObject({ status: "partial" });
    expect(coverage(report, "memory_scope")).toMatchObject({ status: "partial" });
    expect(coverage(report, "memory_scope").reason).toContain("1 of 2");
  });

  it("does not treat retrieval as evidence that memory entered the model context", () => {
    const trace = makeTrace([
      memoryStep("retrieve", { type: "retrieve", query: "color", ids: ["indigo"] }, "observed", "user")
    ]);

    const loaded = coverage(analyzeInstrumentationCoverage(trace), "loaded_context");
    expect(loaded.status).toBe("unavailable");
    expect(loaded.reason).toContain("retrieval does not prove");
  });

  it("reports a declared but truncated candidate list as partial", () => {
    const trace = makeTrace([
      memoryStep("retrieve", {
        type: "retrieve",
        query: "color",
        ids: ["indigo"],
        retrieval: {
          provider: "semantic",
          candidateCount: 4,
          matches: [{ id: "indigo", rank: 1, score: 0.9, basis: "semantic", selected: true }]
        }
      }, "observed", "user")
    ]);

    const candidates = coverage(analyzeInstrumentationCoverage(trace), "retrieval_candidates");
    expect(candidates.status).toBe("partial");
    expect(candidates.reason).toContain("unverified candidate lists");
  });

  it("does not call an undeclared candidate list complete", () => {
    const trace = makeTrace([
      memoryStep("retrieve", {
        type: "retrieve",
        query: "color",
        ids: ["indigo"],
        retrieval: {
          provider: "semantic",
          matches: [{ id: "indigo", rank: 1, score: 0.9, basis: "semantic", selected: true }]
        }
      }, "observed", "user")
    ]);

    expect(coverage(analyzeInstrumentationCoverage(trace), "retrieval_candidates").status).toBe("partial");
  });

  it("marks every capability unavailable for an empty trace", () => {
    const report = analyzeInstrumentationCoverage(makeTrace([]));
    expect(report.summary).toEqual({ observed: 0, mapped: 0, partial: 0, unavailable: 8 });
  });
});

function makeTrace(steps: NormalizedTraceStep[]): NormalizedTrace {
  return {
    schemaVersion: 1,
    trace: {
      id: "coverage-trace",
      name: "Coverage trace",
      source: { provider: "test", format: "normalized" }
    },
    steps: steps.map((candidate, index) => ({ ...candidate, index }))
  };
}

function step(
  kind: NormalizedTraceStep["kind"],
  id: string,
  fields: Pick<NormalizedTraceStep, "input" | "output"> | Record<string, never> = {}
): NormalizedTraceStep {
  return {
    id,
    index: 0,
    kind,
    name: id,
    status: "completed",
    memoryMappings: [],
    ...fields
  };
}

function memoryStep(
  id: string,
  event: EngramEvent,
  provenance: "observed" | "mapped",
  scope?: "user" | "agent" | "run" | "shared",
  scopeProvenance: "observed" | "mapped" = "observed"
): NormalizedTraceStep {
  return {
    ...step("custom", id),
    memoryMappings: [{
      provenance,
      event,
      sourcePath: `steps.${id}`,
      note: provenance === "observed" ? "Native memory event." : "Recognized memory tool."
    }],
    ...(scope ? {
      topology: {
        memory: {
          scope,
          provenance: scopeProvenance,
          sourcePath: `steps.${id}.scope`,
          note: "Memory scope was recorded."
        }
      }
    } : {})
  };
}

function memory(id: string) {
  return {
    id,
    text: id,
    importance: 0.8,
    region: "hippocampus" as const,
    created_at: "2026-01-01T00:00:00.000Z",
    access_count: 0
  };
}

function statuses(report: ReturnType<typeof analyzeInstrumentationCoverage>) {
  return Object.fromEntries(report.capabilities.map((item) => [item.id, item.status]));
}

function coverage(
  report: ReturnType<typeof analyzeInstrumentationCoverage>,
  id: ReturnType<typeof analyzeInstrumentationCoverage>["capabilities"][number]["id"]
) {
  const result = report.capabilities.find((item) => item.id === id);
  if (!result) throw new Error(`Missing coverage capability ${id}`);
  return result;
}
