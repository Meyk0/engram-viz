import {
  parseMemoryDecisionRunV3,
  parseMemoryPolicyReplayResult
} from "./reliability-schema.js";
import type {
  MemoryAnswerAssertion,
  MemoryDecisionDiff,
  MemoryDecisionRunV3,
  MemoryDecisionStageDiff,
  MemoryDecisionStageKind,
  MemoryExecutorManifest,
  MemoryPolicyReplayRequest,
  MemoryPolicyReplayResult
} from "./reliability.js";

const stageOrder: MemoryDecisionStageKind[] = [
  "memory_state",
  "retrieval",
  "selection",
  "active_context",
  "answer"
];

export function buildMemoryDecisionDiff(
  baselineInput: MemoryDecisionRunV3,
  treatmentInput: MemoryDecisionRunV3
): MemoryDecisionDiff {
  const baseline = parseMemoryDecisionRunV3(baselineInput);
  const treatment = parseMemoryDecisionRunV3(treatmentInput);
  assertComparableIdentity(baseline, treatment);
  const stages = stageOrder.map((stage) => compareStage(stage, baseline, treatment));
  const firstChanged = stages.findIndex((stage) => stage.comparable && stage.changed);
  const firstUnavailable = stages.findIndex((stage) => !stage.comparable);
  const indeterminate = firstUnavailable >= 0 && (firstChanged < 0 || firstUnavailable < firstChanged);
  const earliestDivergence = firstChanged >= 0 && !indeterminate ? stages[firstChanged]?.stage : undefined;
  const firstIncomparableStage = indeterminate ? stages[firstUnavailable]?.stage : undefined;
  return {
    format: "engram.memory-decision-diff",
    version: 1,
    baselineRunId: baseline.id,
    treatmentRunId: treatment.id,
    status: indeterminate ? "indeterminate" : earliestDivergence ? "found" : "none",
    stages,
    ...(earliestDivergence ? { earliestDivergence } : {}),
    ...(firstIncomparableStage ? { firstIncomparableStage } : {}),
    answerChanged: baseline.answer.content !== treatment.answer.content
  };
}

export function buildMemoryPolicyReplayResult(input: {
  manifest: MemoryExecutorManifest;
  request: MemoryPolicyReplayRequest;
  baseline: MemoryDecisionRunV3;
  treatment: MemoryDecisionRunV3;
  caveat: string;
}): MemoryPolicyReplayResult {
  const source = parseMemoryDecisionRunV3(input.request.baseline);
  const baseline = normalizeReplayIdentity(parseMemoryDecisionRunV3(input.baseline), source, input.manifest, "baseline");
  const treatment = normalizeReplayIdentity(parseMemoryDecisionRunV3(input.treatment), source, input.manifest, "treatment");
  const diff = buildMemoryDecisionDiff(baseline, treatment);
  const reproductionDiff = buildMemoryDecisionDiff(source, baseline);
  const reproductionComparable = reproductionDiff.stages.every((stage) => stage.comparable && !stage.changed);
  const reproduced = reproductionComparable && source.answer.content === baseline.answer.content;
  const expected = input.request.expectedAnswerFragments ?? [];
  const matched = expected.filter((fragment) => includesNormalized(treatment.answer.content, fragment));
  const assertion = input.request.answerAssertion ?? (expected.length > 0
    ? { type: "contains_all", values: expected } satisfies MemoryAnswerAssertion
    : undefined);
  const assertionResult = assertion
    ? evaluateMemoryAnswerAssertion(treatment.answer.content, assertion)
    : { passed: diff.answerChanged, failures: diff.answerChanged ? [] : ["The treatment answer did not change."] };
  const failures = [
    ...(reproductionComparable ? [] : ["The executor did not reproduce every comparable source decision stage."]),
    ...(source.answer.content === baseline.answer.content ? [] : ["The executor did not reproduce the observed answer."]),
    ...assertionResult.failures
  ];

  return parseMemoryPolicyReplayResult({
    format: "engram.memory-policy-replay",
    version: 1,
    level: strongestExecutionLevel(input.manifest.capabilities.levels),
    executor: {
      id: input.manifest.id,
      version: input.manifest.executorVersion,
      deterministic: input.manifest.capabilities.deterministic
    },
    capabilities: structuredClone(input.manifest.capabilities),
    intervention: structuredClone(input.request.intervention),
    source,
    baseline,
    treatment,
    diff,
    reproduction: {
      reproduced,
      observedAnswer: source.answer.content,
      replayedAnswer: baseline.answer.content
    },
    verification: {
      passed: reproduced && assertionResult.passed && failures.length === 0,
      ...(assertion ? { assertion } : {}),
      failures,
      expectedAnswerFragments: [...expected],
      matchedAnswerFragments: matched
    },
    caveat: input.caveat
  });
}

function strongestExecutionLevel(levels: MemoryExecutorManifest["capabilities"]["levels"]) {
  for (const level of ["robustness", "agent", "provider", "policy", "context"] as const) {
    if (levels.includes(level)) return level;
  }
  return "context";
}

export function evaluateMemoryAnswerAssertion(answer: string, assertion: MemoryAnswerAssertion) {
  const normalizeAssertion = (value: string) => assertion.caseSensitive ? value.trim() : normalize(value);
  const actual = normalizeAssertion(answer);
  if (assertion.type === "exact") {
    const passed = actual === normalizeAssertion(assertion.value);
    return { passed, failures: passed ? [] : ["The treatment answer did not exactly match the expected answer."] };
  }
  const missing = assertion.values.filter((value) => !actual.includes(normalizeAssertion(value)));
  const forbidden = (assertion.forbidden ?? []).filter((value) => actual.includes(normalizeAssertion(value)));
  return {
    passed: missing.length === 0 && forbidden.length === 0,
    failures: [
      ...missing.map((value) => `The treatment answer did not contain: ${value}`),
      ...forbidden.map((value) => `The treatment answer contained forbidden text: ${value}`)
    ]
  };
}

function normalizeReplayIdentity(
  run: MemoryDecisionRunV3,
  source: MemoryDecisionRunV3,
  manifest: MemoryExecutorManifest,
  variant: "baseline" | "treatment"
): MemoryDecisionRunV3 {
  return parseMemoryDecisionRunV3({
    ...run,
    id: run.id || `${source.id}-${variant}`,
    traceId: source.traceId,
    turnId: source.turnId,
    ...(source.sessionId ? { sessionId: source.sessionId } : {}),
    ...(source.projectId ? { projectId: source.projectId } : {}),
    ...(source.userId ? { userId: source.userId } : {}),
    startedAt: source.startedAt,
    input: source.input,
    answer: {
      ...run.answer,
      provider: { id: manifest.id, model: manifest.executorVersion }
    }
  });
}

function compareStage(
  stage: MemoryDecisionStageKind,
  baseline: MemoryDecisionRunV3,
  treatment: MemoryDecisionRunV3
): MemoryDecisionStageDiff {
  const baselineIds = stageIds(stage, baseline);
  const treatmentIds = stageIds(stage, treatment);
  const comparable = baseline.evidenceCoverage[stage] !== "unavailable"
    && treatment.evidenceCoverage[stage] !== "unavailable";
  if (!comparable) {
    return { stage, comparable: false, changed: false, summary: "This stage cannot be compared because one run lacks evidence.", baselineMemoryIds: baselineIds, treatmentMemoryIds: treatmentIds };
  }
  const changed = stageSignature(stage, baseline) !== stageSignature(stage, treatment);
  const summaries: Record<MemoryDecisionStageKind, [string, string]> = {
    memory_state: ["Memory state remained unchanged.", "Memory contents or lifecycle status changed."],
    retrieval: ["Candidate generation and ranking remained unchanged.", "Candidate generation, eligibility, scores, or ranking changed."],
    selection: ["The same memories were selected.", "The selected memory set changed."],
    active_context: ["The same memories reached active context.", "The active memory context changed."],
    answer: ["The answer remained unchanged.", "The answer changed after the intervention."]
  };
  return { stage, comparable: true, changed, summary: summaries[stage][changed ? 1 : 0], baselineMemoryIds: baselineIds, treatmentMemoryIds: treatmentIds };
}

function stageSignature(stage: MemoryDecisionStageKind, run: MemoryDecisionRunV3) {
  if (stage === "memory_state") return canonical(run.memoryState.after.map((memory) => ({ ...memory, evidence: undefined })).sort(byId));
  if (stage === "retrieval") return canonical({
    policy: { ...run.retrieval.policy, evidence: undefined },
    candidates: run.retrieval.candidates.map((candidate) => ({
      memoryId: candidate.memoryId,
      rank: candidate.rank,
      score: candidate.score,
      scoreComponents: candidate.scoreComponents,
      eligible: candidate.eligible,
      filterReason: candidate.filterReason
    })).sort(byId)
  });
  if (stage === "selection") return canonical([...run.retrieval.selectedIds].sort());
  if (stage === "active_context") return canonical({
    loadedIds: [...run.context.loadedIds].sort(),
    orderedIds: run.context.orderedIds,
    truncatedIds: [...run.context.truncatedIds].sort(),
    forcedIds: [...run.context.forcedIds].sort()
  });
  return run.answer.content;
}

function stageIds(stage: MemoryDecisionStageKind, run: MemoryDecisionRunV3) {
  const ids = stage === "memory_state"
    ? run.memoryState.after.map((memory) => memory.id)
    : stage === "retrieval"
      ? run.retrieval.candidates.map((candidate) => candidate.memoryId)
      : stage === "selection"
        ? run.retrieval.selectedIds
        : run.context.loadedIds;
  return [...new Set(ids)].sort();
}

function assertComparableIdentity(baseline: MemoryDecisionRunV3, treatment: MemoryDecisionRunV3) {
  for (const field of ["traceId", "turnId", "sessionId", "projectId", "userId", "startedAt", "input"] as const) {
    if (baseline[field] !== treatment[field]) throw new Error(`Cannot compare runs with different ${field}.`);
  }
}

function canonical(value: unknown) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, sortValue(item)]));
}

function byId(left: { id?: string; memoryId?: string }, right: { id?: string; memoryId?: string }) {
  return (left.id ?? left.memoryId ?? "").localeCompare(right.id ?? right.memoryId ?? "");
}

function normalize(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function includesNormalized(value: string, fragment: string) {
  return normalize(value).includes(normalize(fragment));
}
