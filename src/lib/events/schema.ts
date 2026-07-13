import { z } from "zod";

export const brainRegionSchema = z.enum(["prefrontal", "hippocampus", "temporal"]);

export const engramMemorySchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  importance: z.number().min(0).max(1),
  topic: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  entities: z.array(z.string().min(1)).optional(),
  confidence: z.number().min(0).max(1).optional(),
  sourceText: z.string().min(1).optional(),
  cluster: z.string().min(1).optional(),
  status: z.enum(["active", "superseded"]).optional(),
  retiredReason: z.enum(["corrected", "consolidated", "dream_merge"]).optional(),
  supersedes: z.array(z.string().min(1)).optional(),
  sourceMemoryIds: z.array(z.string().min(1)).optional(),
  region: brainRegionSchema,
  created_at: z.string().datetime(),
  last_accessed: z.string().datetime().optional(),
  access_count: z.number().int().min(0),
  embedding: z.array(z.number()).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  z: z.number().optional()
});

export const memoryDecisionTraceSchema = z.object({
  stage: z.enum(["memory", "consolidation"]),
  operation: z.enum(["store", "ignore", "consolidate", "skip"]),
  provider: z.enum(["deterministic", "llm", "fallback"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  ids: z.array(z.string()).optional(),
  relatedMemoryIds: z.array(z.string()).optional()
});

export const memoryRetrievalTraceSchema = z.object({
  provider: z.enum(["lexical", "semantic", "fallback"]),
  reason: z.string().min(1).optional(),
  candidateCount: z.number().int().min(0).optional(),
  eligibleCount: z.number().int().min(0).optional(),
  selectedCount: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).optional(),
  matches: z.array(z.object({
    id: z.string().min(1),
    rank: z.number().int().min(1),
    score: z.number(),
    similarity: z.number().min(-1).max(1).optional(),
    basis: z.enum(["semantic", "lexical", "guardrail"]),
    eligible: z.boolean().optional(),
    selected: z.boolean(),
    filterReason: z.string().min(1).optional(),
    components: z.object({
      semantic: z.number().optional(),
      lexical: z.number().optional(),
      importance: z.number().optional(),
      access: z.number().optional(),
      guardrail: z.number().optional()
    }).optional()
  })).optional()
});

export const dreamOperationSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["merge", "supersede", "insight"]),
  sourceIds: z.array(z.string().min(1)),
  result: engramMemorySchema.optional(),
  supersedeIds: z.array(z.string().min(1)).optional(),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1)
});

export const dreamProposalSchema = z.object({
  id: z.string().min(1),
  provider: z.enum(["deterministic", "llm", "fallback"]),
  status: z.enum(["proposed", "skipped"]),
  reason: z.string().min(1),
  operations: z.array(dreamOperationSchema),
  created_at: z.string().datetime()
});

export const engramEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("plan"), decision: memoryDecisionTraceSchema }),
  z.object({ type: z.literal("store"), memory: engramMemorySchema, decision: memoryDecisionTraceSchema.optional() }),
  z.object({
    type: z.literal("retrieve"),
    query: z.string(),
    ids: z.array(z.string()),
    accessed: z.array(engramMemorySchema).optional(),
    retrieval: memoryRetrievalTraceSchema.optional()
  }),
  z.object({ type: z.literal("fire"), ids: z.array(z.string()), region: brainRegionSchema }),
  z.object({
    type: z.literal("consolidate"),
    removed: z.array(z.string()),
    added: engramMemorySchema,
    decision: memoryDecisionTraceSchema.optional()
  }),
  z.object({ type: z.literal("load"), ids: z.array(z.string()) }),
  z.object({ type: z.literal("decay"), ids: z.array(z.string()) }),
  z.object({ type: z.literal("init"), memories: z.array(engramMemorySchema) }),
  z.object({ type: z.literal("dream_start"), proposal: dreamProposalSchema }),
  z.object({ type: z.literal("dream_review"), proposalId: z.string().min(1), ids: z.array(z.string().min(1)) }),
  z.object({ type: z.literal("dream_merge"), proposalId: z.string().min(1), operation: dreamOperationSchema }),
  z.object({ type: z.literal("dream_supersede"), proposalId: z.string().min(1), operation: dreamOperationSchema }),
  z.object({ type: z.literal("dream_insight"), proposalId: z.string().min(1), operation: dreamOperationSchema }),
  z.object({ type: z.literal("dream_complete"), proposal: dreamProposalSchema }),
  z.object({ type: z.literal("dream_apply"), proposal: dreamProposalSchema }),
  z.object({ type: z.literal("dream_dismiss"), proposal: dreamProposalSchema })
]);

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string()
});

export const turnRecordSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  sessionId: z.string().min(1),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  userMessage: z.string(),
  history: z.array(chatMessageSchema),
  retrievedMemories: z.array(engramMemorySchema),
  retrieval: memoryRetrievalTraceSchema.optional(),
  events: z.array(engramEventSchema),
  originalAnswer: z.string(),
  provider: z.object({
    id: z.enum(["demo", "openai"]),
    model: z.string().min(1).optional()
  })
});

export const causalAblationRequestSchema = z.object({
  record: turnRecordSchema,
  excludedMemoryIds: z.array(z.string().min(1)).min(1).max(10)
});

export const causalAblationResultSchema = z.object({
  version: z.literal(2),
  recordId: z.string().min(1),
  excludedMemoryIds: z.array(z.string().min(1)),
  originalAnswer: z.string(),
  baselineAnswer: z.string(),
  counterfactualAnswer: z.string(),
  changed: z.boolean(),
  comparison: z.object({
    outcome: z.enum(["changed", "stable"]),
    normalizedTextDistance: z.number().min(0).max(1),
    answerLengthDelta: z.number().int(),
    baselineRuns: z.literal(1),
    counterfactualRuns: z.literal(1)
  }),
  caveat: z.string().min(1),
  provider: z.object({
    id: z.enum(["demo", "openai"]),
    model: z.string().min(1).optional()
  })
});

export const streamChunkSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), delta: z.string() }),
  z.object({ kind: z.literal("event"), event: engramEventSchema }),
  z.object({ kind: z.literal("turn_record"), record: turnRecordSchema }),
  z.object({ kind: z.literal("done") }),
  z.object({ kind: z.literal("error"), message: z.string() })
]);

export function parseEngramEvent(input: unknown) {
  return engramEventSchema.parse(input);
}

export function parseStreamChunk(input: unknown) {
  return streamChunkSchema.parse(input);
}
