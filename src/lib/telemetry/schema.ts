import { z } from "zod";
import type { MemoryTelemetryEvent } from "@/lib/telemetry/types";

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema)
  ])
);

export const memoryTierSchema = z.enum(["working", "episodic", "semantic", "procedural", "unknown"]);
export const memoryScopeSchema = z.enum(["user", "agent", "run", "shared", "unknown"]);

const memoryRefSchema = z.object({
  id: z.string().min(1),
  content: jsonValueSchema.optional(),
  tier: memoryTierSchema,
  scope: memoryScopeSchema,
  provider: z.string().min(1).optional(),
  storeId: z.string().min(1).optional(),
  metadata: z.record(z.string(), jsonValueSchema).optional()
});

const retrievalCandidateSchema = z.object({
  memoryId: z.string().min(1),
  rank: z.number().int().positive().optional(),
  score: z.number().finite().optional(),
  eligible: z.boolean().optional(),
  selected: z.boolean().optional(),
  filterReason: z.string().min(1).optional()
});

export const memoryTelemetryEventSchema = z.object({
  schemaVersion: z.literal(2),
  eventId: z.string().min(1),
  traceId: z.string().min(1),
  spanId: z.string().min(1).optional(),
  parentSpanId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  timestamp: z.string().datetime(),
  sequence: z.number().int().nonnegative(),
  operation: z.enum(["store", "retrieve", "load", "update", "supersede", "delete", "summarize", "expire"]),
  actor: z.object({
    agentId: z.string().min(1).optional(),
    agentName: z.string().min(1).optional()
  }).refine((actor) => Boolean(actor.agentId || actor.agentName), {
    message: "An actor requires an agent id or name."
  }).optional(),
  memory: memoryRefSchema.optional(),
  memoryIds: z.array(z.string().min(1)).optional(),
  retrieval: z.object({
    query: z.string().optional(),
    limit: z.number().int().positive().optional(),
    candidates: z.array(retrievalCandidateSchema).optional(),
    selectedIds: z.array(z.string().min(1)).optional(),
    loadedIds: z.array(z.string().min(1)).optional()
  }).optional(),
  mutation: z.object({
    sourceMemoryIds: z.array(z.string().min(1)).optional(),
    targetMemoryIds: z.array(z.string().min(1)).optional(),
    reason: z.string().min(1).optional()
  }).optional(),
  evidence: z.object({
    level: z.enum(["observed", "mapped"]),
    adapter: z.string().min(1),
    sourcePath: z.string().min(1).optional(),
    note: z.string().min(1).optional()
  })
}).superRefine((event, context) => {
  if (["store", "update", "summarize"].includes(event.operation) && !event.memory) {
    context.addIssue({
      code: "custom",
      message: `${event.operation} requires a memory payload.`,
      path: ["memory"]
    });
  }

  if (event.operation === "retrieve" && !event.retrieval) {
    context.addIssue({
      code: "custom",
      message: "retrieve requires retrieval evidence.",
      path: ["retrieval"]
    });
  }

  if (["load", "supersede", "delete", "expire"].includes(event.operation) && !(event.memoryIds?.length)) {
    context.addIssue({
      code: "custom",
      message: `${event.operation} requires at least one memory id.`,
      path: ["memoryIds"]
    });
  }
});

export function parseMemoryTelemetryEvent(input: unknown): MemoryTelemetryEvent {
  return memoryTelemetryEventSchema.parse(input) as MemoryTelemetryEvent;
}
