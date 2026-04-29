import { z } from "zod";

export const brainRegionSchema = z.enum(["prefrontal", "hippocampus", "temporal"]);

export const engramMemorySchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  importance: z.number().min(0).max(1),
  topic: z.string().min(1).optional(),
  region: brainRegionSchema,
  created_at: z.string().datetime(),
  last_accessed: z.string().datetime().optional(),
  access_count: z.number().int().min(0),
  embedding: z.array(z.number()).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  z: z.number().optional()
});

export const engramEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("store"), memory: engramMemorySchema }),
  z.object({ type: z.literal("retrieve"), query: z.string(), ids: z.array(z.string()) }),
  z.object({ type: z.literal("fire"), ids: z.array(z.string()), region: brainRegionSchema }),
  z.object({
    type: z.literal("consolidate"),
    removed: z.array(z.string()),
    added: engramMemorySchema
  }),
  z.object({ type: z.literal("load"), ids: z.array(z.string()) }),
  z.object({ type: z.literal("decay"), ids: z.array(z.string()) }),
  z.object({ type: z.literal("init"), memories: z.array(engramMemorySchema) })
]);

export const streamChunkSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), delta: z.string() }),
  z.object({ kind: z.literal("event"), event: engramEventSchema }),
  z.object({ kind: z.literal("done") }),
  z.object({ kind: z.literal("error"), message: z.string() })
]);

export function parseEngramEvent(input: unknown) {
  return engramEventSchema.parse(input);
}

export function parseStreamChunk(input: unknown) {
  return streamChunkSchema.parse(input);
}
