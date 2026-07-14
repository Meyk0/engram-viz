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
const MAX_CONSOLIDATION_MEMORIES = 3;
const GENERIC_CLUSTERS = new Set(["general", "memory", "other", "preference"]);
const GENERIC_ENTITIES = new Set(["memory", "preference", "relationship", "user"]);
const TEXT_STOP_WORDS = new Set([
  "a",
  "about",
  "am",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "for",
  "from",
  "has",
  "have",
  "i",
  "in",
  "is",
  "it",
  "like",
  "love",
  "memory",
  "my",
  "of",
  "on",
  "prefer",
  "recurring",
  "remember",
  "that",
  "the",
  "to",
  "user",
  "want",
  "with"
]);

type RelatedGroup = {
  memories: EngramMemory[];
  score: number;
};

export function findConsolidationCandidate(memories: EngramMemory[]): ConsolidationCandidate | null {
  const byTopic = new Map<string, EngramMemory[]>();

  memories.forEach((memory) => {
    if (memory.region !== "hippocampus" || memory.status === "superseded" || !memory.topic) return;
    byTopic.set(memory.topic, [...(byTopic.get(memory.topic) ?? []), memory]);
  });

  const group = [...byTopic.values()]
    .flatMap(findRelatedGroups)
    .sort(compareRelatedGroups)[0]?.memories;

  if (!group) return null;

  const selected = group.slice().sort(compareCreatedAt).slice(0, MAX_CONSOLIDATION_MEMORIES);
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
        reason: "No hippocampus memories have enough semantic evidence to consolidate."
      });
    }

    return consolidationDecisionSchema.parse({
      provider: this.provider,
      operation: "consolidate",
      confidence: 0.78,
      reason: "Found a semantically related hippocampus memory group.",
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
  if (left.topic !== right.topic) return false;

  const leftCluster = normalizeSignal(left.cluster);
  const rightCluster = normalizeSignal(right.cluster);
  const topic = normalizeSignal(left.topic);
  if (
    leftCluster &&
    leftCluster === rightCluster &&
    leftCluster !== topic &&
    !GENERIC_CLUSTERS.has(leftCluster)
  ) {
    return true;
  }

  const rightEntities = new Set(normalizedEntities(right.entities));
  if (normalizedEntities(left.entities).some((entity) => rightEntities.has(entity))) return true;

  return hasStrongTextSimilarity(left.text, right.text);
}

function findRelatedGroups(memories: EngramMemory[]): RelatedGroup[] {
  const sorted = memories.slice().sort(compareCreatedAt);
  const minimum = minimumMemoriesForTopic(sorted[0]?.topic ?? "memory");
  if (sorted.length < minimum) return [];

  const groups: RelatedGroup[] = [];
  for (let leftIndex = 0; leftIndex < sorted.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
      const left = sorted[leftIndex];
      const right = sorted[rightIndex];
      const pairScore = consolidationSignalStrength(left, right);
      if (pairScore === 0) continue;

      if (minimum <= 2) {
        groups.push({ memories: [left, right], score: pairScore });
      }

      for (let thirdIndex = rightIndex + 1; thirdIndex < sorted.length; thirdIndex += 1) {
        const third = sorted[thirdIndex];
        const leftStrength = consolidationSignalStrength(left, third);
        const rightStrength = consolidationSignalStrength(right, third);
        if (leftStrength === 0 || rightStrength === 0) continue;
        groups.push({
          memories: [left, right, third],
          score: (pairScore + leftStrength + rightStrength) / 3
        });
      }
    }
  }

  return groups;
}

function compareRelatedGroups(left: RelatedGroup, right: RelatedGroup) {
  return (
    right.memories.length - left.memories.length ||
    right.score - left.score ||
    newestTime(right.memories) - newestTime(left.memories) ||
    compareCreatedAt(left.memories[0], right.memories[0])
  );
}

function consolidationSignalStrength(left: EngramMemory, right: EngramMemory) {
  if (!memoriesShareConsolidationSignal(left, right)) return 0;

  const leftCluster = normalizeSignal(left.cluster);
  const rightCluster = normalizeSignal(right.cluster);
  const topic = normalizeSignal(left.topic);
  if (
    leftCluster &&
    leftCluster === rightCluster &&
    leftCluster !== topic &&
    !GENERIC_CLUSTERS.has(leftCluster)
  ) {
    return 1;
  }

  const rightEntities = new Set(normalizedEntities(right.entities));
  if (normalizedEntities(left.entities).some((entity) => rightEntities.has(entity))) return 0.9;

  return textSimilarity(left.text, right.text);
}

function hasStrongTextSimilarity(left: string, right: string) {
  const leftTokens = semanticTokens(left);
  const rightTokens = semanticTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;

  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  if (shared === 0) return false;

  const overlap = shared / Math.min(leftTokens.size, rightTokens.size);
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = shared / union;

  return (
    (shared >= 2 && overlap >= 0.35) ||
    (shared === 1 && Math.min(leftTokens.size, rightTokens.size) <= 3 && overlap >= 1 / 3 && jaccard >= 0.2)
  );
}

function textSimilarity(left: string, right: string) {
  const leftTokens = semanticTokens(left);
  const rightTokens = semanticTokens(right);
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  if (shared === 0) return 0;
  return shared / new Set([...leftTokens, ...rightTokens]).size;
}

function semanticTokens(text: string) {
  const normalized = stripExplicitMemoryCue(text)
    .toLowerCase()
    .replace(/san\s+fran(?:sisco|sciso)/g, "san francisco")
    .replace(/\b(?:user interfaces?|u\.i\.|ui)\b/g, "interface")
    .replace(/\bcolours?\b/g, "color");

  return new Set(
    (normalized.match(/[a-z0-9]+/g) ?? [])
      .map(normalizeToken)
      .filter((token) => token.length >= 3 && !TEXT_STOP_WORDS.has(token))
  );
}

function normalizeToken(token: string) {
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 4) return token.slice(0, -1);
  return token;
}

function normalizedEntities(entities: string[] | undefined) {
  return (entities ?? [])
    .map(normalizeEntity)
    .filter((entity) => entity.length > 0 && !GENERIC_ENTITIES.has(entity));
}

function normalizeEntity(entity: string) {
  const normalized = normalizeSignal(entity);
  if (["sf", "san_fransisco", "san_franciso", "san_fransciso"].includes(normalized)) {
    return "san_francisco";
  }
  return normalized;
}

function normalizeSignal(value: string | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function compareCreatedAt(left: EngramMemory, right: EngramMemory) {
  return (Date.parse(left.created_at) || 0) - (Date.parse(right.created_at) || 0);
}

function newestTime(memories: EngramMemory[]) {
  return Math.max(...memories.map((memory) => Date.parse(memory.created_at) || 0));
}
