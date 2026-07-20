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
  const stages = stageOrder.map((stage) => compareStage(stage, baseline, treatment));
  const earliestDivergence = stages.find((stage) => stage.comparable && stage.changed)?.stage;
  const firstIncomparableStage = stages.find((stage) => !stage.comparable)?.stage;
  const status = earliestDivergence
    ? "found"
    : firstIncomparableStage ? "indeterminate" : "none";
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
      baseline.memoryState.after.map((memory) => memory.id),
      treatment.memoryState.after.map((memory) => memory.id));
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
      const changed = signature(baseline.retrieval.selectedIds) !== signature(treatment.retrieval.selectedIds);
      return stageDiff(stage, true, changed, changed
        ? `Selection changed from ${list(baseline.retrieval.selectedIds)} to ${list(treatment.retrieval.selectedIds)}.`
        : "The same memories were selected.",
      baseline.retrieval.selectedIds, treatment.retrieval.selectedIds);
    }
    case "active_context": {
      const changed = signature(baseline.context.orderedIds) !== signature(treatment.context.orderedIds);
      return stageDiff(stage, true, changed, changed
        ? `Active context changed from ${list(baseline.context.orderedIds)} to ${list(treatment.context.orderedIds)}.`
        : "The same memories reached active context.",
      baseline.context.loadedIds, treatment.context.loadedIds);
    }
    case "answer": {
      const changed = baseline.answer.content !== treatment.answer.content;
      return stageDiff(stage, true, changed, changed
        ? "The answer changed after the memory-policy intervention."
        : "The answer remained unchanged.",
      baseline.context.loadedIds, treatment.context.loadedIds);
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
    validFrom: memory.validFrom,
    validTo: memory.validTo,
    supersedes: memory.supersedes,
    supersededBy: memory.supersededBy
  })));
}

function candidateSignature(run: MemoryDecisionRunV3) {
  return canonicalJson({
    policy: run.retrieval.policy,
    candidates: run.retrieval.candidates.map((candidate) => ({
      memoryId: candidate.memoryId,
      eligible: candidate.eligible,
      rank: candidate.rank,
      score: candidate.score,
      scoreComponents: candidate.scoreComponents,
      filterReason: candidate.filterReason
    }))
  });
}

function eligibleIds(run: MemoryDecisionRunV3) {
  return run.retrieval.candidates.filter((candidate) => candidate.eligible).map((candidate) => candidate.memoryId);
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
  if (stage === "memory_state") return run.memoryState.after.map((memory) => memory.id);
  if (stage === "retrieval") return run.retrieval.candidates.map((candidate) => candidate.memoryId);
  if (stage === "selection") return run.retrieval.selectedIds;
  return run.context.loadedIds;
}

function list(values: string[]) {
  return values.length ? values.join(", ") : "none";
}
