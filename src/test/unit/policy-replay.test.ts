import { createHash } from "node:crypto";
import type { MemoryDecisionRunV3, MemoryInterventionV2 } from "@engramviz/core";
import { describe, expect, it } from "vitest";
import { createSampleMemoryIncidentCase } from "@/lib/lab/sample-incident";
import { memoryDecisionRunFromIncident } from "@/lib/reliability/from-incident";
import { buildMemoryDecisionDiff } from "@/lib/reliability/diff";
import { canonicalJson, fingerprintMemoryDecisionRun } from "@/lib/reliability/fingerprint";
import { runDeterministicPolicyReplay } from "@/lib/reliability/policy-replay";
import {
  answerLocationQuestion,
  createStaleLocationPolicyReplay
} from "@/lib/reliability/stale-location";

describe("deterministic memory policy replay", () => {
  it("reproduces the observed baseline before verifying a treatment", () => {
    const baseline = replayableBaseline();
    const result = runDeterministicPolicyReplay({
      baseline,
      intervention: currentFactIntervention(baseline.id, baseline.completedAt),
      expectedAnswerFragments: ["Oakland"]
    }, fixtureExecutor);

    expect(result.reproduction).toEqual({
      reproduced: true,
      observedAnswer: "You live in San Francisco.",
      replayedAnswer: "You live in San Francisco."
    });
    expect(result.verification.passed).toBe(true);
  });

  it("does not claim reproduction when the captured executor identity is different", () => {
    const baseline = replayableBaseline();
    baseline.metadata = {
      ...(baseline.metadata ?? {}),
      replayExecutor: { id: "another-executor", version: "1" }
    };
    const result = runDeterministicPolicyReplay({
      baseline,
      intervention: currentFactIntervention(baseline.id, baseline.completedAt),
      expectedAnswerFragments: ["Oakland"]
    }, fixtureExecutor);

    expect(result.reproduction.reproduced).toBe(false);
    expect(result.verification.passed).toBe(false);
    expect(result.verification.failures).toContain(
      "The replay executor identity does not match the captured answer provider."
    );
  });

  it("reruns state, retrieval policy, selection, context, and answer", () => {
    const result = createStaleLocationPolicyReplay();
    const stale = result.treatment.memoryState.after.find((memory) => memory.value === "San Francisco");
    const current = result.treatment.memoryState.after.find((memory) => memory.value === "Oakland");

    expect(stale).toMatchObject({ status: "superseded", supersededBy: current?.id });
    expect(current?.supersedes).toContain(stale?.id);
    expect(result.treatment.retrieval.selectedIds).toEqual([current?.id]);
    expect(result.treatment.context.loadedIds).toEqual([current?.id]);
    expect(result.treatment.answer.content).toBe("You live in Oakland.");
    expect(result.diff.earliestDivergence).toBe("memory_state");
    expect(result.diff.stages.map((stage) => [stage.stage, stage.changed])).toEqual([
      ["memory_state", true],
      ["retrieval", true],
      ["selection", true],
      ["active_context", true],
      ["answer", true]
    ]);
  });

  it("does not depend on the stale-location fixture's city names or ids", () => {
    const baseline = memoryDecisionRunFromIncident(createSampleMemoryIncidentCase());
    const stale = baseline.memoryState.before[0]!;
    const current = baseline.memoryState.before[1]!;
    stale.id = "old-city";
    stale.content = "User moved to Chicago in 2020.";
    stale.value = "Chicago";
    current.id = "current-city";
    current.content = "User lives in Evanston now.";
    current.value = "Evanston";
    baseline.memoryState.after = structuredClone(baseline.memoryState.before);
    baseline.retrieval.candidates[0]!.memoryId = stale.id;
    baseline.retrieval.candidates[0]!.memory = structuredClone(stale);
    baseline.retrieval.candidates[1]!.memoryId = current.id;
    baseline.retrieval.candidates[1]!.memory = structuredClone(current);
    baseline.retrieval.selectedIds = [stale.id];
    baseline.context.loadedIds = [stale.id];
    baseline.context.orderedIds = [stale.id];
    baseline.answer.content = "You live in Chicago.";
    declareFixtureExecutor(baseline);
    const intervention = currentFactIntervention(baseline.id, baseline.completedAt);

    const result = runDeterministicPolicyReplay(
      { baseline, intervention, expectedAnswerFragments: ["Evanston"] },
      fixtureExecutor
    );

    expect(result.reproduction.reproduced).toBe(true);
    expect(result.treatment.answer.content).toBe("You live in Evanston.");
    expect(result.verification.passed).toBe(true);
  });

  it("does not mutate the captured source run", () => {
    const baseline = memoryDecisionRunFromIncident(createSampleMemoryIncidentCase());
    declareFixtureExecutor(baseline);
    const before = structuredClone(baseline);

    runDeterministicPolicyReplay(
      {
        baseline,
        intervention: currentFactIntervention(baseline.id, baseline.completedAt),
        expectedAnswerFragments: ["Oakland"]
      },
      fixtureExecutor
    );

    expect(baseline).toEqual(before);
  });

  it("rejects an intervention aimed at another run", () => {
    const baseline = memoryDecisionRunFromIncident(createSampleMemoryIncidentCase());
    const intervention = currentFactIntervention("another-run", baseline.completedAt);

    expect(() => runDeterministicPolicyReplay(
      { baseline, intervention, expectedAnswerFragments: ["Oakland"] },
      fixtureExecutor
    )).toThrow(/does not target/i);
  });

  it("records forced context separately from policy selection", () => {
    const baseline = memoryDecisionRunFromIncident(createSampleMemoryIncidentCase());
    const current = baseline.memoryState.before[1]!;
    const intervention: MemoryInterventionV2 = {
      format: "engram.memory-intervention",
      version: 2,
      id: "force-current-context",
      targetRunId: baseline.id,
      label: "Force current memory",
      rationale: "Test an explicit context-only intervention.",
      operations: [{
        id: "force-current",
        type: "context_override",
        action: "include",
        memoryId: current.id,
        reason: "Load the ignored current fact without changing retrieval."
      }],
      createdAt: baseline.completedAt
    };

    const result = runDeterministicPolicyReplay({ baseline, intervention }, fixtureExecutor);

    expect(result.treatment.retrieval.selectedIds).not.toContain(current.id);
    expect(result.treatment.context.loadedIds).toContain(current.id);
    expect(result.treatment.context.forcedIds).toEqual([current.id]);
  });

  it("maps a replacement memory through retrieval and context by explicit operation", () => {
    const baseline = memoryDecisionRunFromIncident(createSampleMemoryIncidentCase());
    declareFixtureExecutor(baseline);
    const stale = baseline.memoryState.before[0]!;
    const replacement = {
      ...structuredClone(stale),
      id: "replacement-city",
      content: "User lives in Berkeley now.",
      value: "Berkeley",
      createdAt: baseline.completedAt,
      evidence: "simulated" as const
    };
    const intervention: MemoryInterventionV2 = {
      format: "engram.memory-intervention",
      version: 2,
      id: "replace-stale-city",
      targetRunId: baseline.id,
      label: "Replace stale city",
      rationale: "Test a direct state correction.",
      operations: [{
        id: "replace-city",
        type: "memory_replace",
        memoryId: stale.id,
        replacement,
        reason: "Correct the stored value."
      }],
      createdAt: baseline.completedAt
    };

    const result = runDeterministicPolicyReplay(
      { baseline, intervention, answerAssertion: { type: "exact", value: "You live in Berkeley." } },
      fixtureExecutor
    );

    expect(result.treatment.retrieval.selectedIds).toEqual([replacement.id]);
    expect(result.treatment.context.loadedIds).toEqual([replacement.id]);
    expect(result.verification.passed).toBe(true);
  });

  it("rejects stale intervention preconditions", () => {
    const baseline = memoryDecisionRunFromIncident(createSampleMemoryIncidentCase());
    const intervention = {
      ...currentFactIntervention(baseline.id, baseline.completedAt),
      baselineFingerprint: `${fingerprintMemoryDecisionRun(baseline)}-stale`
    };

    expect(() => runDeterministicPolicyReplay({ baseline, intervention }, fixtureExecutor))
      .toThrow(/fingerprint no longer matches/i);
  });

  it("reports an indeterminate diff when a stage lacks evidence", () => {
    const baseline = memoryDecisionRunFromIncident(createSampleMemoryIncidentCase());
    const treatment = structuredClone(baseline);
    treatment.id = "treatment-with-retrieval-gap";
    treatment.evidenceCoverage.retrieval = "unavailable";

    const diff = buildMemoryDecisionDiff(baseline, treatment);

    expect(diff.status).toBe("indeterminate");
    expect(diff.firstIncomparableStage).toBe("retrieval");
    expect(diff.earliestDivergence).toBeUndefined();
  });

  it("does not treat the same answer with a different selection as reproduction", () => {
    const baseline = replayableBaseline();
    const currentId = baseline.retrieval.candidates[1]!.memoryId;
    baseline.retrieval.selectedIds = [currentId];
    baseline.context.loadedIds = [currentId];
    baseline.context.orderedIds = [currentId];
    for (const candidate of baseline.retrieval.candidates) {
      candidate.selected = candidate.memoryId === currentId;
      candidate.loaded = candidate.memoryId === currentId;
    }
    baseline.answer.content = "Same answer.";
    const constantExecutor = {
      ...fixtureExecutor,
      generateAnswer: () => "Same answer."
    };

    const result = runDeterministicPolicyReplay({
      baseline,
      intervention: {
        format: "engram.memory-intervention",
        version: 2,
        id: "no-effective-policy-change",
        targetRunId: baseline.id,
        label: "Exercise baseline comparison",
        rationale: "The replay must compare decisions, not only words.",
        operations: [{
          id: "keep-expired",
          type: "policy_rule",
          rule: "exclude_expired",
          enabled: false,
          reason: "No source memory is expired."
        }],
        createdAt: baseline.completedAt
      }
    }, constantExecutor);

    expect(result.reproduction.replayedAnswer).toBe(result.reproduction.observedAnswer);
    expect(result.reproduction.reproduced).toBe(false);
    expect(result.verification.failures).toContain(
      "The replay baseline did not reproduce every comparable memory-decision stage."
    );
  });

  it("keeps a later answer change indeterminate when retrieval evidence is missing first", () => {
    const baseline = replayableBaseline();
    const treatment = structuredClone(baseline);
    treatment.id = "later-answer-change";
    baseline.evidenceCoverage.retrieval = "unavailable";
    treatment.evidenceCoverage.retrieval = "unavailable";
    treatment.answer.content = "A different answer.";

    const diff = buildMemoryDecisionDiff(baseline, treatment);

    expect(diff.status).toBe("indeterminate");
    expect(diff.firstIncomparableStage).toBe("retrieval");
    expect(diff.earliestDivergence).toBeUndefined();
    expect(diff.answerChanged).toBe(true);
  });

  it("rejects diffs between different turns or starting states", () => {
    const baseline = replayableBaseline();
    const anotherTurn = structuredClone(baseline);
    anotherTurn.id = "another-turn";
    anotherTurn.turnId = "turn-2";

    expect(() => buildMemoryDecisionDiff(baseline, anotherTurn)).toThrow(/different turnId/i);

    const anotherState = structuredClone(baseline);
    anotherState.id = "another-state";
    anotherState.memoryState.before[0]!.status = "quarantined";
    expect(() => buildMemoryDecisionDiff(baseline, anotherState)).toThrow(/different starting memory states/i);
  });

  it("canonicalizes set-like collections before comparing runs", () => {
    const baseline = replayableBaseline();
    const treatment = structuredClone(baseline);
    treatment.id = "reordered-evidence";
    treatment.memoryState.before.reverse();
    treatment.memoryState.after.reverse();
    treatment.retrieval.candidates.reverse();

    const diff = buildMemoryDecisionDiff(baseline, treatment);

    expect(diff.status).toBe("none");
    expect(diff.stages.every((stage) => !stage.changed)).toBe(true);
  });

  it("fingerprints canonical UTF-8 bytes with versioned SHA-256", () => {
    const run = replayableBaseline();
    run.metadata = { unicode: "München 🧠", nested: { z: 1, a: 2 } };
    const expected = createHash("sha256").update(canonicalJson(run), "utf8").digest("hex");

    expect(fingerprintMemoryDecisionRun(run)).toBe(`sha256-v1:${expected}`);
    expect(canonicalJson({ z: 1, a: 2 })).toBe(canonicalJson({ a: 2, z: 1 }));
  });

  it("uses memory ID as the final deterministic ranking tie-break", () => {
    const baseline = replayableBaseline();
    const [first, second] = baseline.retrieval.candidates;
    first!.score = 0.8;
    second!.score = 0.8;
    first!.memory!.createdAt = baseline.startedAt;
    second!.memory!.createdAt = baseline.startedAt;
    baseline.memoryState.before[0]!.createdAt = baseline.startedAt;
    baseline.memoryState.before[1]!.createdAt = baseline.startedAt;
    baseline.memoryState.after = structuredClone(baseline.memoryState.before);

    const result = runDeterministicPolicyReplay({
      baseline,
      intervention: {
        format: "engram.memory-intervention",
        version: 2,
        id: "tie-break",
        targetRunId: baseline.id,
        label: "Tie break",
        rationale: "Ranking must be portable.",
        operations: [{
          id: "disable-expiry",
          type: "policy_rule",
          rule: "exclude_expired",
          enabled: false,
          reason: "Keep all candidates eligible."
        }],
        createdAt: baseline.completedAt
      }
    }, fixtureExecutor);

    expect(result.treatment.retrieval.selectedIds).toEqual([
      [first!.memoryId, second!.memoryId].sort()[0]
    ]);
  });

  it("rejects unknown and cross-owner state references", () => {
    const baseline = replayableBaseline();
    baseline.userId = "user-1";
    for (const memory of baseline.memoryState.before) memory.owner = { type: "user", id: "user-1" };
    baseline.memoryState.after = structuredClone(baseline.memoryState.before);

    const unknown = currentFactIntervention(baseline.id, baseline.completedAt);
    unknown.operations = [{
      id: "unknown",
      type: "memory_restore",
      memoryId: "missing",
      reason: "Invalid reference."
    }];
    expect(() => runDeterministicPolicyReplay({ baseline, intervention: unknown }, fixtureExecutor))
      .toThrow(/unknown memory missing/i);

    const replacement = structuredClone(baseline.memoryState.before[0]!);
    replacement.id = "foreign-replacement";
    replacement.owner = { type: "user", id: "user-2" };
    const foreign = currentFactIntervention(baseline.id, baseline.completedAt);
    foreign.operations = [{
      id: "foreign",
      type: "memory_replace",
      memoryId: baseline.memoryState.before[0]!.id,
      replacement,
      reason: "Invalid owner."
    }];
    expect(() => runDeterministicPolicyReplay({ baseline, intervention: foreign }, fixtureExecutor))
      .toThrow(/different owner|another user/i);
  });
});

function currentFactIntervention(targetRunId: string, createdAt: string): MemoryInterventionV2 {
  return {
    format: "engram.memory-intervention",
    version: 2,
    id: "current-fact-wins",
    targetRunId,
    label: "Prefer the current fact",
    rationale: "Resolve mutually exclusive facts by recency.",
    operations: [
      {
        id: "current-wins",
        type: "policy_rule",
        rule: "prefer_latest_active_for_subject",
        enabled: true,
        reason: "Use the latest active correction."
      },
      {
        id: "exclude-superseded",
        type: "policy_rule",
        rule: "exclude_superseded",
        enabled: true,
        reason: "Keep stale facts out of retrieval."
      }
    ],
    createdAt
  };
}

const fixtureExecutor = {
  id: "test-location-agent",
  version: "1",
  deterministic: true as const,
  generateAnswer: answerLocationQuestion
};

function replayableBaseline(): MemoryDecisionRunV3 {
  const baseline = memoryDecisionRunFromIncident(createSampleMemoryIncidentCase());
  declareFixtureExecutor(baseline);
  return baseline;
}

function declareFixtureExecutor(baseline: MemoryDecisionRunV3) {
  baseline.metadata = {
    ...(baseline.metadata ?? {}),
    replayExecutor: { id: fixtureExecutor.id, version: fixtureExecutor.version }
  };
}
