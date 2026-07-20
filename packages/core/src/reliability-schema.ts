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
}).strict();

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
  const candidateIds = new Set(run.retrieval.candidates.map((candidate) => candidate.memoryId));
  const selectedIds = new Set(run.retrieval.selectedIds);

  if (beforeIds.size !== run.memoryState.before.length) {
    context.addIssue({ code: "custom", message: "Memory-state IDs must be unique.", path: ["memoryState", "before"] });
  }
  if (candidateIds.size !== run.retrieval.candidates.length) {
    context.addIssue({ code: "custom", message: "Retrieval candidate IDs must be unique.", path: ["retrieval", "candidates"] });
  }
  for (const id of selectedIds) {
    if (!candidateIds.has(id)) {
      context.addIssue({ code: "custom", message: `Selected memory ${id} is not a retrieval candidate.`, path: ["retrieval", "selectedIds"] });
    }
  }
  const forcedIds = new Set(run.context.forcedIds);
  for (const id of run.context.loadedIds) {
    if (!selectedIds.has(id) && !forcedIds.has(id)) {
      context.addIssue({ code: "custom", message: `Loaded memory ${id} was not selected.`, path: ["context", "loadedIds"] });
    }
  }
  for (const id of forcedIds) {
    if (!run.context.loadedIds.includes(id)) {
      context.addIssue({ code: "custom", message: `Forced memory ${id} is not loaded.`, path: ["context", "forcedIds"] });
    }
  }
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
}).strict();

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
}).strict();

export const memoryPolicyReplayResultSchema = z.object({
  format: z.literal("engram.memory-policy-replay"),
  version: z.literal(1),
  level: z.literal("policy"),
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
}).strict();

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
