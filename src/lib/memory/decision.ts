import { z } from "zod";
import { evaluateMemoryCandidate } from "@/lib/memory/rules";

const memoryDecisionBaseSchema = {
  provider: z.enum(["deterministic", "llm", "fallback"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  relatedMemoryIds: z.array(z.string().min(1)).default([])
};

export const memoryDecisionSchema = z.discriminatedUnion("operation", [
  z
    .object({
      ...memoryDecisionBaseSchema,
      operation: z.literal("store"),
      memoryText: z.string().min(1),
      topic: z.string().min(1).optional(),
      importance: z.number().min(0).max(1)
    })
    .strict(),
  z
    .object({
      ...memoryDecisionBaseSchema,
      operation: z.literal("ignore")
    })
    .strict()
]);

export type MemoryDecision = z.infer<typeof memoryDecisionSchema>;

export type MemoryPlanningInput = {
  message: string;
  relatedMemoryIds?: string[];
};

export interface MemoryDecisionPlanner {
  readonly provider: MemoryDecision["provider"];
  decide(input: MemoryPlanningInput): MemoryDecision;
}

export function parseMemoryDecision(input: unknown): MemoryDecision {
  if (typeof input !== "string") {
    return memoryDecisionSchema.parse(input);
  }

  try {
    return memoryDecisionSchema.parse(JSON.parse(input));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid memory decision JSON: ${error.message}`);
    }
    throw error;
  }
}

export class DeterministicMemoryDecisionPlanner implements MemoryDecisionPlanner {
  readonly provider = "deterministic" as const;

  decide(input: MemoryPlanningInput): MemoryDecision {
    const candidate = evaluateMemoryCandidate(input.message);
    const relatedMemoryIds = input.relatedMemoryIds ?? [];

    if (!candidate.shouldStore) {
      return memoryDecisionSchema.parse({
        provider: this.provider,
        operation: "ignore",
        confidence: 1,
        reason: candidate.reason,
        relatedMemoryIds
      });
    }

    return memoryDecisionSchema.parse({
      provider: this.provider,
      operation: "store",
      confidence: candidate.importance,
      reason: candidate.reason,
      memoryText: candidate.text,
      topic: candidate.topic,
      importance: candidate.importance,
      relatedMemoryIds
    });
  }
}

export const deterministicMemoryDecisionPlanner = new DeterministicMemoryDecisionPlanner();

export function planMemoryDecision(input: MemoryPlanningInput): MemoryDecision {
  return deterministicMemoryDecisionPlanner.decide(input);
}
