import { z } from "zod";
import type { ChatMessage, EngramMemory, MemoryDecisionTraceProvider } from "@/types";
import { evaluateMemoryCandidate, type MemoryCandidate } from "@/lib/memory/rules";

const memoryFactKindSchema = z.enum([
  "preference",
  "personal_fact",
  "project_fact",
  "place_fact",
  "relationship",
  "correction",
  "semantic",
  "other"
]);

const plannedMemorySchema = z
  .object({
    text: z.string().min(1),
    kind: memoryFactKindSchema,
    topic: z.string().min(1).optional(),
    importance: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    entities: z.array(z.string().min(1)).default([]),
    sourceText: z.string().min(1).optional(),
    cluster: z.string().min(1).optional(),
    supersedes: z.array(z.string().min(1)).default([])
  })
  .strict();

export const turnMemoryPlanSchema = z
  .object({
    provider: z.enum(["deterministic", "llm", "fallback"]),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1),
    intent: z.enum([
      "durable_statement",
      "memory_question",
      "mixed",
      "general_chat",
      "command",
      "correction",
      "ambiguous"
    ]),
    shouldRetrieve: z.boolean(),
    retrieveQuery: z.string().min(1).nullable(),
    memories: z.array(plannedMemorySchema).default([]),
    supersedeMemoryIds: z.array(z.string().min(1)).default([])
  })
  .strict();

export type MemoryFactKind = z.infer<typeof memoryFactKindSchema>;
export type PlannedMemory = z.infer<typeof plannedMemorySchema>;
export type TurnMemoryPlan = z.infer<typeof turnMemoryPlanSchema>;

export type TurnMemoryPlanningInput = {
  history?: ChatMessage[];
  memories?: EngramMemory[];
  message: string;
};

export interface TurnMemoryPlanner {
  readonly provider: MemoryDecisionTraceProvider;
  decide(input: TurnMemoryPlanningInput): TurnMemoryPlan | Promise<TurnMemoryPlan>;
}

export class DeterministicTurnMemoryPlanner implements TurnMemoryPlanner {
  readonly provider = "deterministic" as const;

  decide(input: TurnMemoryPlanningInput): TurnMemoryPlan {
    const text = normalize(input.message);
    const activeMemories = activeMemoryList(input.memories ?? []);

    if (!text) {
      return ignorePlan("empty", "general_chat", 1);
    }

    if (isMixedTurn(text)) {
      return ignorePlan("ambiguous mixed memory/question turn needs model planning", "ambiguous", 0.45);
    }

    const candidate = evaluateMemoryCandidate(text);
    const correction = isCorrection(text);
    if (candidate.shouldStore) {
      if (candidate.reason === "place-fact" && !hasContextualEntitySupport(text, activeMemories)) {
        return ignorePlan("standalone place statement is not user-specific enough to store", "general_chat", 0.82);
      }

      const memory = plannedMemoryFromCandidate(candidate, text, activeMemories, correction);
      const supersedeMemoryIds = unique([...(memory.supersedes ?? []), ...findSupersededMemories(memory, activeMemories)]);

      return turnMemoryPlanSchema.parse({
        provider: this.provider,
        confidence: correction ? 0.86 : candidate.importance,
        reason: correction ? "correction" : candidate.reason,
        intent: correction ? "correction" : "durable_statement",
        shouldRetrieve: false,
        retrieveQuery: null,
        memories: [{ ...memory, supersedes: supersedeMemoryIds }],
        supersedeMemoryIds
      });
    }

    const implicitMemory = implicitDurableMemoryFromText(text, activeMemories, correction);
    if (implicitMemory) {
      const supersedeMemoryIds = unique([
        ...(implicitMemory.supersedes ?? []),
        ...findSupersededMemories(implicitMemory, activeMemories)
      ]);

      return turnMemoryPlanSchema.parse({
        provider: this.provider,
        confidence: implicitMemory.confidence,
        reason: correction ? "correction" : implicitMemory.kind.replace("_", "-"),
        intent: correction ? "correction" : "durable_statement",
        shouldRetrieve: false,
        retrieveQuery: null,
        memories: [{ ...implicitMemory, supersedes: supersedeMemoryIds }],
        supersedeMemoryIds
      });
    }

    if (isMemoryQuestion(text)) {
      return turnMemoryPlanSchema.parse({
        provider: this.provider,
        confidence: 0.86,
        reason: "memory-question",
        intent: "memory_question",
        shouldRetrieve: true,
        retrieveQuery: text,
        memories: [],
        supersedeMemoryIds: []
      });
    }

    if (looksAmbiguousDurable(text)) {
      return ignorePlan("ambiguous durable statement needs model planning", "ambiguous", 0.45);
    }

    if (candidate.reason === "trivial-question" || candidate.reason === "transient" || isCommand(text)) {
      return ignorePlan(candidate.reason, isCommand(text) ? "command" : "general_chat", 0.9);
    }

    return ignorePlan(candidate.reason, "general_chat", 0.9);
  }
}

export class HybridTurnMemoryPlanner implements TurnMemoryPlanner {
  readonly provider = "llm" as const;

  constructor(
    private readonly modelPlanner: TurnMemoryPlanner,
    private readonly fallbackPlanner: TurnMemoryPlanner = deterministicTurnMemoryPlanner
  ) {}

  async decide(input: TurnMemoryPlanningInput): Promise<TurnMemoryPlan> {
    const fastPlan = await this.fallbackPlanner.decide(input);
    if (!shouldUseModelPlan(fastPlan)) return fastPlan;
    return this.modelPlanner.decide(input);
  }
}

export const deterministicTurnMemoryPlanner = new DeterministicTurnMemoryPlanner();

export function shouldUseModelPlan(plan: TurnMemoryPlan) {
  return plan.intent === "ambiguous";
}

export function parseTurnMemoryPlan(input: unknown): TurnMemoryPlan {
  if (typeof input !== "string") {
    return turnMemoryPlanSchema.parse(input);
  }

  try {
    return turnMemoryPlanSchema.parse(JSON.parse(input));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid turn memory plan JSON: ${error.message}`);
    }
    throw error;
  }
}

function plannedMemoryFromCandidate(
  candidate: MemoryCandidate,
  text: string,
  memories: EngramMemory[],
  correction: boolean
): PlannedMemory {
  const kind = correction ? "correction" : kindFromReason(candidate.reason);
  const entities = extractEntities(text);
  const topic = refineTopic(candidate.topic, text, entities);
  const cluster = inferCluster(text, topic, kind);

  return plannedMemorySchema.parse({
    text: normalizeMemoryText(candidate.text, kind, text),
    kind,
    topic,
    importance: candidate.importance,
    confidence: candidate.importance,
    entities,
    sourceText: text,
    cluster,
    supersedes: correction
      ? findSupersededMemories({ text, kind, topic, entities, cluster }, memories)
      : []
  });
}

function implicitDurableMemoryFromText(
  text: string,
  memories: EngramMemory[],
  correction: boolean
): PlannedMemory | undefined {
  const relationship = text.match(/\bmy\s+(partner|wife|husband|spouse|friend|manager|coworker)'?s\s+name\s+is\s+([A-Z][a-z]+)\b/i);
  if (relationship) {
    const relation = relationship[1].toLowerCase();
    const name = relationship[2];
    const memory = plannedMemorySchema.parse({
      text: `User's ${relation} is named ${name}.`,
      kind: correction ? "correction" : "relationship",
      topic: "relationship",
      importance: 0.72,
      confidence: 0.78,
      entities: [name, "relationship"],
      sourceText: text,
      cluster: "relationship",
      supersedes: []
    });
    return correction ? { ...memory, supersedes: findSupersededMemories(memory, memories) } : memory;
  }

  if (/\b(i spend|i usually|i often|i mostly|i regularly)\b.*\b(weekends?|climb|climbing|run|running|hike|hiking|music|guitar)\b/i.test(text)) {
    return plannedMemorySchema.parse({
      text,
      kind: "personal_fact",
      topic: "hobby",
      importance: 0.68,
      confidence: 0.72,
      entities: extractEntities(text),
      sourceText: text,
      cluster: "hobby_interest",
      supersedes: []
    });
  }

  return undefined;
}

function normalizeMemoryText(text: string, kind: MemoryFactKind, sourceText: string) {
  if (/^user\b/i.test(text)) return text;
  if (kind === "place_fact" && !/\b(i|my|we|our)\b/i.test(sourceText)) {
    return `User appreciates ${text.replace(/\.$/, "")}.`;
  }
  return text;
}

function findSupersededMemories(
  memory: Pick<PlannedMemory, "cluster" | "topic" | "entities" | "kind" | "text">,
  memories: EngramMemory[]
) {
  if (!memory.cluster && !memory.topic) return [];
  if (memory.kind !== "correction") return [];

  return memories
    .filter((candidate) => candidate.status !== "superseded")
    .filter((candidate) => {
      if (memory.cluster && candidate.cluster === memory.cluster) return true;
      if (memory.cluster === "current_location" && candidate.topic === "location") return true;
      if (memory.cluster === "favorite_color" && candidate.cluster === "favorite_color") return true;
      return Boolean(memory.topic && candidate.topic === memory.topic && shareEntity(memory.entities, candidate.entities));
    })
    .map((candidate) => candidate.id);
}

function kindFromReason(reason: MemoryCandidate["reason"]): MemoryFactKind {
  switch (reason) {
    case "preference":
      return "preference";
    case "personal-fact":
      return "personal_fact";
    case "place-fact":
      return "place_fact";
    case "project-fact":
      return "project_fact";
    default:
      return "other";
  }
}

export function extractEntities(text: string): string[] {
  const entities = new Set<string>();
  const normalized = text.toLowerCase();

  [
    ["san francisco", /\bsan\s+fran(?:cisco|sisco|sciso)\b/i],
    ["sf", /\bsf\b/i],
    ["haight", /\bhaight\b/i],
    ["california", /\bcalifornia\b/i],
    ["oakland", /\boakland\b/i],
    ["sushi", /\bsushi\b/i],
    ["omakase", /\bomakase\b/i],
    ["coffee", /\bcoffee|roasters?\b/i],
    ["blue", /\bblue\b/i],
    ["indigo", /\bindigo\b/i],
    ["red", /\bred\b/i]
  ].forEach(([label, pattern]) => {
    if ((pattern as RegExp).test(text)) entities.add(label as string);
  });

  text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/g)?.forEach((match) => {
    if (match.length > 2 && !["User", "What", "Why", "How", "When", "Where"].includes(match)) {
      entities.add(match);
    }
  });

  if (/\bpartner|wife|husband|spouse|son|daughter|friend|manager|coworker\b/.test(normalized)) {
    entities.add("relationship");
  }

  return [...entities];
}

export function inferCluster(text: string, topic?: string, kind?: string): string | undefined {
  const normalized = text.toLowerCase();

  if (/\b(color|blue|indigo|red|green|purple|yellow|orange|teal|cyan)\b/.test(normalized)) {
    return "favorite_color";
  }
  if (/\b(i live|i moved|i relocated|i am based|i'm based|my neighborhood|current city|now live)\b/.test(normalized)) {
    return "current_location";
  }
  if (topic === "location") return "location_life";
  if (/\b(sushi|omakase|food|restaurant|coffee)\b/.test(normalized)) return "food_preference";
  if (/\b(partner|wife|husband|spouse|friend|manager|name is)\b/.test(normalized)) return "relationship";
  if (/\b(hobby|weekend|climb|run|running|music|guitar|hike|hiking)\b/.test(normalized)) return "hobby_interest";
  if (topic === "work" || topic === "technical" || kind === "project_fact") return "work_project";
  return topic;
}

function inferTopicFromEntities(text: string, entities: string[]) {
  const normalized = text.toLowerCase();
  if (entities.some((entity) => ["san francisco", "sf", "haight", "california", "oakland"].includes(entity.toLowerCase()))) {
    return "location";
  }
  if (/\b(sushi|omakase|food|restaurant|coffee)\b/.test(normalized)) return "food";
  if (/\b(partner|wife|husband|spouse|friend|manager)\b/.test(normalized)) return "relationship";
  if (/\b(hobby|weekend|climb|run|running|music|guitar|hike|hiking)\b/.test(normalized)) return "hobby";
  return undefined;
}

function refineTopic(topic: string | undefined, text: string, entities: string[]) {
  const entityTopic = inferTopicFromEntities(text, entities);
  if (topic === "preference" && entityTopic) return entityTopic;
  return topic ?? entityTopic;
}

function hasContextualEntitySupport(text: string, memories: EngramMemory[]) {
  const entities = extractEntities(text).map((entity) => entity.toLowerCase());
  if (entities.length === 0) return false;

  return memories.some((memory) => {
    const memoryEntities = (memory.entities ?? extractEntities(memory.text)).map((entity) => entity.toLowerCase());
    return memory.topic === "location" && entities.some((entity) => memoryEntities.includes(entity));
  });
}

function isMixedTurn(text: string) {
  return isQuestion(text) && /\b(i|i'm|i am|my|we|our)\b/i.test(text) && /[.!?,;]\s*(what|why|how|when|where|who|which|can|could|do|does|did|is|are)\b/i.test(text);
}

export function isMemoryQuestion(text: string) {
  if (!isQuestion(text)) return false;
  return /\b(my|me|i|we|our|us|favorite|prefer|like|love|remember|memory|know about|app|project|design|style|interface|stack)\b/i.test(text);
}

function isQuestion(text: string) {
  return /^(what|why|how|when|where|who|which|can|could|would|should|do|does|did|is|are|will)\b/i.test(text.trim()) || /\?$/.test(text.trim());
}

function isCommand(text: string) {
  return /\b(can you|could you|please|help me|show me|explain|summarize|write|make|build|fix)\b/i.test(text);
}

function isCorrection(text: string) {
  return /\b(actually|correction|instead|no longer|not anymore|now)\b/i.test(text);
}

function looksAmbiguousDurable(text: string) {
  if (isQuestion(text) || isCommand(text)) return false;
  return /\b(i|i'm|i am|my|we|our|partner|wife|husband|spouse|favorite|hobby|weekends?|work|live|moved|based)\b/i.test(text);
}

function ignorePlan(reason: string, intent: TurnMemoryPlan["intent"], confidence: number): TurnMemoryPlan {
  return turnMemoryPlanSchema.parse({
    provider: "deterministic",
    confidence,
    reason,
    intent,
    shouldRetrieve: false,
    retrieveQuery: null,
    memories: [],
    supersedeMemoryIds: []
  });
}

function activeMemoryList(memories: EngramMemory[]) {
  return memories.filter((memory) => memory.status !== "superseded");
}

function shareEntity(left: string[] = [], right: string[] = []) {
  const rightSet = new Set(right.map((entity) => entity.toLowerCase()));
  return left.some((entity) => rightSet.has(entity.toLowerCase()));
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim();
}
