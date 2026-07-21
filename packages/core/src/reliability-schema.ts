import { z } from "zod";
import { jsonValueSchema, memoryScopeSchema, memoryTierSchema } from "./schema.js";
import type {
  MemoryDecisionDiff,
  MemoryDecisionRunV3,
  MemoryInterventionV2,
  MemoryPolicyReplayResult
} from "./reliability.js";

export const memoryDecisionEvidenceLevelSchema = z.enum([
  "observed",
  "mapped",
  "derived",
  "simulated",
  "unavailable"
]);

export const memoryDecisionStageKindSchema = z.enum([
  "memory_state",
  "retrieval",
  "selection",
  "active_context",
  "answer"
]);

export const memoryDecisionStatusSchema = z.enum([
  "active",
  "superseded",
  "quarantined",
  "expired",
  "deleted",
  "unknown"
]);

export const memoryDecisionMemorySchema = z.object({
  id: z.string().min(1),
  content: jsonValueSchema,
  subject: z.string().min(1).optional(),
  value: jsonValueSchema.optional(),
  status: memoryDecisionStatusSchema,
  tier: memoryTierSchema,
  scope: memoryScopeSchema,
  provider: z.string().min(1).optional(),
  storeId: z.string().min(1).optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  validFrom: z.string().datetime().optional(),
  validTo: z.string().datetime().optional(),
  supersedes: z.array(z.string().min(1)).optional(),
  supersededBy: z.string().min(1).optional(),
  owner: z.object({
    type: z.enum(["user", "agent", "tenant", "session", "shared"]),
    id: z.string().min(1)
  }).strict().optional(),
  namespace: z.string().min(1).optional(),
  metadata: z.record(z.string(), jsonValueSchema).optional(),
  evidence: memoryDecisionEvidenceLevelSchema
}).strict().superRefine((memory, context) => {
  if (memory.supersedes?.includes(memory.id)) {
    context.addIssue({ code: "custom", message: "A memory cannot supersede itself.", path: ["supersedes"] });
  }
  if (memory.supersedes && new Set(memory.supersedes).size !== memory.supersedes.length) {
    context.addIssue({ code: "custom", message: "Superseded memory IDs must be unique.", path: ["supersedes"] });
  }
  if (memory.supersededBy === memory.id) {
    context.addIssue({ code: "custom", message: "A memory cannot be superseded by itself.", path: ["supersededBy"] });
  }
});

export const memoryDecisionCandidateSchema = z.object({
  memoryId: z.string().min(1),
  memory: memoryDecisionMemorySchema.optional(),
  rank: z.number().int().positive().optional(),
  score: z.number().finite().optional(),
  scoreComponents: z.record(z.string(), z.number().finite()).optional(),
  eligible: z.boolean(),
  selected: z.boolean(),
  loaded: z.boolean(),
  filterReason: z.string().min(1).optional(),
  evidence: memoryDecisionEvidenceLevelSchema
}).strict();

export const memoryPolicySnapshotSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1).optional(),
  fingerprint: z.string().min(1).optional(),
  configuration: z.record(z.string(), jsonValueSchema).optional(),
  corpus: z.object({
    id: z.string().min(1).optional(),
    version: z.string().min(1).optional(),
    fingerprint: z.string().min(1).optional()
  }).strict().optional(),
  evidence: memoryDecisionEvidenceLevelSchema
}).strict();

export const memoryDecisionRunV3Schema = z.object({
  format: z.literal("engram.memory-decision-run"),
  version: z.literal(3),
  id: z.string().min(1),
  traceId: z.string().min(1),
  turnId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  input: z.string().min(1).max(100_000),
  memoryState: z.object({
    before: z.array(memoryDecisionMemorySchema).max(10_000),
    after: z.array(memoryDecisionMemorySchema).max(10_000)
  }).strict(),
  retrieval: z.object({
    query: z.string().max(100_000),
    limit: z.number().int().positive().optional(),
    candidates: z.array(memoryDecisionCandidateSchema).max(10_000),
    selectedIds: z.array(z.string().min(1)).max(10_000),
    policy: memoryPolicySnapshotSchema
  }).strict(),
  context: z.object({
    loadedIds: z.array(z.string().min(1)).max(10_000),
    orderedIds: z.array(z.string().min(1)).max(10_000),
    truncatedIds: z.array(z.string().min(1)).max(10_000),
    forcedIds: z.array(z.string().min(1)).max(10_000),
    tokenCount: z.number().int().nonnegative().optional(),
    tokenBudget: z.number().int().nonnegative().optional(),
    evidence: memoryDecisionEvidenceLevelSchema
  }).strict(),
  answer: z.object({
    content: z.string().max(200_000),
    provider: z.object({
      id: z.string().min(1),
      model: z.string().min(1).optional()
    }).strict(),
    evidence: memoryDecisionEvidenceLevelSchema
  }).strict(),
  evidenceCoverage: z.record(memoryDecisionStageKindSchema, memoryDecisionEvidenceLevelSchema),
  metadata: z.record(z.string(), jsonValueSchema).optional()
}).strict().superRefine((run, context) => {
  const beforeIds = new Set(run.memoryState.before.map((memory) => memory.id));
  const afterIds = new Set(run.memoryState.after.map((memory) => memory.id));
  const candidateIds = new Set(run.retrieval.candidates.map((candidate) => candidate.memoryId));
  const selectedIds = new Set(run.retrieval.selectedIds);
  const loadedIds = new Set(run.context.loadedIds);
  const orderedIds = new Set(run.context.orderedIds);
  const truncatedIds = new Set(run.context.truncatedIds);
  const forcedIds = new Set(run.context.forcedIds);
  const knownIds = new Set([...beforeIds, ...afterIds, ...candidateIds]);
  const ownersById = new Map<string, string>();

  for (const memory of [
    ...run.memoryState.before,
    ...run.memoryState.after,
    ...run.retrieval.candidates.flatMap((candidate) => candidate.memory ? [candidate.memory] : [])
  ]) {
    if (run.userId && memory.owner?.type === "user" && memory.owner.id !== run.userId) {
      context.addIssue({ code: "custom", message: `Memory ${memory.id} belongs to another user.`, path: ["userId"] });
    }
    const owner = memory.owner ? `${memory.owner.type}:${memory.owner.id}` : undefined;
    const previous = ownersById.get(memory.id);
    if (owner && previous && owner !== previous) {
      context.addIssue({ code: "custom", message: `Memory ${memory.id} has conflicting owners.`, path: ["memoryState"] });
    } else if (owner) {
      ownersById.set(memory.id, owner);
    }
  }

  if (beforeIds.size !== run.memoryState.before.length) {
    context.addIssue({ code: "custom", message: "Before-state memory IDs must be unique.", path: ["memoryState", "before"] });
  }
  if (afterIds.size !== run.memoryState.after.length) {
    context.addIssue({ code: "custom", message: "After-state memory IDs must be unique.", path: ["memoryState", "after"] });
  }
  if (candidateIds.size !== run.retrieval.candidates.length) {
    context.addIssue({ code: "custom", message: "Retrieval candidate IDs must be unique.", path: ["retrieval", "candidates"] });
  }
  addUniqueArrayIssue(context, run.retrieval.selectedIds, ["retrieval", "selectedIds"], "Selected memory IDs");
  addUniqueArrayIssue(context, run.context.loadedIds, ["context", "loadedIds"], "Loaded memory IDs");
  addUniqueArrayIssue(context, run.context.orderedIds, ["context", "orderedIds"], "Ordered context IDs");
  addUniqueArrayIssue(context, run.context.truncatedIds, ["context", "truncatedIds"], "Truncated memory IDs");
  addUniqueArrayIssue(context, run.context.forcedIds, ["context", "forcedIds"], "Forced memory IDs");

  for (const [index, candidate] of run.retrieval.candidates.entries()) {
    if (candidate.memory && candidate.memory.id !== candidate.memoryId) {
      context.addIssue({
        code: "custom",
        message: `Candidate ${candidate.memoryId} embeds memory ${candidate.memory.id}.`,
        path: ["retrieval", "candidates", index, "memory", "id"]
      });
    }
    if (candidate.selected !== selectedIds.has(candidate.memoryId)) {
      context.addIssue({
        code: "custom",
        message: `Candidate ${candidate.memoryId} selected flag does not match selectedIds.`,
        path: ["retrieval", "candidates", index, "selected"]
      });
    }
    if (candidate.loaded !== loadedIds.has(candidate.memoryId)) {
      context.addIssue({
        code: "custom",
        message: `Candidate ${candidate.memoryId} loaded flag does not match loadedIds.`,
        path: ["retrieval", "candidates", index, "loaded"]
      });
    }
    if (candidate.selected && !candidate.eligible) {
      context.addIssue({
        code: "custom",
        message: `Selected candidate ${candidate.memoryId} must be eligible.`,
        path: ["retrieval", "candidates", index, "eligible"]
      });
    }
  }
  for (const id of selectedIds) {
    if (!candidateIds.has(id)) {
      context.addIssue({ code: "custom", message: `Selected memory ${id} is not a retrieval candidate.`, path: ["retrieval", "selectedIds"] });
    }
  }
  if (run.retrieval.limit !== undefined && selectedIds.size > run.retrieval.limit) {
    context.addIssue({ code: "custom", message: "Selected memories cannot exceed the retrieval limit.", path: ["retrieval", "selectedIds"] });
  }
  for (const id of loadedIds) {
    if (!selectedIds.has(id) && !forcedIds.has(id)) {
      context.addIssue({ code: "custom", message: `Loaded memory ${id} was not selected or forced.`, path: ["context", "loadedIds"] });
    }
  }
  for (const id of forcedIds) {
    if (!loadedIds.has(id)) {
      context.addIssue({ code: "custom", message: `Forced memory ${id} is not loaded.`, path: ["context", "forcedIds"] });
    }
    if (selectedIds.has(id)) {
      context.addIssue({ code: "custom", message: `Forced memory ${id} was already selected.`, path: ["context", "forcedIds"] });
    }
  }
  for (const id of [...orderedIds, ...truncatedIds, ...forcedIds, ...loadedIds]) {
    if (!knownIds.has(id)) {
      context.addIssue({ code: "custom", message: `Context memory ${id} is not known to this run.`, path: ["context"] });
    }
  }
  if (!sameSet(orderedIds, loadedIds)) {
    context.addIssue({ code: "custom", message: "orderedIds must contain every loaded memory exactly once.", path: ["context", "orderedIds"] });
  }
  if (run.evidenceCoverage.active_context !== "unavailable") {
    const expectedTruncatedIds = new Set([...selectedIds].filter((id) => !loadedIds.has(id)));
    if (!sameSet(truncatedIds, expectedTruncatedIds)) {
      context.addIssue({ code: "custom", message: "truncatedIds must equal selected memories that were not loaded.", path: ["context", "truncatedIds"] });
    }
  }
  if (
    run.context.tokenCount !== undefined
    && run.context.tokenBudget !== undefined
    && run.context.tokenCount > run.context.tokenBudget
  ) {
    context.addIssue({ code: "custom", message: "Context tokenCount cannot exceed tokenBudget.", path: ["context", "tokenCount"] });
  }
  validateEvidenceCoherence(run, context);
  if (Date.parse(run.completedAt) < Date.parse(run.startedAt)) {
    context.addIssue({ code: "custom", message: "completedAt cannot precede startedAt.", path: ["completedAt"] });
  }
});

const memoryInterventionOperationV2Schema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("memory_status"),
    memoryId: z.string().min(1),
    status: memoryDecisionStatusSchema,
    supersededByMemoryId: z.string().min(1).optional(),
    reason: z.string().min(1)
  }).strict(),
  z.object({
    id: z.string().min(1),
    type: z.literal("policy_rule"),
    rule: z.enum([
      "prefer_latest_active_for_subject",
      "exclude_superseded",
      "exclude_expired",
      "deduplicate_subjects"
    ]),
    enabled: z.boolean(),
    reason: z.string().min(1)
  }).strict(),
  z.object({
    id: z.string().min(1),
    type: z.literal("memory_upsert"),
    memory: memoryDecisionMemorySchema,
    reason: z.string().min(1)
  }).strict(),
  z.object({
    id: z.string().min(1),
    type: z.literal("memory_replace"),
    memoryId: z.string().min(1),
    replacement: memoryDecisionMemorySchema,
    reason: z.string().min(1)
  }).strict(),
  z.object({
    id: z.string().min(1),
    type: z.literal("memory_restore"),
    memoryId: z.string().min(1),
    reason: z.string().min(1)
  }).strict(),
  z.object({
    id: z.string().min(1),
    type: z.literal("retrieval_parameter"),
    parameter: z.enum(["limit", "score_threshold", "recency_weight"]),
    value: z.number().finite(),
    reason: z.string().min(1)
  }).strict(),
  z.object({
    id: z.string().min(1),
    type: z.literal("context_override"),
    action: z.enum(["include", "exclude"]),
    memoryId: z.string().min(1),
    reason: z.string().min(1)
  }).strict()
]);

export const memoryInterventionV2Schema = z.object({
  format: z.literal("engram.memory-intervention"),
  version: z.literal(2),
  id: z.string().min(1),
  targetRunId: z.string().min(1),
  baselineFingerprint: z.string().min(1).optional(),
  preconditions: z.object({
    policyFingerprint: z.string().min(1).optional(),
    memories: z.array(z.object({
      memoryId: z.string().min(1),
      status: memoryDecisionStatusSchema.optional(),
      content: jsonValueSchema.optional()
    }).strict()).max(100).optional()
  }).strict().optional(),
  label: z.string().min(1),
  rationale: z.string().min(1),
  operations: z.array(memoryInterventionOperationV2Schema).min(1).max(100),
  createdAt: z.string().datetime()
}).strict().superRefine((intervention, context) => {
  addUniqueArrayIssue(
    context,
    intervention.operations.map((operation) => operation.id),
    ["operations"],
    "Intervention operation IDs"
  );
  addUniqueArrayIssue(
    context,
    (intervention.preconditions?.memories ?? []).map((memory) => memory.memoryId),
    ["preconditions", "memories"],
    "Intervention precondition memory IDs"
  );

  const stateTargets = new Map<string, number>();
  const introducedIds = new Map<string, number>();
  const policyRules = new Map<string, number>();
  const retrievalParameters = new Map<string, number>();
  const contextTargets = new Map<string, number>();

  for (const [index, operation] of intervention.operations.entries()) {
    if (operation.type === "retrieval_parameter") {
      addDuplicateOperationIssue(context, retrievalParameters, operation.parameter, index, "retrieval parameter");
      if (operation.parameter === "limit" && (!Number.isInteger(operation.value) || operation.value < 1 || operation.value > 10_000)) {
        context.addIssue({ code: "custom", message: "Retrieval limit must be an integer from 1 to 10000.", path: ["operations", index, "value"] });
      }
      if (operation.parameter === "score_threshold" && (operation.value < 0 || operation.value > 1)) {
        context.addIssue({ code: "custom", message: "Score threshold must be between 0 and 1.", path: ["operations", index, "value"] });
      }
      if (operation.parameter === "recency_weight" && (operation.value < 0 || operation.value > 10)) {
        context.addIssue({ code: "custom", message: "Recency weight must be between 0 and 10.", path: ["operations", index, "value"] });
      }
      continue;
    }
    if (operation.type === "policy_rule") {
      addDuplicateOperationIssue(context, policyRules, operation.rule, index, "policy rule");
      continue;
    }
    if (operation.type === "context_override") {
      addDuplicateOperationIssue(context, contextTargets, operation.memoryId, index, "context target");
      continue;
    }

    const targetId = operation.type === "memory_upsert" ? operation.memory.id : operation.memoryId;
    addDuplicateOperationIssue(context, stateTargets, targetId, index, "memory state target");
    if (operation.type === "memory_upsert") {
      addDuplicateOperationIssue(context, introducedIds, operation.memory.id, index, "introduced memory ID");
    }
    if (operation.type === "memory_replace") {
      addDuplicateOperationIssue(context, introducedIds, operation.replacement.id, index, "introduced memory ID");
    }
    if (operation.type === "memory_status") {
      if (operation.supersededByMemoryId && operation.status !== "superseded") {
        context.addIssue({
          code: "custom",
          message: "supersededByMemoryId is valid only when status is superseded.",
          path: ["operations", index, "supersededByMemoryId"]
        });
      }
      if (operation.supersededByMemoryId === operation.memoryId) {
        context.addIssue({
          code: "custom",
          message: "A memory cannot be superseded by itself.",
          path: ["operations", index, "supersededByMemoryId"]
        });
      }
    }
  }
});

export const memoryAnswerAssertionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("exact"),
    value: z.string(),
    caseSensitive: z.boolean().optional()
  }).strict(),
  z.object({
    type: z.literal("contains_all"),
    values: z.array(z.string().min(1)).min(1).max(100),
    forbidden: z.array(z.string().min(1)).max(100).optional(),
    caseSensitive: z.boolean().optional()
  }).strict()
]);

export const memoryDecisionDiffSchema = z.object({
  format: z.literal("engram.memory-decision-diff"),
  version: z.literal(1),
  baselineRunId: z.string().min(1),
  treatmentRunId: z.string().min(1),
  status: z.enum(["found", "none", "indeterminate"]),
  stages: z.array(z.object({
    stage: memoryDecisionStageKindSchema,
    comparable: z.boolean(),
    changed: z.boolean(),
    summary: z.string().min(1),
    baselineMemoryIds: z.array(z.string().min(1)),
    treatmentMemoryIds: z.array(z.string().min(1))
  }).strict()).length(5),
  earliestDivergence: memoryDecisionStageKindSchema.optional(),
  firstIncomparableStage: memoryDecisionStageKindSchema.optional(),
  answerChanged: z.boolean()
}).strict().superRefine((diff, context) => {
  const stageNames = diff.stages.map((stage) => stage.stage);
  addUniqueArrayIssue(context, stageNames, ["stages"], "Decision diff stages");
  for (const [index, stage] of diff.stages.entries()) {
    addUniqueArrayIssue(context, stage.baselineMemoryIds, ["stages", index, "baselineMemoryIds"], "Baseline memory IDs");
    addUniqueArrayIssue(context, stage.treatmentMemoryIds, ["stages", index, "treatmentMemoryIds"], "Treatment memory IDs");
    if (!stage.comparable && stage.changed) {
      context.addIssue({ code: "custom", message: "An incomparable stage cannot be marked changed.", path: ["stages", index, "changed"] });
    }
  }
  if (diff.status === "found" && !diff.earliestDivergence) {
    context.addIssue({ code: "custom", message: "A found diff requires an earliest divergence.", path: ["earliestDivergence"] });
  }
  if (diff.status !== "found" && diff.earliestDivergence) {
    context.addIssue({ code: "custom", message: "Only a found diff can name an earliest divergence.", path: ["earliestDivergence"] });
  }
  if (diff.status === "indeterminate" && !diff.firstIncomparableStage) {
    context.addIssue({ code: "custom", message: "An indeterminate diff requires its first incomparable stage.", path: ["firstIncomparableStage"] });
  }
  if (diff.status !== "indeterminate" && diff.firstIncomparableStage) {
    context.addIssue({ code: "custom", message: "Only an indeterminate diff can name an incomparable stage.", path: ["firstIncomparableStage"] });
  }
});

export const memoryPolicyReplayResultSchema = z.object({
  format: z.literal("engram.memory-policy-replay"),
  version: z.literal(1),
  level: z.enum(["context", "policy", "provider", "agent", "robustness"]),
  executor: z.object({
    id: z.string().min(1),
    version: z.string().min(1),
    deterministic: z.boolean()
  }).strict(),
  capabilities: z.object({
    levels: z.array(z.enum(["context", "policy", "provider", "agent", "robustness"])).min(1),
    deterministic: z.boolean(),
    reusesRecordedCandidates: z.boolean(),
    rerunsCandidateGeneration: z.boolean(),
    rerunsEligibility: z.boolean(),
    rerunsRanking: z.boolean(),
    rerunsSelection: z.boolean(),
    rerunsContextAssembly: z.boolean(),
    rerunsGeneration: z.boolean(),
    supportsPolicyInterventions: z.boolean(),
    supportsStateInterventions: z.boolean(),
    supportsRepeatedRuns: z.boolean()
  }).strict(),
  intervention: memoryInterventionV2Schema,
  source: memoryDecisionRunV3Schema,
  baseline: memoryDecisionRunV3Schema,
  treatment: memoryDecisionRunV3Schema,
  diff: memoryDecisionDiffSchema,
  reproduction: z.object({
    reproduced: z.boolean(),
    observedAnswer: z.string().max(200_000),
    replayedAnswer: z.string().max(200_000)
  }).strict(),
  verification: z.object({
    passed: z.boolean(),
    assertion: memoryAnswerAssertionSchema.optional(),
    failures: z.array(z.string().min(1)),
    expectedAnswerFragments: z.array(z.string().min(1)),
    matchedAnswerFragments: z.array(z.string().min(1))
  }).strict(),
  caveat: z.string().min(1)
}).strict().superRefine((result, context) => {
  addUniqueArrayIssue(context, result.capabilities.levels, ["capabilities", "levels"], "Replay capability levels");
  if (!result.capabilities.levels.includes(result.level)) {
    context.addIssue({ code: "custom", message: "Replay capability levels must include the result level.", path: ["capabilities", "levels"] });
  }
  if (result.capabilities.reusesRecordedCandidates && result.capabilities.rerunsCandidateGeneration) {
    context.addIssue({ code: "custom", message: "A replay cannot both reuse recorded candidates and rerun candidate generation.", path: ["capabilities"] });
  }
  if (result.intervention.targetRunId !== result.source.id) {
    context.addIssue({ code: "custom", message: "The intervention must target the source run.", path: ["intervention", "targetRunId"] });
  }
  for (const field of ["traceId", "turnId", "sessionId", "projectId", "userId"] as const) {
    if (result.baseline[field] !== result.source[field] || result.treatment[field] !== result.source[field]) {
      context.addIssue({ code: "custom", message: `Replay ${field} must match the source run.`, path: [field] });
    }
  }
  if (result.diff.baselineRunId !== result.baseline.id || result.diff.treatmentRunId !== result.treatment.id) {
    context.addIssue({ code: "custom", message: "The decision diff must reference the replay baseline and treatment runs.", path: ["diff"] });
  }
  if (result.reproduction.observedAnswer !== result.source.answer.content) {
    context.addIssue({ code: "custom", message: "The reproduction observed answer must match the source answer.", path: ["reproduction", "observedAnswer"] });
  }
  if (result.reproduction.replayedAnswer !== result.baseline.answer.content) {
    context.addIssue({ code: "custom", message: "The reproduction replayed answer must match the replay baseline.", path: ["reproduction", "replayedAnswer"] });
  }
  if (result.baseline.answer.provider.id !== result.executor.id) {
    context.addIssue({ code: "custom", message: "The replay baseline provider must match the declared executor.", path: ["baseline", "answer", "provider", "id"] });
  }
  if (result.baseline.answer.provider.model !== undefined && result.baseline.answer.provider.model !== result.executor.version) {
    context.addIssue({ code: "custom", message: "The replay baseline model must match the declared executor version.", path: ["baseline", "answer", "provider", "model"] });
  }
  if (result.reproduction.reproduced && result.source.answer.content !== result.baseline.answer.content) {
    context.addIssue({ code: "custom", message: "A reproduced baseline must match the source answer.", path: ["reproduction", "reproduced"] });
  }
  if (result.verification.passed && (!result.reproduction.reproduced || result.verification.failures.length > 0)) {
    context.addIssue({ code: "custom", message: "Verification cannot pass without baseline reproduction and zero failures.", path: ["verification", "passed"] });
  }
  const expected = new Set(result.verification.expectedAnswerFragments);
  for (const fragment of result.verification.matchedAnswerFragments) {
    if (!expected.has(fragment)) {
      context.addIssue({ code: "custom", message: "Matched answer fragments must be expected fragments.", path: ["verification", "matchedAnswerFragments"] });
    }
  }
});

function addUniqueArrayIssue(
  context: z.RefinementCtx,
  values: readonly string[],
  path: PropertyKey[],
  label: string
) {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", message: `${label} must be unique.`, path });
  }
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function validateEvidenceCoherence(
  run: z.infer<typeof memoryDecisionRunV3Schema>,
  context: z.RefinementCtx
) {
  const unavailable = (stage: keyof typeof run.evidenceCoverage) => run.evidenceCoverage[stage] === "unavailable";

  if (unavailable("memory_state") && (run.memoryState.before.length > 0 || run.memoryState.after.length > 0)) {
    context.addIssue({ code: "custom", message: "Unavailable memory-state evidence cannot contain memory snapshots.", path: ["memoryState"] });
  }
  if (!unavailable("memory_state") && [...run.memoryState.before, ...run.memoryState.after].some((memory) => memory.evidence === "unavailable")) {
    context.addIssue({ code: "custom", message: "Available memory-state snapshots cannot contain unavailable memories.", path: ["memoryState"] });
  }
  if (unavailable("retrieval") && (run.retrieval.candidates.length > 0 || run.retrieval.policy.evidence !== "unavailable")) {
    context.addIssue({ code: "custom", message: "Unavailable retrieval evidence cannot contain candidates or an available policy.", path: ["retrieval"] });
  }
  if (!unavailable("retrieval") && run.retrieval.policy.evidence === "unavailable") {
    context.addIssue({ code: "custom", message: "Available retrieval evidence requires an available policy snapshot.", path: ["retrieval", "policy", "evidence"] });
  }
  if (!unavailable("retrieval") && run.retrieval.candidates.some((candidate) => candidate.evidence === "unavailable")) {
    context.addIssue({ code: "custom", message: "Available retrieval candidates cannot carry unavailable evidence.", path: ["retrieval", "candidates"] });
  }
  if (unavailable("selection") && (run.retrieval.selectedIds.length > 0 || run.retrieval.candidates.some((candidate) => candidate.selected))) {
    context.addIssue({ code: "custom", message: "Unavailable selection evidence cannot identify selected memories.", path: ["retrieval", "selectedIds"] });
  }
  const hasContextData = run.context.loadedIds.length > 0
    || run.context.orderedIds.length > 0
    || run.context.truncatedIds.length > 0
    || run.context.forcedIds.length > 0;
  if (unavailable("active_context") && (hasContextData || run.context.evidence !== "unavailable")) {
    context.addIssue({ code: "custom", message: "Unavailable active-context evidence cannot contain context decisions.", path: ["context"] });
  }
  if (!unavailable("active_context") && run.context.evidence === "unavailable") {
    context.addIssue({ code: "custom", message: "Available active-context evidence requires an available context snapshot.", path: ["context", "evidence"] });
  }
  if (unavailable("answer") !== (run.answer.evidence === "unavailable")) {
    context.addIssue({ code: "custom", message: "Answer evidence and answer coverage must agree on availability.", path: ["answer", "evidence"] });
  }
}

function addDuplicateOperationIssue(
  context: z.RefinementCtx,
  seen: Map<string, number>,
  key: string,
  index: number,
  label: string
) {
  if (seen.has(key)) {
    context.addIssue({ code: "custom", message: `Conflicting ${label} operations target ${key}.`, path: ["operations", index] });
    return;
  }
  seen.set(key, index);
}

export function parseMemoryDecisionRunV3(input: unknown): MemoryDecisionRunV3 {
  return memoryDecisionRunV3Schema.parse(input) as MemoryDecisionRunV3;
}

export function parseMemoryInterventionV2(input: unknown): MemoryInterventionV2 {
  return memoryInterventionV2Schema.parse(input) as MemoryInterventionV2;
}

export function parseMemoryDecisionDiff(input: unknown): MemoryDecisionDiff {
  return memoryDecisionDiffSchema.parse(input) as MemoryDecisionDiff;
}

export function parseMemoryPolicyReplayResult(input: unknown): MemoryPolicyReplayResult {
  return memoryPolicyReplayResultSchema.parse(input) as MemoryPolicyReplayResult;
}
