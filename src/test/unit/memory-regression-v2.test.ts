import type {
  MemoryDecisionDiff,
  MemoryDecisionMemory,
  MemoryDecisionRunV3,
  MemoryPolicyReplayResult
} from "@engramviz/core";
import { describe, expect, it } from "vitest";
import { compileMemoryRegressionV2 } from "@/lib/regressions/v2-compiler";
import { evaluateMemoryRegressionMatrixV2 } from "@/lib/regressions/v2-evaluator";
import {
  memoryRegressionArtifactV2Schema,
  memoryRegressionObservationV2Schema
} from "@/lib/regressions/v2-schema";

const CURRENT_SELECTOR = {
  subject: "current_location",
  status: "active" as const,
  valueContains: "Oakland"
};

const STALE_SELECTOR = {
  subject: "current_location",
  status: "superseded" as const,
  valueContains: "San Francisco"
};

describe("memory regression v2", () => {
  it("compiles semantic lifecycle assertions that survive regenerated memory IDs", () => {
    const artifact = compileMemoryRegressionV2({
      replay: policyReplay(),
      id: "current-location-v2",
      title: "Current location remains authoritative"
    });
    const observation = observedVariant("source", {
      currentId: "provider-generated-current-id",
      staleId: "provider-generated-stale-id"
    });

    const report = evaluateMemoryRegressionMatrixV2(artifact, [observation]);

    expect(report.pass).toBe(true);
    expect(report.summary).toEqual({
      variants: { total: 1, passed: 1, failed: 0, missing: 0 },
      findings: { total: 6, passed: 6, failed: 0 }
    });
    expect(report.variants[0]?.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ assertion: "mustSelect", pass: true }),
      expect.objectContaining({ assertion: "mustNotSelect", pass: true }),
      expect.objectContaining({ assertion: "mustLoad", pass: true }),
      expect.objectContaining({ assertion: "mustNotLoad", pass: true })
    ]));
  });

  it("does not pass a required answer phrase when its only occurrence is negated", () => {
    const artifact = compileMemoryRegressionV2({
      replay: policyReplay(),
      id: "negation-guard-v2",
      title: "Negated expected values fail",
      assertions: {
        lifecycle: {
          mustSelect: [CURRENT_SELECTOR],
          mustNotSelect: [],
          mustLoad: [],
          mustNotLoad: []
        },
        answer: { contains: ["Oakland"], notContains: [] }
      }
    });
    const observation = {
      ...observedVariant("source"),
      answer: "You do not live in Oakland; your current city is Berkeley."
    };

    const report = evaluateMemoryRegressionMatrixV2(artifact, [observation]);
    const answerFinding = report.variants[0]?.findings.find(
      (finding) => finding.assertion === "contains"
    );

    expect(answerFinding).toMatchObject({ pass: false, expected: "Oakland" });
    expect(report.pass).toBe(false);
  });

  it("aggregates passing and failing perturbation variants with all-variant semantics", () => {
    const artifact = compileMemoryRegressionV2({
      replay: policyReplay(),
      id: "location-matrix-v2",
      title: "Location robustness matrix",
      variants: [
        {
          id: "paraphrase",
          label: "Paraphrased query",
          perturbations: [{
            type: "query_paraphrase",
            query: "Which city should I treat as my current home?"
          }]
        },
        {
          id: "near-tie",
          label: "Near score tie",
          perturbations: [{
            type: "score_margin",
            leader: CURRENT_SELECTOR,
            challenger: STALE_SELECTOR,
            margin: 0.001
          }]
        }
      ]
    });
    const failing = observedVariant("near-tie");
    failing.selectedMemoryIds = [failing.memories[0]!.id];
    failing.loadedMemoryIds = [failing.memories[0]!.id];
    failing.answer = "You live in San Francisco.";

    const report = evaluateMemoryRegressionMatrixV2(artifact, [
      observedVariant("source"),
      observedVariant("paraphrase"),
      failing
    ]);

    expect(report.status).toBe("failed");
    expect(report.summary.variants).toEqual({ total: 3, passed: 2, failed: 1, missing: 0 });
    expect(report.variants.map((variant) => [variant.id, variant.status])).toEqual([
      ["source", "passed"],
      ["paraphrase", "passed"],
      ["near-tie", "failed"]
    ]);
  });

  it("validates every deterministic perturbation kind and rejects malformed observations", () => {
    const artifact = compileMemoryRegressionV2({
      replay: policyReplay(),
      id: "all-perturbations-v2",
      title: "Deterministic perturbation definitions",
      variants: [{
        id: "combined",
        perturbations: [
          {
            type: "entity_substitution",
            target: CURRENT_SELECTOR,
            from: "Oakland",
            to: "Lisbon"
          },
          {
            type: "score_margin",
            leader: CURRENT_SELECTOR,
            challenger: STALE_SELECTOR,
            margin: 0.01
          },
          {
            type: "timestamps",
            target: CURRENT_SELECTOR,
            createdAt: "2030-01-02T00:00:00.000Z",
            validFrom: "2030-01-02T00:00:00.000Z"
          },
          {
            type: "distractors",
            candidates: [{ memory: decisionMemory("distractor", "Berkeley", "active"), score: 0.91 }]
          },
          {
            type: "query_paraphrase",
            query: "Where is home now?"
          }
        ]
      }]
    });

    expect(memoryRegressionArtifactV2Schema.parse(artifact).matrix.variants[1]?.perturbations)
      .toHaveLength(5);
    expect(artifact.sourceReplay.fidelity).toMatchObject({
      level: "controlled",
      deterministic: true,
      candidateSet: "recorded",
      answerGeneration: "rerun"
    });
    expect(() => memoryRegressionArtifactV2Schema.parse({ ...artifact, version: 1 })).toThrow();
    expect(() => memoryRegressionObservationV2Schema.parse({
      ...observedVariant("source"),
      loadedMemoryIds: ["missing-memory"]
    })).toThrow(/absent from the observation/i);
  });

  it("does not mutate inputs and deeply freezes compiled artifacts and reports", () => {
    const replay = policyReplay();
    const replayBefore = structuredClone(replay);
    const artifact = compileMemoryRegressionV2({
      replay,
      id: "immutable-v2",
      title: "Immutable regression"
    });
    const observation = observedVariant("source");
    const observationBefore = structuredClone(observation);
    const artifactBefore = structuredClone(artifact);

    const report = evaluateMemoryRegressionMatrixV2(artifact, [observation]);

    expect(replay).toEqual(replayBefore);
    expect(observation).toEqual(observationBefore);
    expect(artifact).toEqual(artifactBefore);
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(Object.isFrozen(artifact.sourceReplay.result.treatment)).toBe(true);
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.variants[0]?.findings)).toBe(true);
  });
});

function observedVariant(
  variantId: string,
  ids: { currentId?: string; staleId?: string } = {}
) {
  const stale = decisionMemory(ids.staleId ?? "stale", "San Francisco", "superseded");
  const current = decisionMemory(ids.currentId ?? "current", "Oakland", "active");
  return {
    variantId,
    memories: [stale, current],
    selectedMemoryIds: [current.id],
    loadedMemoryIds: [current.id],
    answer: "You live in Oakland."
  };
}

function policyReplay(): MemoryPolicyReplayResult {
  const sourceStale = decisionMemory("stale-source", "San Francisco", "active");
  const sourceCurrent = decisionMemory("current-source", "Oakland", "active");
  const treatmentStale = { ...sourceStale, status: "superseded" as const };
  const source = decisionRun(
    "source-run",
    [sourceStale, sourceCurrent],
    [sourceStale.id],
    "You live in San Francisco."
  );
  const baseline = decisionRun(
    "baseline-run",
    [sourceStale, sourceCurrent],
    [sourceStale.id],
    "You live in San Francisco."
  );
  const treatment = decisionRun(
    "treatment-run",
    [treatmentStale, sourceCurrent],
    [sourceCurrent.id],
    "You live in Oakland."
  );

  return {
    format: "engram.memory-policy-replay",
    version: 1,
    level: "policy",
    executor: {
      id: "deterministic-policy-test",
      version: "1.0.0",
      deterministic: true
    },
    capabilities: {
      levels: ["policy"],
      deterministic: true,
      reusesRecordedCandidates: true,
      rerunsCandidateGeneration: false,
      rerunsEligibility: true,
      rerunsRanking: true,
      rerunsSelection: true,
      rerunsContextAssembly: true,
      rerunsGeneration: true,
      supportsPolicyInterventions: true,
      supportsStateInterventions: true,
      supportsRepeatedRuns: false
    },
    intervention: {
      format: "engram.memory-intervention",
      version: 2,
      id: "prefer-current-location",
      targetRunId: source.id,
      label: "Prefer current location",
      rationale: "Resolve stale current-location memories.",
      operations: [{
        id: "prefer-latest",
        type: "policy_rule",
        rule: "prefer_latest_active_for_subject",
        enabled: true,
        reason: "The latest active correction should win."
      }],
      createdAt: source.completedAt
    },
    source,
    baseline,
    treatment,
    diff: decisionDiff(baseline, treatment),
    reproduction: {
      reproduced: true,
      observedAnswer: source.answer.content,
      replayedAnswer: baseline.answer.content
    },
    verification: {
      passed: true,
      assertion: {
        type: "contains_all",
        values: ["Oakland"],
        forbidden: ["San Francisco"]
      },
      failures: [],
      expectedAnswerFragments: ["Oakland"],
      matchedAnswerFragments: ["Oakland"]
    },
    caveat: "Policy stages were replayed over the recorded candidate set."
  };
}

function decisionMemory(
  id: string,
  value: string,
  status: MemoryDecisionMemory["status"]
): MemoryDecisionMemory {
  return {
    id,
    content: `User lives in ${value}.`,
    subject: "current_location",
    value,
    status,
    tier: "semantic",
    scope: "user",
    createdAt: value === "San Francisco"
      ? "2024-01-01T00:00:00.000Z"
      : "2026-01-01T00:00:00.000Z",
    evidence: "observed"
  };
}

function decisionRun(
  id: string,
  memories: MemoryDecisionMemory[],
  selectedIds: string[],
  answer: string
): MemoryDecisionRunV3 {
  const selected = new Set(selectedIds);
  return {
    format: "engram.memory-decision-run",
    version: 3,
    id,
    traceId: "trace-location",
    turnId: "turn-location",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    input: "Where do I live?",
    memoryState: {
      before: structuredClone(memories),
      after: structuredClone(memories)
    },
    retrieval: {
      query: "Where do I live?",
      limit: 1,
      candidates: memories.map((memory, index) => ({
        memoryId: memory.id,
        memory: structuredClone(memory),
        rank: index + 1,
        score: index === 0 ? 0.92 : 0.9,
        eligible: memory.status === "active",
        selected: selected.has(memory.id),
        loaded: selected.has(memory.id),
        evidence: "simulated"
      })),
      selectedIds: [...selectedIds],
      policy: {
        id: "current-fact-policy",
        evidence: "simulated"
      }
    },
    context: {
      loadedIds: [...selectedIds],
      orderedIds: [...selectedIds],
      truncatedIds: [],
      forcedIds: [],
      evidence: "simulated"
    },
    answer: {
      content: answer,
      provider: { id: "deterministic-policy-test", model: "1.0.0" },
      evidence: "simulated"
    },
    evidenceCoverage: {
      memory_state: "simulated",
      retrieval: "simulated",
      selection: "simulated",
      active_context: "simulated",
      answer: "simulated"
    }
  };
}

function decisionDiff(
  baseline: MemoryDecisionRunV3,
  treatment: MemoryDecisionRunV3
): MemoryDecisionDiff {
  return {
    format: "engram.memory-decision-diff",
    version: 1,
    baselineRunId: baseline.id,
    treatmentRunId: treatment.id,
    status: "found",
    stages: ["memory_state", "retrieval", "selection", "active_context", "answer"].map(
      (stage) => ({
        stage: stage as MemoryDecisionDiff["stages"][number]["stage"],
        comparable: true,
        changed: true,
        summary: `${stage} changed.`,
        baselineMemoryIds: [...baseline.retrieval.selectedIds],
        treatmentMemoryIds: [...treatment.retrieval.selectedIds]
      })
    ),
    earliestDivergence: "memory_state",
    answerChanged: true
  };
}
