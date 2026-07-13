import { z } from "zod";

export const MAX_SEMANTIC_MEMORIES = 128;
export const MAX_SEMANTIC_REQUEST_BYTES = 256_000;
export const MAX_SEMANTIC_TEXT_LENGTH = 4_000;
export const SEMANTIC_LAYOUT_COORDINATE_BOUND = 1.25;

const boundedString = z.string().min(1).max(160);
const coordinateSchema = z.number().finite().min(-SEMANTIC_LAYOUT_COORDINATE_BOUND).max(SEMANTIC_LAYOUT_COORDINATE_BOUND);

export const semanticMemoryDescriptorSchema = z
  .object({
    id: boundedString,
    text: z.string().min(1).max(MAX_SEMANTIC_TEXT_LENGTH),
    topic: boundedString.optional(),
    kind: boundedString.optional(),
    entities: z.array(boundedString).max(32).optional(),
    region: z.enum(["prefrontal", "hippocampus", "temporal"]),
    status: z.enum(["active", "superseded"]).optional()
  })
  .strict();

export const semanticLayoutNodeSchema = z
  .object({
    memoryId: boundedString,
    position: z.tuple([coordinateSchema, coordinateSchema, coordinateSchema]),
    clusterId: boundedString
  })
  .strict();

export const semanticLayoutEdgeSchema = z
  .object({
    sourceId: boundedString,
    targetId: boundedString,
    similarity: z.number().finite().min(0).max(1)
  })
  .strict();

export const semanticLayoutClusterSchema = z
  .object({
    id: boundedString,
    memberIds: z.array(boundedString).min(1).max(MAX_SEMANTIC_MEMORIES),
    label: boundedString.optional()
  })
  .strict();

export const semanticLayoutRequestSchema = z
  .object({
    memories: z.array(semanticMemoryDescriptorSchema).max(MAX_SEMANTIC_MEMORIES),
    previousNodes: z.array(semanticLayoutNodeSchema).max(MAX_SEMANTIC_MEMORIES).optional()
  })
  .strict()
  .superRefine((request, context) => {
    addDuplicateIssues(request.memories.map((memory) => memory.id), "memories", context);
    addDuplicateIssues(request.previousNodes?.map((node) => node.memoryId) ?? [], "previousNodes", context);
  });

export const semanticLayoutSnapshotSchema = z
  .object({
    version: z.literal(1),
    signature: z.string().min(1).max(160),
    provider: z.enum(["openai", "lexical-fallback"]),
    model: boundedString.optional(),
    algorithm: z.literal("similarity-force-v1"),
    nodes: z.array(semanticLayoutNodeSchema).max(MAX_SEMANTIC_MEMORIES),
    edges: z.array(semanticLayoutEdgeSchema).max(MAX_SEMANTIC_MEMORIES * 3),
    clusters: z.array(semanticLayoutClusterSchema).max(MAX_SEMANTIC_MEMORIES),
    generatedAt: z.string().datetime()
  })
  .strict();

export const semanticLayoutErrorSchema = z.object({ error: z.string().min(1).max(500) }).strict();

function addDuplicateIssues(
  ids: string[],
  path: "memories" | "previousNodes",
  context: z.RefinementCtx
) {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate memory id: ${id}`,
        path: [path, index]
      });
    }
    seen.add(id);
  });
}
