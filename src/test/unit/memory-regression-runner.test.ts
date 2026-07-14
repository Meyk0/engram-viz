import { describe, expect, it, vi } from "vitest";
import {
  MEMORY_REGRESSION_RUN_CAVEAT,
  evaluateMemoryRegressionObservation,
  runMemoryRegressionArtifact,
  type MemoryRegressionExecutionFixture
} from "@/lib/regressions/run";

describe("provider-neutral memory regression runner", () => {
  it("runs a frozen fixture and reports every passing assertion with metadata", async () => {
    const artifact = fixtureArtifact();
    const original = structuredClone(artifact);
    const clock = sequenceClock(100, 137);
    let received: MemoryRegressionExecutionFixture | undefined;

    const report = await runMemoryRegressionArtifact(artifact, (fixture) => {
      received = fixture;
      expect(Object.isFrozen(fixture)).toBe(true);
      expect(Object.isFrozen(fixture.memories)).toBe(true);
      expect(Object.isFrozen(fixture.memories[0])).toBe(true);
      expect(Object.isFrozen(fixture.input.history)).toBe(true);
      return {
        answer: "You live in OAKLAND now.",
        retrievedMemoryIds: ["memory-oakland", "memory-oakland"],
        loadedMemoryIds: ["memory-oakland"],
        provider: {
          id: "openai",
          model: "gpt-test",
          metadata: { region: "us-west", cached: false }
        },
        runtime: {
          name: "engram-test",
          version: "1.2.3",
          metadata: { attempt: 1 }
        }
      };
    }, { now: clock });

    expect(received?.input.userMessage).toBe("What city do I live in now?");
    expect(artifact).toEqual(original);
    expect(report).toMatchObject({
      pass: true,
      status: "passed",
      execution: { status: "completed", durationMs: 37 },
      summary: { total: 5, passed: 5, failed: 0, notEvaluated: 0 },
      observation: {
        retrievedMemoryIds: ["memory-oakland"],
        loadedMemoryIds: ["memory-oakland"],
        provider: { id: "openai", model: "gpt-test" },
        runtime: { name: "engram-test", version: "1.2.3" }
      },
      contract: {
        claim: "behavioral-observation",
        causalClaim: false
      }
    });
    expect(report.findings.map((finding) => [finding.assertion, finding.pass])).toEqual([
      ["mustRetrieve", true],
      ["mustNotRetrieve", true],
      ["maxLoaded", true],
      ["contains", true],
      ["notContains", true]
    ]);
    expect(report.contract.caveats).toContain(MEMORY_REGRESSION_RUN_CAVEAT);
    expect(Object.isFrozen(report)).toBe(true);
  });

  it("returns explicit failures for retrieval, load, and answer mismatches", () => {
    const report = evaluateMemoryRegressionObservation(fixtureArtifact(), {
      answer: "You live in San Francisco.",
      retrievedMemoryIds: ["memory-san-francisco"],
      loadedMemoryIds: ["memory-san-francisco", "memory-oakland"]
    }, { durationMs: 9 });

    expect(report.pass).toBe(false);
    expect(report.execution).toEqual({ status: "completed", durationMs: 9 });
    expect(report.summary).toEqual({ total: 5, passed: 0, failed: 5, notEvaluated: 0 });
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "retrieval.mustRetrieve:memory-oakland", pass: false, evaluated: true }),
      expect.objectContaining({ id: "retrieval.mustNotRetrieve:memory-san-francisco", pass: false }),
      expect.objectContaining({ id: "retrieval.maxLoaded", expected: 1, observed: 2, pass: false }),
      expect.objectContaining({ id: "answer.contains:Oakland", pass: false }),
      expect.objectContaining({ id: "answer.notContains:San Francisco", pass: false })
    ]));
  });

  it("validates artifacts before invoking the executor", async () => {
    const invalid = structuredClone(fixtureArtifact());
    invalid.assertions.retrieval.mustRetrieve = ["memory-missing"];
    const executor = vi.fn();

    const report = await runMemoryRegressionArtifact(invalid, executor, {
      now: sequenceClock(10, 12)
    });

    expect(executor).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      pass: false,
      execution: {
        status: "invalid-artifact",
        durationMs: 2,
        error: { name: "Error" }
      },
      summary: { total: 0, passed: 0, failed: 0, notEvaluated: 0 },
      contract: { causalClaim: false }
    });
    expect(report.execution.error?.message).toContain("unknown fixture memory");
  });

  it("converts executor exceptions into structured failures without losing assertion detail", async () => {
    const report = await runMemoryRegressionArtifact(
      fixtureArtifact(),
      async () => { throw new Error("provider unavailable"); },
      { now: sequenceClock(50, 71) }
    );

    expect(report).toMatchObject({
      pass: false,
      execution: {
        status: "executor-error",
        durationMs: 21,
        error: { name: "Error", message: "provider unavailable" }
      },
      summary: { total: 5, passed: 0, failed: 0, notEvaluated: 5 },
      contract: { causalClaim: false }
    });
    expect(report.observation).toBeUndefined();
    expect(report.findings.every((finding) => !finding.evaluated && !finding.pass)).toBe(true);
  });

  it("rejects malformed executor observations as structured non-evaluated failures", async () => {
    const report = await runMemoryRegressionArtifact(
      fixtureArtifact(),
      () => ({
        answer: "Oakland",
        retrievedMemoryIds: ["memory-oakland"],
        loadedMemoryIds: "memory-oakland"
      } as never),
      { now: sequenceClock(0, 4) }
    );

    expect(report.execution.status).toBe("invalid-observation");
    expect(report.execution.error?.message).toContain("loadedMemoryIds must be an array");
    expect(report.summary.notEvaluated).toBe(5);
  });

  it("normalizes negative durations and preserves empty assertion reports honestly", () => {
    const artifact = {
      ...fixtureArtifact(),
      assertions: {
        retrieval: {
          mustRetrieve: [],
          mustNotRetrieve: []
        },
        answer: {
          match: "case-insensitive-substring" as const,
          contains: [],
          notContains: []
        }
      }
    };

    const report = evaluateMemoryRegressionObservation(artifact, {
      answer: "No assertions were requested.",
      retrievedMemoryIds: [],
      loadedMemoryIds: []
    }, { durationMs: -20 });

    expect(report).toMatchObject({
      pass: true,
      execution: { status: "completed", durationMs: 0 },
      summary: { total: 0, passed: 0, failed: 0, notEvaluated: 0 },
      contract: { causalClaim: false }
    });
  });
});

function fixtureArtifact() {
  return {
    kind: "engram.memory-regression" as const,
    version: 1 as const,
    id: "regression-current-city",
    title: "Prefer current city",
    createdAt: "2026-07-14T18:00:00.000Z",
    provenance: {
      generator: { name: "engram" as const, contractVersion: 1 as const },
      source: {
        kind: "checkpoint" as const,
        checkpointVersion: 1 as const,
        checkpointId: "checkpoint-current-city",
        checkpointSource: "conversation" as const,
        sourceId: "timeline-current-city",
        sourceCreatedAt: "2026-07-14T17:59:00.000Z",
        index: 2
      }
    },
    fixture: {
      memories: [
        {
          id: "memory-san-francisco",
          text: "User lived in San Francisco.",
          importance: 0.8,
          region: "hippocampus" as const,
          created_at: "2026-07-14T17:00:00.000Z",
          access_count: 4
        },
        {
          id: "memory-oakland",
          text: "User lives in Oakland now.",
          importance: 0.95,
          region: "hippocampus" as const,
          created_at: "2026-07-14T17:50:00.000Z",
          access_count: 0
        }
      ],
      input: {
        userMessage: "What city do I live in now?",
        history: [{ role: "user" as const, content: "Actually, I live in Oakland now." }]
      }
    },
    evidence: {
      basis: "checkpoint-state" as const,
      claim: "behavioral-observation" as const,
      causalClaim: false as const,
      caveat: "Observable replay evidence only; this does not prove causality."
    },
    assertions: {
      retrieval: {
        mustRetrieve: ["memory-oakland"],
        mustNotRetrieve: ["memory-san-francisco"],
        maxLoaded: 1
      },
      answer: {
        match: "case-insensitive-substring" as const,
        contains: ["Oakland"],
        notContains: ["San Francisco"]
      }
    }
  };
}

function sequenceClock(...values: number[]) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}
