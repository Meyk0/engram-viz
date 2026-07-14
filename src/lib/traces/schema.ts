import { z } from "zod";
import { engramEventSchema } from "@/lib/events/schema";
import type { NormalizedTrace } from "@/lib/traces/types";

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

const traceMemoryMappingSchema = z.discriminatedUnion("provenance", [
  z.object({
    provenance: z.enum(["observed", "mapped"]),
    event: engramEventSchema,
    sourcePath: z.string().min(1),
    note: z.string().min(1)
  }),
  z.object({
    provenance: z.literal("inferred"),
    event: z.null(),
    sourcePath: z.string().min(1),
    note: z.string().min(1)
  })
]);

const traceTopologyProvenanceSchema = z.enum(["observed", "mapped", "unknown"]);
const traceAgentRefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  provenance: z.enum(["observed", "mapped"]),
  sourcePath: z.string().min(1),
  note: z.string().min(1)
});
const traceTopologyContextSchema = z.object({
  agent: traceAgentRefSchema.optional(),
  memory: z.object({
    scope: z.enum(["user", "agent", "run", "shared", "unknown"]),
    storeId: z.string().min(1).optional(),
    provenance: traceTopologyProvenanceSchema,
    sourcePath: z.string().min(1),
    note: z.string().min(1)
  }).optional(),
  handoff: z.object({
    from: traceAgentRefSchema.optional(),
    to: traceAgentRefSchema.optional(),
    provenance: traceTopologyProvenanceSchema,
    sourcePath: z.string().min(1),
    note: z.string().min(1)
  }).optional()
});

export const normalizedTraceSchema = z.object({
  schemaVersion: z.literal(1),
  trace: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    source: z.object({
      provider: z.string().min(1),
      format: z.string().min(1),
      sdkVersion: z.string().min(1).optional()
    }),
    groupId: z.string().min(1).optional(),
    startedAt: z.string().min(1).optional(),
    endedAt: z.string().min(1).optional(),
    metadata: z.record(z.string(), jsonValueSchema).optional()
  }),
  steps: z.array(
    z.object({
      id: z.string().min(1),
      parentId: z.string().min(1).optional(),
      index: z.number().int().nonnegative(),
      kind: z.enum(["agent", "model", "tool", "handoff", "guardrail", "message", "custom", "error"]),
      name: z.string().min(1),
      status: z.enum(["in_progress", "completed", "error", "unknown"]),
      startedAt: z.string().min(1).optional(),
      endedAt: z.string().min(1).optional(),
      input: jsonValueSchema.optional(),
      output: jsonValueSchema.optional(),
      memoryMappings: z.array(traceMemoryMappingSchema),
      topology: traceTopologyContextSchema.optional()
    })
  ).max(1000)
});

export const liveTraceSnapshotSchema = z.object({
  channelId: z.string().min(8),
  receivedAt: z.string().datetime(),
  itemCount: z.number().int().nonnegative(),
  trace: normalizedTraceSchema,
  warnings: z.array(z.string())
});

export function parseNormalizedTrace(input: unknown): NormalizedTrace {
  return normalizedTraceSchema.parse(input) as NormalizedTrace;
}
