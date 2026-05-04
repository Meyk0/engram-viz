import type { EngramMemory } from "@/types";
import { z } from "zod";

export type ConsolidationCandidate = {
  ids: string[];
  consolidatedText: string;
  topic?: string;
  entities?: string[];
};

const consolidationDecisionBaseSchema = {
  provider: z.enum(["deterministic", "llm", "fallback"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1)
};

export const consolidationDecisionSchema = z.discriminatedUnion("operation", [
  z
    .object({
      ...consolidationDecisionBaseSchema,
      operation: z.literal("consolidate"),
      ids: z.array(z.string().min(1)).min(2),
      consolidatedText: z.string().min(1),
      topic: z.string().min(1).optional(),
      entities: z.array(z.string().min(1)).optional()
    })
    .strict(),
  z
    .object({
      ...consolidationDecisionBaseSchema,
      operation: z.literal("skip")
    })
    .strict()
]);

export type ConsolidationDecision = z.infer<typeof consolidationDecisionSchema>;

export type ConsolidationPlanningInput = {
  memories: EngramMemory[];
  recentMemoryIds?: string[];
};

export interface MemoryConsolidationPlanner {
  readonly provider: ConsolidationDecision["provider"];
  decide(input: ConsolidationPlanningInput): ConsolidationDecision | Promise<ConsolidationDecision>;
}

const MIN_TOPIC_MEMORIES = 2;

export function findConsolidationCandidate(memories: EngramMemory[]): ConsolidationCandidate | null {
  const byTopic = new Map<string, EngramMemory[]>();

  memories.forEach((memory) => {
    if (memory.region !== "hippocampus" || memory.status === "superseded" || !memory.topic) return;
    byTopic.set(memory.topic, [...(byTopic.get(memory.topic) ?? []), memory]);
  });

  const group = [...byTopic.values()]
    .filter((memoriesForTopic) => {
      const topic = memoriesForTopic[0]?.topic ?? "memory";
      return memoriesForTopic.length >= minimumMemoriesForTopic(topic);
    })
    .sort((a, b) => b.length - a.length || newestTime(b) - newestTime(a))[0];

  if (!group) return null;

  const selected = group
    .slice()
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .slice(0, 3);
  const topic = selected[0]?.topic ?? "memory";

  return {
    ids: selected.map((memory) => memory.id),
    consolidatedText: summarizeTopic(topic, selected),
    topic,
    entities: uniqueEntities(selected)
  };
}

export class DeterministicMemoryConsolidationPlanner implements MemoryConsolidationPlanner {
  readonly provider = "deterministic" as const;

  decide(input: ConsolidationPlanningInput): ConsolidationDecision {
    const candidate = findConsolidationCandidate(input.memories);

    if (!candidate) {
      return consolidationDecisionSchema.parse({
        provider: this.provider,
        operation: "skip",
        confidence: 0.82,
        reason: "No hippocampus topic group has enough related memories to consolidate."
      });
    }

    return consolidationDecisionSchema.parse({
      provider: this.provider,
      operation: "consolidate",
      confidence: 0.78,
      reason: "Found repeated same-topic hippocampus memories.",
      ids: candidate.ids,
      consolidatedText: candidate.consolidatedText,
      topic: candidate.topic,
      entities: candidate.entities
    });
  }
}

export const deterministicMemoryConsolidationPlanner = new DeterministicMemoryConsolidationPlanner();

function summarizeTopic(topic: string, memories: EngramMemory[]) {
  const facts = memories.map((memory) => stripExplicitMemoryCue(memory.text));
  const uniqueFacts = [...new Set(facts)];
  const topicLabel = topic === "location" ? "place and life-context" : topic;
  return `User has recurring ${topicLabel} memories: ${uniqueFacts.join("; ")}`;
}

function stripExplicitMemoryCue(text: string) {
  return text
    .replace(/^(remember that|note that|keep in mind that|don't forget that|do not forget that)\s+/i, "")
    .trim();
}

function newestTime(memories: EngramMemory[]) {
  return Math.max(...memories.map((memory) => Date.parse(memory.created_at) || 0));
}

function minimumMemoriesForTopic(topic: string) {
  return topic === "location" ? 3 : MIN_TOPIC_MEMORIES;
}

function uniqueEntities(memories: EngramMemory[]) {
  const entities = [...new Set(memories.flatMap((memory) => memory.entities ?? []))];
  return entities.length > 0 ? entities : undefined;
}

export function selectConsolidationPool(input: ConsolidationPlanningInput): EngramMemory[] {
  const activeHippocampus = input.memories.filter(
    (memory) => memory.region === "hippocampus" && memory.status !== "superseded"
  );
  const recentIds = new Set(input.recentMemoryIds ?? []);
  if (recentIds.size === 0) return activeHippocampus;

  const recentMemories = activeHippocampus.filter((memory) => recentIds.has(memory.id));
  if (recentMemories.length === 0) return activeHippocampus;

  return activeHippocampus.filter((memory) =>
    recentMemories.some((recent) => memoriesShareConsolidationSignal(memory, recent))
  );
}

function memoriesShareConsolidationSignal(left: EngramMemory, right: EngramMemory) {
  if (left.id === right.id) return true;
  if (left.cluster && right.cluster && left.cluster === right.cluster) return true;
  if (left.topic && right.topic && left.topic === right.topic) return true;

  const rightEntities = new Set((right.entities ?? []).map((entity) => entity.toLowerCase()));
  return (left.entities ?? []).some((entity) => rightEntities.has(entity.toLowerCase()));
}
