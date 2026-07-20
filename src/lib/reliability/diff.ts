import type {
  MemoryDecisionDiff,
  MemoryDecisionRunV3,
  MemoryDecisionStageDiff,
  MemoryDecisionStageKind
} from "@engramviz/core";
import { canonicalJson } from "@/lib/reliability/fingerprint";

const stageOrder: MemoryDecisionStageKind[] = [
  "memory_state",
  "retrieval",
  "selection",
  "active_context",
  "answer"
];

export function buildMemoryDecisionDiff(
  baseline: MemoryDecisionRunV3,
  treatment: MemoryDecisionRunV3
): MemoryDecisionDiff {
  assertComparableRunIdentity(baseline, treatment);
  const stages = stageOrder.map((stage) => compareStage(stage, baseline, treatment));
  const firstChangedIndex = stages.findIndex((stage) => stage.comparable && stage.changed);
  const firstIncomparableIndex = stages.findIndex((stage) => !stage.comparable);
  const changedAfterEvidenceGap = firstChangedIndex >= 0
    && firstIncomparableIndex >= 0
    && firstIncomparableIndex < firstChangedIndex;
  const indeterminate = firstIncomparableIndex >= 0
    && (firstChangedIndex < 0 || changedAfterEvidenceGap);
  const earliestDivergence = firstChangedIndex >= 0 && !indeterminate
    ? stages[firstChangedIndex]?.stage
    : undefined;
  const firstIncomparableStage = indeterminate
    ? stages[firstIncomparableIndex]?.stage
    : undefined;
  const status = indeterminate ? "indeterminate" : earliestDivergence ? "found" : "none";
  return {
    format: "engram.memory-decision-diff",
    version: 1,
    baselineRunId: baseline.id,
    treatmentRunId: treatment.id,
    status,
    stages,
    ...(earliestDivergence ? { earliestDivergence } : {}),
    ...(firstIncomparableStage ? { firstIncomparableStage } : {}),
    answerChanged: baseline.answer.content !== treatment.answer.content
  };
}

function compareStage(
  stage: MemoryDecisionStageKind,
  baseline: MemoryDecisionRunV3,
  treatment: MemoryDecisionRunV3
): MemoryDecisionStageDiff {
  const comparable = stageComparable(stage, baseline, treatment);
  if (!comparable) {
    return stageDiff(
      stage,
      false,
      false,
      "This stage cannot be compared because one run lacks evidence.",
      stageMemoryIds(stage, baseline),
      stageMemoryIds(stage, treatment)
    );
  }
  switch (stage) {
    case "memory_state": {
      const before = memoryStateSignature(baseline.memoryState.after);
      const after = memoryStateSignature(treatment.memoryState.after);
      const changed = before !== after;
      return stageDiff(stage, true, changed, changed
        ? `Memory status changed: ${describeStatusChanges(baseline, treatment)}.`
        : "Memory state remained unchanged.",
      sortedUnique(baseline.memoryState.after.map((memory) => memory.id)),
      sortedUnique(treatment.memoryState.after.map((memory) => memory.id)));
    }
    case "retrieval": {
      const before = candidateSignature(baseline);
      const after = candidateSignature(treatment);
      const changed = before !== after;
      return stageDiff(stage, true, changed, changed
        ? "Eligibility or ranking changed under the treatment policy."
        : "Candidate eligibility and ranking remained unchanged.",
      eligibleIds(baseline), eligibleIds(treatment));
    }
    case "selection": {
      const baselineIds = sortedUnique(baseline.retrieval.selectedIds);
      const treatmentIds = sortedUnique(treatment.retrieval.selectedIds);
      const changed = signature(baselineIds) !== signature(treatmentIds);
      return stageDiff(stage, true, changed, changed
        ? `Selection changed from ${list(baselineIds)} to ${list(treatmentIds)}.`
        : "The same memories were selected.",
      baselineIds, treatmentIds);
    }
    case "active_context": {
      const changed = activeContextSignature(baseline) !== activeContextSignature(treatment);
      return stageDiff(stage, true, changed, changed
        ? `Active context changed from ${list(baseline.context.orderedIds)} to ${list(treatment.context.orderedIds)}.`
        : "The same memories reached active context.",
      sortedUnique(baseline.context.loadedIds), sortedUnique(treatment.context.loadedIds));
    }
    case "answer": {
      const changed = baseline.answer.content !== treatment.answer.content;
      return stageDiff(stage, true, changed, changed
        ? "The answer changed after the memory-policy intervention."
        : "The answer remained unchanged.",
      sortedUnique(baseline.context.loadedIds), sortedUnique(treatment.context.loadedIds));
    }
  }
}

function stageDiff(
  stage: MemoryDecisionStageKind,
  comparable: boolean,
  changed: boolean,
  summary: string,
  baselineMemoryIds: string[],
  treatmentMemoryIds: string[]
): MemoryDecisionStageDiff {
  return { stage, comparable, changed, summary, baselineMemoryIds, treatmentMemoryIds };
}

function memoryStateSignature(memories: MemoryDecisionRunV3["memoryState"]["after"]) {
  return canonicalJson(memories.map((memory) => ({
    id: memory.id,
    content: memory.content,
    value: memory.value,
    subject: memory.subject,
    status: memory.status,
    tier: memory.tier,
    scope: memory.scope,
    provider: memory.provider,
    storeId: memory.storeId,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    validFrom: memory.validFrom,
    validTo: memory.validTo,
    supersedes: memory.supersedes ? sortedUnique(memory.supersedes) : undefined,
    supersededBy: memory.supersededBy,
    owner: memory.owner,
    namespace: memory.namespace,
    metadata: memory.metadata
  })).sort((left, right) => compareIds(left.id, right.id)));
}

function candidateSignature(run: MemoryDecisionRunV3) {
  return canonicalJson({
    policy: {
      id: run.retrieval.policy.id,
      version: run.retrieval.policy.version,
      fingerprint: run.retrieval.policy.fingerprint,
      configuration: run.retrieval.policy.configuration,
      corpus: run.retrieval.policy.corpus
    },
    candidates: run.retrieval.candidates.map((candidate) => ({
      memoryId: candidate.memoryId,
      eligible: candidate.eligible,
      rank: candidate.rank,
      score: candidate.score,
      scoreComponents: candidate.scoreComponents
    })).sort((left, right) => compareIds(left.memoryId, right.memoryId))
  });
}

function eligibleIds(run: MemoryDecisionRunV3) {
  return sortedUnique(run.retrieval.candidates.filter((candidate) => candidate.eligible).map((candidate) => candidate.memoryId));
}

function describeStatusChanges(baseline: MemoryDecisionRunV3, treatment: MemoryDecisionRunV3) {
  const before = new Map(baseline.memoryState.after.map((memory) => [memory.id, memory.status]));
  const changes = treatment.memoryState.after.flatMap((memory) => {
    const previous = before.get(memory.id);
    return previous !== memory.status ? [`${memory.id} ${previous ?? "missing"} -> ${memory.status}`] : [];
  });
  return changes.length ? changes.join(", ") : "state contents changed";
}

function signature(values: string[]) {
  return JSON.stringify(values);
}

function stageComparable(
  stage: MemoryDecisionStageKind,
  baseline: MemoryDecisionRunV3,
  treatment: MemoryDecisionRunV3
) {
  return baseline.evidenceCoverage[stage] !== "unavailable"
    && treatment.evidenceCoverage[stage] !== "unavailable";
}

function stageMemoryIds(stage: MemoryDecisionStageKind, run: MemoryDecisionRunV3) {
  if (stage === "memory_state") return sortedUnique(run.memoryState.after.map((memory) => memory.id));
  if (stage === "retrieval") return sortedUnique(run.retrieval.candidates.map((candidate) => candidate.memoryId));
  if (stage === "selection") return sortedUnique(run.retrieval.selectedIds);
  return stage === "active_context" ? [...run.context.orderedIds] : sortedUnique(run.context.loadedIds);
}

function list(values: string[]) {
  return values.length ? values.join(", ") : "none";
}

function activeContextSignature(run: MemoryDecisionRunV3) {
  return canonicalJson({
    loadedIds: sortedUnique(run.context.loadedIds),
    orderedIds: run.context.orderedIds,
    truncatedIds: sortedUnique(run.context.truncatedIds),
    forcedIds: sortedUnique(run.context.forcedIds)
  });
}

function assertComparableRunIdentity(
  baseline: MemoryDecisionRunV3,
  treatment: MemoryDecisionRunV3
) {
  const identityFields = ["traceId", "turnId", "sessionId", "projectId", "userId", "startedAt", "input"] as const;
  for (const field of identityFields) {
    if (baseline[field] !== treatment[field]) {
      throw new Error(`Cannot compare memory decision runs with different ${field}.`);
    }
  }
  if (baseline.retrieval.query !== treatment.retrieval.query) {
    throw new Error("Cannot compare memory decision runs with different retrieval queries.");
  }
  if (canonicalJson(baseline.retrieval.policy.corpus ?? null) !== canonicalJson(treatment.retrieval.policy.corpus ?? null)) {
    throw new Error("Cannot compare memory decision runs from different memory corpora.");
  }
  if (memoryStateSignature(baseline.memoryState.before) !== memoryStateSignature(treatment.memoryState.before)) {
    throw new Error("Cannot compare memory decision runs from different starting memory states.");
  }
}

function sortedUnique(values: readonly string[]) {
  return [...new Set(values)].sort(compareIds);
}

function compareIds(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
