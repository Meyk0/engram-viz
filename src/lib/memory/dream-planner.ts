import { z } from "zod";
import { dreamOperationSchema, dreamProposalSchema } from "@/lib/events/schema";
import { extractEntities, inferCluster } from "@/lib/memory/turn-planner";
import type { DreamOperation, DreamProposal, EngramMemory, MemoryDecisionTraceProvider } from "@/types";

export type DreamPlanningInput = {
  memories: EngramMemory[];
  now?: Date | string;
};

export interface DreamPlanner {
  readonly provider: MemoryDecisionTraceProvider;
  decide(input: DreamPlanningInput): DreamProposal | Promise<DreamProposal>;
}

export class DreamPlannerFallbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DreamPlannerFallbackError";
  }
}

export class DeterministicDreamPlanner implements DreamPlanner {
  readonly provider = "deterministic" as const;

  decide(input: DreamPlanningInput): DreamProposal {
    const now = toIsoDate(input.now);
    const activeMemories = activeMemoryList(input.memories);

    if (activeMemories.length < 3) {
      return skippedProposal(this.provider, now, "Dream mode needs at least three active memories before proposing changes.");
    }

    const supersede = findSupersedeOperation(activeMemories, now);
    if (supersede) {
      return proposedProposal(this.provider, now, "Found active memory conflict that can be resolved by superseding older traces.", [
        supersede
      ]);
    }

    const merge = findMergeOperation(activeMemories, now);
    if (merge) {
      return proposedProposal(this.provider, now, "Found duplicate or closely related hippocampus memories to merge.", [merge]);
    }

    const insight = findInsightOperation(activeMemories, now);
    if (insight) {
      return proposedProposal(this.provider, now, "Found a recurring pattern across active memories.", [insight]);
    }

    return skippedProposal(this.provider, now, "No safe dream merge, supersede, or insight operation was found.");
  }
}

export class HybridDreamPlanner implements DreamPlanner {
  readonly provider = "llm" as const;

  constructor(
    private readonly modelPlanner: DreamPlanner,
    private readonly fallbackPlanner: DreamPlanner = deterministicDreamPlanner
  ) {}

  async decide(input: DreamPlanningInput): Promise<DreamProposal> {
    try {
      return await this.modelPlanner.decide(input);
    } catch (error) {
      const proposal = await this.fallbackPlanner.decide(input);

      return parseDreamProposal({
        ...proposal,
        provider: "fallback",
        reason: `${formatError(error)} Deterministic fallback: ${proposal.reason}`
      });
    }
  }
}

export const deterministicDreamPlanner = new DeterministicDreamPlanner();

export function parseDreamProposal(input: unknown): DreamProposal {
  return dreamProposalSchema.parse(input);
}

function findSupersedeOperation(memories: EngramMemory[], now: string): DreamOperation | undefined {
  const explicit = memories
    .slice()
    .sort(newestFirst)
    .find((memory) => (memory.supersedes ?? []).some((id) => memories.some((candidate) => candidate.id === id)));

  if (explicit) {
    const supersedeIds = unique(
      (explicit.supersedes ?? []).filter((id) => id !== explicit.id && memories.some((memory) => memory.id === id))
    );
    if (supersedeIds.length > 0) {
      return operation({
        now,
        type: "supersede",
        sourceIds: [explicit.id],
        supersedeIds,
        reason: "An active memory explicitly marks older active memories as superseded.",
        confidence: 0.9
      });
    }
  }

  const conflictGroups = groupBySignal(memories).filter((group) => group.length >= 2);
  for (const group of conflictGroups) {
    const sorted = group.slice().sort(newestFirst);
    const newest = sorted[0];
    if (!newest) continue;

    const olderConflicts = sorted
      .slice(1)
      .filter((memory) => memoriesConflict(newest, memory))
      .map((memory) => memory.id);

    if (olderConflicts.length > 0) {
      return operation({
        now,
        type: "supersede",
        sourceIds: [newest.id],
        supersedeIds: olderConflicts,
        reason: "Newer active memory conflicts with older memory on the same durable topic.",
        confidence: 0.82
      });
    }
  }

  return undefined;
}

function findMergeOperation(memories: EngramMemory[], now: string): DreamOperation | undefined {
  const hippocampusGroups = groupBySignal(memories.filter((memory) => memory.region === "hippocampus")).filter(
    (group) => group.length >= 2
  );

  const group = hippocampusGroups
    .map((memoriesForSignal) => memoriesForSignal.filter((memory, index, all) => all.some((other, otherIndex) => otherIndex !== index && memoriesCanMerge(memory, other))))
    .filter((memoriesForSignal) => memoriesForSignal.length >= 2)
    .sort((a, b) => b.length - a.length || oldestFirst(a[0], b[0]))[0];

  if (!group) return undefined;

  const selected = group.slice().sort(oldestFirst).slice(0, 3);
  const topic = selected[0]?.topic ?? "memory";

  return operation({
    now,
    type: "merge",
    sourceIds: selected.map((memory) => memory.id),
    supersedeIds: selected.map((memory) => memory.id),
    result: createDreamMemory({
      now,
      operation: "merge",
      source: selected,
      text: summarizeMemories(topic, selected),
      confidence: 0.78
    }),
    reason: "Hippocampus memories share a topic and direct duplicate or entity overlap signals.",
    confidence: 0.78
  });
}

function findInsightOperation(memories: EngramMemory[], now: string): DreamOperation | undefined {
  const group = groupBySignal(memories)
    .filter((memoriesForSignal) => memoriesForSignal.length >= 3)
    .sort((a, b) => b.length - a.length || newestTime(b) - newestTime(a))[0];

  if (!group) return undefined;

  const selected = group.slice().sort(oldestFirst).slice(0, 5);
  const topic = selected[0]?.topic ?? selected[0]?.cluster ?? "memory";

  return operation({
    now,
    type: "insight",
    sourceIds: selected.map((memory) => memory.id),
    result: createDreamMemory({
      now,
      operation: "insight",
      source: selected,
      text: `User shows a recurring ${topicLabel(topic)} pattern: ${compactFacts(selected).join("; ")}`,
      confidence: 0.74
    }),
    reason: "Three or more active memories repeat the same topic or cluster without a direct merge requirement.",
    confidence: 0.74
  });
}

function proposedProposal(
  provider: MemoryDecisionTraceProvider,
  now: string,
  reason: string,
  operations: DreamOperation[]
) {
  return parseDreamProposal({
    id: proposalId(now, operations[0]?.type ?? "proposal"),
    provider,
    status: "proposed",
    reason,
    operations,
    created_at: now
  });
}

function skippedProposal(provider: MemoryDecisionTraceProvider, now: string, reason: string) {
  return parseDreamProposal({
    id: proposalId(now, "skip"),
    provider,
    status: "skipped",
    reason,
    operations: [],
    created_at: now
  });
}

function operation(input: Omit<DreamOperation, "id"> & { now: string }): DreamOperation {
  return dreamOperationStrictSchema.parse({
    id: operationId(input.now, input.type, input.sourceIds),
    type: input.type,
    sourceIds: input.sourceIds,
    result: input.result,
    supersedeIds: input.supersedeIds,
    reason: input.reason,
    confidence: input.confidence
  });
}

function createDreamMemory(input: {
  now: string;
  operation: DreamOperation["type"];
  source: EngramMemory[];
  text: string;
  confidence: number;
}): EngramMemory {
  const sourceIds = input.source.map((memory) => memory.id);
  const topic = mostCommon(input.source.map((memory) => memory.topic).filter(Boolean));
  const entities = unique(input.source.flatMap((memory) => memory.entities ?? extractEntities(memory.text)));
  const cluster = mostCommon(input.source.map((memory) => memory.cluster).filter(Boolean)) ?? inferCluster(input.text, topic);

  return {
    id: operationId(input.now, `${input.operation}-memory`, sourceIds),
    text: input.text,
    importance: clamp(Math.max(...input.source.map((memory) => memory.importance), 0.6), 0.6, 0.9),
    topic,
    kind: input.operation === "insight" ? "semantic" : mostCommon(input.source.map((memory) => memory.kind).filter(Boolean)),
    entities: entities.length > 0 ? entities : undefined,
    confidence: input.confidence,
    cluster,
    sourceMemoryIds: sourceIds,
    region: "temporal",
    created_at: input.now,
    access_count: 0
  };
}

function groupBySignal(memories: EngramMemory[]) {
  const groups = new Map<string, EngramMemory[]>();

  memories.forEach((memory) => {
    const signal = memorySignal(memory);
    if (!signal) return;
    groups.set(signal, [...(groups.get(signal) ?? []), memory]);
  });

  return [...groups.values()];
}

function memorySignal(memory: EngramMemory) {
  const cluster = memory.cluster ?? inferCluster(memory.text, memory.topic, memory.kind);
  if (cluster) return `cluster:${cluster}`;
  if (memory.topic) return `topic:${memory.topic}`;
  return undefined;
}

function memoriesCanMerge(left: EngramMemory, right: EngramMemory) {
  if (normalizedText(left.text) === normalizedText(right.text)) return true;
  if (!sameMemorySignal(left, right)) return false;
  if (memoriesConflict(left, right)) return false;
  return shareEntity(left, right) || sameStemmedText(left.text, right.text);
}

function memoriesConflict(left: EngramMemory, right: EngramMemory) {
  if (!sameMemorySignal(left, right)) return false;

  const cluster = left.cluster ?? right.cluster ?? inferCluster(left.text, left.topic, left.kind);
  if (cluster && ["current_location", "favorite_color", "relationship"].includes(cluster)) {
    return canonicalValue(left) !== canonicalValue(right);
  }

  if (!shareEntity(left, right) && left.topic !== right.topic) return false;
  return hasCorrectionCue(left.text) || hasCorrectionCue(right.text);
}

function sameMemorySignal(left: EngramMemory, right: EngramMemory) {
  const leftSignal = memorySignal(left);
  return Boolean(leftSignal && leftSignal === memorySignal(right));
}

function canonicalValue(memory: EngramMemory) {
  const normalized = normalizedText(memory.text);
  const cluster = memory.cluster ?? inferCluster(memory.text, memory.topic, memory.kind);
  const entities = (memory.entities ?? extractEntities(memory.text)).map((entity) => entity.toLowerCase()).sort();
  if (cluster && ["current_location", "favorite_color", "relationship"].includes(cluster) && entities.length > 0) {
    return entities.join("|");
  }
  return `${entities.join("|")}:${normalized.replace(/\b(actually|now|instead|no longer|not anymore)\b/g, "").trim()}`;
}

function shareEntity(left: EngramMemory, right: EngramMemory) {
  const rightEntities = new Set((right.entities ?? extractEntities(right.text)).map((entity) => entity.toLowerCase()));
  return (left.entities ?? extractEntities(left.text)).some((entity) => rightEntities.has(entity.toLowerCase()));
}

function summarizeMemories(topic: string, memories: EngramMemory[]) {
  return `User has recurring ${topicLabel(topic)} memories: ${compactFacts(memories).join("; ")}`;
}

function compactFacts(memories: EngramMemory[]) {
  return unique(memories.map((memory) => stripExplicitMemoryCue(memory.text))).slice(0, 5);
}

function stripExplicitMemoryCue(text: string) {
  return text
    .replace(/^(remember that|note that|keep in mind that|don't forget that|do not forget that)\s+/i, "")
    .replace(/\.$/, "")
    .trim();
}

function topicLabel(topic: string) {
  return topic === "location" ? "place and life-context" : topic.replace(/_/g, " ");
}

function activeMemoryList(memories: EngramMemory[]) {
  return memories.filter((memory) => memory.status !== "superseded");
}

function proposalId(now: string, suffix: string) {
  return `dream-${timestampId(now)}-${slug(suffix)}`;
}

function operationId(now: string, type: string, sourceIds: string[]) {
  return `dream-${slug(type)}-${timestampId(now)}-${sourceIds.map(slug).join("-")}`;
}

function timestampId(now: string) {
  return now.replace(/\D/g, "").slice(0, 14) || "now";
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function toIsoDate(now: Date | string | undefined) {
  if (now instanceof Date) return now.toISOString();
  if (typeof now === "string") return new Date(now).toISOString();
  return new Date().toISOString();
}

function oldestFirst(left: EngramMemory | undefined, right: EngramMemory | undefined) {
  return Date.parse(left?.created_at ?? "") - Date.parse(right?.created_at ?? "");
}

function newestFirst(left: EngramMemory, right: EngramMemory) {
  return oldestFirst(right, left);
}

function newestTime(memories: EngramMemory[]) {
  return Math.max(...memories.map((memory) => Date.parse(memory.created_at) || 0));
}

function normalizedText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").replace(/[.?!]/g, "").trim();
}

function sameStemmedText(left: string, right: string) {
  const leftWords = contentWords(left);
  const rightWords = new Set(contentWords(right));
  const overlap = leftWords.filter((word) => rightWords.has(word)).length;
  return overlap >= Math.min(4, Math.max(2, Math.min(leftWords.length, rightWords.size)));
}

function contentWords(text: string) {
  const stopWords = new Set(["user", "the", "and", "with", "that", "this", "prefers", "likes", "loves", "has", "for"]);
  return normalizedText(text)
    .split(" ")
    .map((word) => word.replace(/s$/, ""))
    .filter((word) => word.length > 2 && !stopWords.has(word));
}

function hasCorrectionCue(text: string) {
  return /\b(actually|instead|no longer|not anymore|now|correction)\b/i.test(text);
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function mostCommon(values: Array<string | undefined>) {
  const counts = new Map<string, number>();
  values.forEach((value) => {
    if (!value) return;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });

  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const dreamOperationStrictSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(["merge", "supersede", "insight"]),
    sourceIds: z.array(z.string().min(1)).min(1),
    result: dreamOperationSchema.shape.result,
    supersedeIds: z.array(z.string().min(1)).optional(),
    reason: z.string().min(1),
    confidence: z.number().min(0).max(1)
  })
  .strict();
