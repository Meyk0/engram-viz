import {
  parseMemoryDecisionRunV3,
  parseMemoryInterventionV2,
  parseMemoryPolicyReplayResult,
  type MemoryAnswerAssertion,
  type MemoryPolicyReplayResult,
  type MemoryDecisionCandidate,
  type MemoryDecisionMemory,
  type MemoryDecisionRunV3,
  type MemoryInterventionOperationV2,
  type MemoryPolicyReplayRequest,
  type MemoryPolicyRule
} from "@engramviz/core";
import { buildMemoryDecisionDiff } from "@/lib/reliability/diff";
import { canonicalJson, fingerprintMemoryDecisionRun } from "@/lib/reliability/fingerprint";

export const POLICY_REPLAY_CAVEAT =
  "Deterministic policy replay reruns state resolution, eligibility, ranking, selection, context assembly, and the configured fixture answer over the recorded candidate set. It does not rerun provider candidate generation, inject newly upserted memories into that candidate set, or prove hidden model causality.";

export type DeterministicPolicyReplayExecutor = {
  id: string;
  version: string;
  deterministic: true;
  generateAnswer: (input: string, memories: MemoryDecisionMemory[]) => string;
};

export function runDeterministicPolicyReplay(
  request: MemoryPolicyReplayRequest,
  executor: DeterministicPolicyReplayExecutor
): MemoryPolicyReplayResult {
  const source = parseMemoryDecisionRunV3(request.baseline);
  const intervention = parseMemoryInterventionV2(request.intervention);
  if (intervention.targetRunId !== source.id) {
    throw new Error("The intervention does not target this memory decision run.");
  }
  assertInterventionAgainstSource(source, intervention);
  assertInterventionPreconditions(source, intervention);

  const baseline = replayVariant({
    source,
    operations: [],
    replayId: `${source.id}-policy-baseline`,
    replayedAt: source.completedAt,
    executor
  });
  const treatment = replayVariant({
    source,
    operations: intervention.operations,
    replayId: `${source.id}-treatment-${intervention.id}`,
    replayedAt: intervention.createdAt,
    executor,
    interventionId: intervention.id
  });
  const diff = buildMemoryDecisionDiff(baseline, treatment);
  const expected = request.expectedAnswerFragments ?? [];
  const matched = expected.filter((fragment) => includesNormalized(treatment.answer.content, fragment));
  const baselineDiff = buildMemoryDecisionDiff(source, baseline);
  const stageEquivalent = baselineDiff.status === "none"
    && baselineDiff.stages.every((stage) => stage.comparable && !stage.changed);
  const executorIdentityMatches = replayExecutorMatchesSource(source, executor);
  const policyIdentityMatches = policyIdentity(source) === policyIdentity(baseline);
  const reproduced = stageEquivalent && executorIdentityMatches && policyIdentityMatches;
  const assertion = request.answerAssertion ?? (expected.length > 0
    ? { type: "contains_all", values: expected } satisfies MemoryAnswerAssertion
    : undefined);
  const assertionResult = assertion
    ? evaluateAnswerAssertion(treatment.answer.content, assertion)
    : { passed: diff.answerChanged, failures: diff.answerChanged ? [] : ["The treatment answer did not change."] };

  return parseMemoryPolicyReplayResult({
    format: "engram.memory-policy-replay",
    version: 1,
    level: "policy",
    executor: {
      id: executor.id,
      version: executor.version,
      deterministic: executor.deterministic
    },
    capabilities: {
      levels: ["policy"],
      deterministic: executor.deterministic,
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
    intervention: structuredClone(intervention),
    source: structuredClone(source),
    baseline,
    treatment,
    diff,
    reproduction: {
      reproduced,
      observedAnswer: source.answer.content,
      replayedAnswer: baseline.answer.content
    },
    verification: {
      passed: reproduced && assertionResult.passed,
      ...(assertion ? { assertion } : {}),
      failures: [
        ...(stageEquivalent ? [] : ["The replay baseline did not reproduce every comparable memory-decision stage."]),
        ...(executorIdentityMatches ? [] : ["The replay executor identity does not match the captured answer provider." ]),
        ...(policyIdentityMatches ? [] : ["The replay policy identity does not match the captured policy snapshot."]),
        ...assertionResult.failures
      ],
      expectedAnswerFragments: [...expected],
      matchedAnswerFragments: matched
    },
    caveat: POLICY_REPLAY_CAVEAT
  });
}

function assertInterventionPreconditions(
  source: MemoryDecisionRunV3,
  intervention: MemoryPolicyReplayRequest["intervention"]
) {
  if (
    intervention.baselineFingerprint
    && intervention.baselineFingerprint !== fingerprintMemoryDecisionRun(source)
  ) {
    throw new Error("The intervention baseline fingerprint no longer matches this run.");
  }
  const policyFingerprint = intervention.preconditions?.policyFingerprint;
  if (policyFingerprint && policyFingerprint !== source.retrieval.policy.fingerprint) {
    throw new Error("The intervention policy fingerprint no longer matches this run.");
  }
  const memoryById = new Map(source.memoryState.before.map((memory) => [memory.id, memory]));
  for (const expected of intervention.preconditions?.memories ?? []) {
    const actual = memoryById.get(expected.memoryId);
    if (!actual) throw new Error(`Intervention precondition memory ${expected.memoryId} is missing.`);
    if (expected.status && expected.status !== actual.status) {
      throw new Error(`Intervention precondition for ${expected.memoryId} expected status ${expected.status}.`);
    }
    if (expected.content !== undefined && canonicalJson(expected.content) !== canonicalJson(actual.content)) {
      throw new Error(`Intervention precondition for ${expected.memoryId} expected different content.`);
    }
  }
}

function assertInterventionAgainstSource(
  source: MemoryDecisionRunV3,
  intervention: MemoryPolicyReplayRequest["intervention"]
) {
  const sourceMemories = new Map(source.memoryState.before.map((memory) => [memory.id, memory]));
  const resultingMemories = new Map(sourceMemories);
  const candidateIds = new Set(source.retrieval.candidates.map((candidate) => candidate.memoryId));

  for (const operation of intervention.operations) {
    if (operation.type === "memory_upsert") {
      const existing = sourceMemories.get(operation.memory.id);
      if (existing) assertMatchingOwners(existing, operation.memory);
      assertMemoryPrincipal(source, operation.memory);
      resultingMemories.set(operation.memory.id, operation.memory);
      continue;
    }
    if (operation.type === "memory_replace") {
      const target = sourceMemories.get(operation.memoryId);
      if (!target) throw new Error(`Memory intervention references unknown memory ${operation.memoryId}.`);
      if (operation.replacement.id !== operation.memoryId && resultingMemories.has(operation.replacement.id)) {
        throw new Error(`Replacement memory ${operation.replacement.id} collides with an existing memory.`);
      }
      if (operation.replacement.id !== operation.memoryId && candidateIds.has(operation.replacement.id)) {
        throw new Error(`Replacement memory ${operation.replacement.id} collides with a recorded candidate.`);
      }
      assertMatchingOwners(target, operation.replacement);
      assertMemoryPrincipal(source, operation.replacement);
      resultingMemories.delete(operation.memoryId);
      resultingMemories.set(operation.replacement.id, operation.replacement);
      continue;
    }
    if (operation.type === "memory_status" || operation.type === "memory_restore") {
      if (!sourceMemories.has(operation.memoryId)) {
        throw new Error(`Memory intervention references unknown memory ${operation.memoryId}.`);
      }
    }
  }

  for (const operation of intervention.operations) {
    if (operation.type === "memory_status" && operation.supersededByMemoryId) {
      if (!resultingMemories.has(operation.supersededByMemoryId)) {
        throw new Error(`Superseding memory ${operation.supersededByMemoryId} is unknown.`);
      }
      const target = sourceMemories.get(operation.memoryId);
      const replacement = resultingMemories.get(operation.supersededByMemoryId);
      if (target && replacement) assertMatchingOwners(target, replacement);
    }
    if (operation.type === "context_override") {
      const replacements = replacementIds(intervention.operations);
      const effectiveId = replacements.get(operation.memoryId) ?? operation.memoryId;
      if (!resultingMemories.has(effectiveId)) {
        throw new Error(`Context intervention references unknown memory ${operation.memoryId}.`);
      }
    }
  }
}

function evaluateAnswerAssertion(answer: string, assertion: MemoryAnswerAssertion) {
  const normalizeForAssertion = (value: string) => assertion.caseSensitive ? value.trim() : normalize(value);
  const actual = normalizeForAssertion(answer);
  if (assertion.type === "exact") {
    const passed = actual === normalizeForAssertion(assertion.value);
    return { passed, failures: passed ? [] : ["The treatment answer did not exactly match the expected answer."] };
  }
  const missing = assertion.values.filter((value) => !actual.includes(normalizeForAssertion(value)));
  const presentForbidden = (assertion.forbidden ?? []).filter((value) => actual.includes(normalizeForAssertion(value)));
  return {
    passed: missing.length === 0 && presentForbidden.length === 0,
    failures: [
      ...missing.map((value) => `The treatment answer did not contain: ${value}`),
      ...presentForbidden.map((value) => `The treatment answer contained forbidden text: ${value}`)
    ]
  };
}

function replayVariant(input: {
  source: MemoryDecisionRunV3;
  operations: MemoryInterventionOperationV2[];
  replayId: string;
  replayedAt: string;
  interventionId?: string;
  executor: DeterministicPolicyReplayExecutor;
}): MemoryDecisionRunV3 {
  const { source, operations } = input;
  const rules = enabledRules(source, operations);
  const memoryState = applyStatePolicy(source.memoryState.before, operations, rules);
  const limit = retrievalLimit(source, operations);
  const threshold = retrievalParameter(operations, "score_threshold");
  const recencyWeight = retrievalParameter(operations, "recency_weight") ?? 0;
  const replacements = replacementIds(operations);
  const candidates = rerankCandidates(source, memoryState, rules, threshold, recencyWeight, replacements);
  const selectedIds = candidates
    .filter((candidate) => candidate.eligible)
    .slice(0, limit)
    .map((candidate) => candidate.memoryId);
  const context = applyContextOverrides(selectedIds, operations, memoryState, replacements);
  const loadedIds = context.loadedIds;
  const memoryById = new Map(memoryState.map((memory) => [memory.id, memory]));
  const loadedMemories = loadedIds.flatMap((id) => {
    const memory = memoryById.get(id);
    return memory ? [memory] : [];
  });
  const completedAt = new Date(Math.max(
    Date.parse(source.completedAt),
    Date.parse(input.replayedAt)
  ) + 1).toISOString();
  const changesPolicy = operations.some((operation) =>
    operation.type === "policy_rule" || operation.type === "retrieval_parameter"
  );

  return {
    ...structuredClone(source),
    id: input.replayId,
    completedAt,
    memoryState: {
      before: structuredClone(source.memoryState.before),
      after: memoryState
    },
    retrieval: {
      ...structuredClone(source.retrieval),
      limit,
      candidates: candidates.map((candidate, index) => ({
        ...candidate,
        rank: index + 1,
        selected: selectedIds.includes(candidate.memoryId),
        loaded: loadedIds.includes(candidate.memoryId),
        evidence: "simulated"
      })),
      selectedIds,
      policy: {
        ...structuredClone(source.retrieval.policy),
        ...(changesPolicy ? {
          configuration: {
            ...(source.retrieval.policy.configuration ?? {}),
            limit,
            scoreThreshold: threshold ?? null,
            recencyWeight,
            enabledRules: [...rules].sort(compareIds)
          }
        } : {}),
        evidence: "simulated"
      }
    },
    context: {
      ...structuredClone(source.context),
      loadedIds,
      orderedIds: loadedIds,
      truncatedIds: selectedIds.filter((id) => !loadedIds.includes(id)),
      forcedIds: context.forcedIds,
      evidence: "simulated"
    },
    answer: {
      content: input.executor.generateAnswer(source.input, loadedMemories),
      provider: { id: input.executor.id, model: input.executor.version },
      evidence: "simulated"
    },
    evidenceCoverage: {
      memory_state: "simulated",
      retrieval: "simulated",
      selection: "simulated",
      active_context: "simulated",
      answer: "simulated"
    },
    metadata: {
      ...(source.metadata ?? {}),
      replayLevel: "policy",
      ...(input.interventionId ? { interventionId: input.interventionId } : {}),
      baselineReplay: !input.interventionId
    }
  };
}

function applyStatePolicy(
  memories: MemoryDecisionMemory[],
  operations: MemoryInterventionOperationV2[],
  rules: Set<MemoryPolicyRule>
) {
  const result = structuredClone(memories);
  for (const operation of operations) {
    if (operation.type === "memory_upsert") {
      const index = result.findIndex((candidate) => candidate.id === operation.memory.id);
      const memory = { ...structuredClone(operation.memory), evidence: "simulated" as const };
      if (index >= 0) result[index] = memory;
      else result.push(memory);
      continue;
    }
    if (operation.type === "memory_replace") {
      const index = result.findIndex((candidate) => candidate.id === operation.memoryId);
      if (index < 0) throw new Error(`Memory intervention references unknown memory ${operation.memoryId}.`);
      result[index] = { ...structuredClone(operation.replacement), evidence: "simulated" };
      continue;
    }
    if (operation.type === "memory_restore") {
      const memory = result.find((candidate) => candidate.id === operation.memoryId);
      if (!memory) throw new Error(`Memory intervention references unknown memory ${operation.memoryId}.`);
      memory.status = "active";
      delete memory.supersededBy;
      memory.evidence = "simulated";
      continue;
    }
    if (operation.type === "memory_status") {
      const memory = result.find((candidate) => candidate.id === operation.memoryId);
      if (!memory) throw new Error(`Memory intervention references unknown memory ${operation.memoryId}.`);
      memory.status = operation.status;
      if (operation.supersededByMemoryId) {
        memory.supersededBy = operation.supersededByMemoryId;
        const current = result.find((candidate) => candidate.id === operation.supersededByMemoryId);
        if (current) current.supersedes = [...new Set([...(current.supersedes ?? []), memory.id])];
      }
      memory.evidence = "simulated";
    }
  }

  for (const operation of operations) {
    if (operation.type !== "memory_status" || !operation.supersededByMemoryId) continue;
    const current = result.find((candidate) => candidate.id === operation.supersededByMemoryId);
    if (!current) throw new Error(`Superseding memory ${operation.supersededByMemoryId} is unavailable at apply time.`);
    current.supersedes = [...new Set([...(current.supersedes ?? []), operation.memoryId])];
    current.evidence = "simulated";
  }

  if (rules.has("prefer_latest_active_for_subject")) {
    const groups = new Map<string, MemoryDecisionMemory[]>();
    for (const memory of result) {
      if (!memory.subject || memory.status !== "active") continue;
      groups.set(memory.subject, [...(groups.get(memory.subject) ?? []), memory]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const sorted = group.slice().sort((left, right) =>
        timestamp(right) - timestamp(left) || compareIds(left.id, right.id)
      );
      const current = sorted[0];
      if (!current) continue;
      for (const stale of sorted.slice(1)) {
        stale.status = "superseded";
        stale.supersededBy = current.id;
        current.supersedes = [...new Set([...(current.supersedes ?? []), stale.id])];
        stale.evidence = "simulated";
      }
    }
  }
  return result;
}

function rerankCandidates(
  baseline: MemoryDecisionRunV3,
  memories: MemoryDecisionMemory[],
  rules: Set<MemoryPolicyRule>,
  threshold: number | undefined,
  recencyWeight: number,
  replacements: Map<string, string>
) {
  const memoryById = new Map(memories.map((memory) => [memory.id, memory]));
  const newest = Math.max(...memories.map(timestamp), 0);
  const oldest = Math.min(...memories.map(timestamp).filter(Number.isFinite), newest);
  const span = Math.max(newest - oldest, 1);

  const ranked = baseline.retrieval.candidates
    .map((candidate) => {
      const effectiveId = replacements.get(candidate.memoryId) ?? candidate.memoryId;
      const memory = memoryById.get(effectiveId);
      if (!memory) return { ...structuredClone(candidate), eligible: false, filterReason: "Memory is missing from replay state." };
      const statusExcluded =
        (rules.has("exclude_superseded") && memory.status === "superseded")
        || (rules.has("exclude_expired") && memory.status === "expired")
        || memory.status === "quarantined"
        || memory.status === "deleted";
      const baseScore = candidate.score ?? 0;
      const recency = (timestamp(memory) - oldest) / span;
      const score = baseScore + recencyWeight * recency;
      const belowThreshold = threshold !== undefined && score < threshold;
      return {
        ...structuredClone(candidate),
        memoryId: effectiveId,
        memory: structuredClone(memory),
        score,
        scoreComponents: {
          ...(candidate.scoreComponents ?? {}),
          ...(recencyWeight ? { policyRecency: recencyWeight * recency } : {})
        },
        eligible: !statusExcluded && !belowThreshold,
        selected: false,
        loaded: false,
        ...(statusExcluded
          ? { filterReason: `Excluded because memory status is ${memory.status}.` }
          : belowThreshold ? { filterReason: "Below the treatment score threshold." } : { filterReason: undefined })
      } satisfies MemoryDecisionCandidate;
    })
    .sort((left, right) => {
      if (left.eligible !== right.eligible) return Number(right.eligible) - Number(left.eligible);
      if ((left.score ?? 0) !== (right.score ?? 0)) return (right.score ?? 0) - (left.score ?? 0);
      const recency = timestamp(memoryById.get(right.memoryId)) - timestamp(memoryById.get(left.memoryId));
      return recency || compareIds(left.memoryId, right.memoryId);
    });

  if (rules.has("deduplicate_subjects")) {
    const selectedSubjects = new Set<string>();
    for (const candidate of ranked) {
      if (!candidate.eligible) continue;
      const subject = memoryById.get(candidate.memoryId)?.subject;
      if (!subject) continue;
      if (selectedSubjects.has(subject)) {
        candidate.eligible = false;
        candidate.filterReason = "A higher-ranked memory already represents this subject.";
      } else {
        selectedSubjects.add(subject);
      }
    }
    ranked.sort((left, right) => {
      if (left.eligible !== right.eligible) return Number(right.eligible) - Number(left.eligible);
      if ((left.score ?? 0) !== (right.score ?? 0)) return (right.score ?? 0) - (left.score ?? 0);
      const recency = timestamp(memoryById.get(right.memoryId)) - timestamp(memoryById.get(left.memoryId));
      return recency || compareIds(left.memoryId, right.memoryId);
    });
  }

  return ranked.map(({ filterReason, ...candidate }) => filterReason ? { ...candidate, filterReason } : candidate);
}

function replacementIds(operations: MemoryInterventionOperationV2[]) {
  return new Map(
    operations.flatMap((operation) => operation.type === "memory_replace"
      ? [[operation.memoryId, operation.replacement.id] as const]
      : [])
  );
}

function enabledRules(
  baseline: MemoryDecisionRunV3,
  operations: MemoryInterventionOperationV2[]
): Set<MemoryPolicyRule> {
  const configured = baseline.retrieval.policy.configuration?.enabledRules;
  const rules = new Set<MemoryPolicyRule>(
    Array.isArray(configured)
      ? configured.filter(isMemoryPolicyRule)
      : []
  );
  for (const operation of operations) {
    if (operation.type !== "policy_rule") continue;
    if (operation.enabled) rules.add(operation.rule);
    else rules.delete(operation.rule);
  }
  return rules;
}

function retrievalLimit(
  baseline: MemoryDecisionRunV3,
  operations: MemoryInterventionOperationV2[]
) {
  const override = retrievalParameter(operations, "limit");
  return Math.max(1, Math.floor(
    override ?? baseline.retrieval.limit ?? (baseline.retrieval.selectedIds.length || 1)
  ));
}

function retrievalParameter(
  operations: MemoryInterventionOperationV2[],
  parameter: Extract<MemoryInterventionOperationV2, { type: "retrieval_parameter" }>["parameter"]
) {
  for (const operation of operations) {
    if (operation.type === "retrieval_parameter" && operation.parameter === parameter) {
      return operation.value;
    }
  }
  return undefined;
}

function applyContextOverrides(
  selectedIds: string[],
  operations: MemoryInterventionOperationV2[],
  memories: MemoryDecisionMemory[],
  replacements: Map<string, string>
) {
  const result = [...selectedIds];
  const forcedIds: string[] = [];
  const memoryIds = new Set(memories.map((memory) => memory.id));
  for (const operation of operations) {
    if (operation.type !== "context_override") continue;
    const memoryId = replacements.get(operation.memoryId) ?? operation.memoryId;
    if (!memoryIds.has(memoryId)) {
      throw new Error(`Context intervention references unknown memory ${operation.memoryId}.`);
    }
    if (operation.action === "exclude") {
      const index = result.indexOf(memoryId);
      if (index >= 0) result.splice(index, 1);
    } else if (!result.includes(memoryId)) {
      result.push(memoryId);
      forcedIds.push(memoryId);
    }
  }
  return { loadedIds: result, forcedIds };
}

function timestamp(memory: MemoryDecisionMemory | undefined) {
  if (!memory?.createdAt) return 0;
  const value = Date.parse(memory.createdAt);
  return Number.isFinite(value) ? value : 0;
}

function isMemoryPolicyRule(value: unknown): value is MemoryPolicyRule {
  return typeof value === "string" && [
    "prefer_latest_active_for_subject",
    "exclude_superseded",
    "exclude_expired",
    "deduplicate_subjects"
  ].includes(value);
}

function includesNormalized(value: string, expected: string) {
  return normalize(value).includes(normalize(expected));
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function replayExecutorMatchesSource(
  source: MemoryDecisionRunV3,
  executor: DeterministicPolicyReplayExecutor
) {
  const declared = source.metadata?.replayExecutor;
  if (declared && typeof declared === "object" && !Array.isArray(declared)) {
    const id = declared.id;
    const version = declared.version;
    return id === executor.id && version === executor.version;
  }
  return false;
}

function policyIdentity(run: MemoryDecisionRunV3) {
  return canonicalJson({
    id: run.retrieval.policy.id,
    version: run.retrieval.policy.version,
    fingerprint: run.retrieval.policy.fingerprint,
    configuration: run.retrieval.policy.configuration,
    corpus: run.retrieval.policy.corpus
  });
}

function assertMemoryPrincipal(source: MemoryDecisionRunV3, memory: MemoryDecisionMemory) {
  if (source.userId && memory.owner?.type === "user" && memory.owner.id !== source.userId) {
    throw new Error(`Memory ${memory.id} belongs to another user.`);
  }
}

function assertMatchingOwners(left: MemoryDecisionMemory, right: MemoryDecisionMemory) {
  if (!left.owner || !right.owner) return;
  if (left.owner.type !== right.owner.type || left.owner.id !== right.owner.id) {
    throw new Error(`Memory ${right.id} belongs to a different owner than ${left.id}.`);
  }
}

function compareIds(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
