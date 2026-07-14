import { z } from "zod";
import {
  deterministicTurnMemoryPlanner,
  extractEntities,
  inferCluster,
  parseTurnMemoryPlan,
  turnMemoryPlanSchema,
  type TurnMemoryPlan,
  type TurnMemoryPlanner,
  type TurnMemoryPlanningInput
} from "@/lib/memory/turn-planner";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_TURN_PLANNER_MODEL = "gpt-5.4-mini";
const DEFAULT_MIN_CONFIDENCE = 0.65;

const openAIRawPlannedMemorySchema = z
  .object({
    text: z.string().min(1),
    kind: z.enum([
      "preference",
      "personal_fact",
      "project_fact",
      "place_fact",
      "relationship",
      "correction",
      "semantic",
      "other"
    ]),
    topic: z.string().min(1).nullable(),
    importance: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    entities: z.array(z.string().min(1)),
    sourceText: z.string().min(1).nullable(),
    cluster: z.string().min(1).nullable(),
    supersedes: z.array(z.string().min(1))
  })
  .strict();

const openAIRawTurnMemoryPlanSchema = z
  .object({
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
    memories: z.array(openAIRawPlannedMemorySchema),
    supersedeMemoryIds: z.array(z.string().min(1))
  })
  .strict();

export type OpenAITurnMemoryPlannerOptions = {
  apiKey?: string;
  fallbackPlanner?: TurnMemoryPlanner;
  fetcher?: typeof fetch;
  minConfidence?: number;
  model?: string;
};

export class OpenAITurnMemoryPlanner implements TurnMemoryPlanner {
  readonly provider = "llm" as const;
  private readonly apiKey?: string;
  private readonly fallbackPlanner: TurnMemoryPlanner;
  private readonly fetcher: typeof fetch;
  private readonly minConfidence: number;
  private readonly model: string;

  constructor(options: OpenAITurnMemoryPlannerOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    this.fallbackPlanner = options.fallbackPlanner ?? deterministicTurnMemoryPlanner;
    this.fetcher = options.fetcher ?? fetch;
    this.minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    this.model =
      options.model ??
      process.env.OPENAI_TURN_PLANNER_MODEL ??
      process.env.OPENAI_MEMORY_PLANNER_MODEL ??
      process.env.OPENAI_MODEL ??
      DEFAULT_OPENAI_TURN_PLANNER_MODEL;
  }

  async decide(input: TurnMemoryPlanningInput): Promise<TurnMemoryPlan> {
    if (!this.apiKey) {
      return this.fallback(input, "OpenAI turn planner is enabled but OPENAI_API_KEY is missing.");
    }

    let response: Response;
    try {
      response = await this.fetcher(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        signal: input.signal,
        body: JSON.stringify({
          model: this.model,
          instructions: buildTurnPlannerInstructions(),
          input: buildTurnPlannerPrompt(input),
          max_output_tokens: 600,
          text: {
            format: {
              type: "json_schema",
              name: "engram_turn_memory_plan",
              strict: true,
              schema: openAITurnMemoryPlanJsonSchema
            }
          }
        })
      });
    } catch (error) {
      return this.fallback(input, `OpenAI turn planner request failed: ${formatError(error)}.`);
    }

    if (!response.ok) {
      return this.fallback(input, `OpenAI turn planner returned HTTP ${response.status}.`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      return this.fallback(input, `OpenAI turn planner response was not JSON: ${formatError(error)}.`);
    }

    const text = extractResponseText(payload);
    if (!text) {
      return this.fallback(input, "OpenAI turn planner response did not include JSON text.");
    }

    let plan: TurnMemoryPlan;
    try {
      plan = parseOpenAITurnPlan(text, input);
    } catch (error) {
      return this.fallback(input, `OpenAI turn planner output failed validation: ${formatError(error)}.`);
    }

    if (plan.confidence < this.minConfidence) {
      return this.fallback(
        input,
        `OpenAI turn planner confidence ${plan.confidence.toFixed(2)} was below ${this.minConfidence.toFixed(2)}.`
      );
    }

    return plan;
  }

  private async fallback(input: TurnMemoryPlanningInput, reason: string): Promise<TurnMemoryPlan> {
    const plan = await this.fallbackPlanner.decide(input);

    return turnMemoryPlanSchema.parse({
      ...plan,
      provider: "fallback",
      reason: `${reason} Deterministic fallback: ${plan.reason}`
    });
  }
}

export function parseOpenAITurnPlan(outputText: string, input: TurnMemoryPlanningInput): TurnMemoryPlan {
  const raw = openAIRawTurnMemoryPlanSchema.parse(JSON.parse(outputText));
  validateSupersedeIds(raw.supersedeMemoryIds, input);

  return parseTurnMemoryPlan({
    provider: "llm",
    confidence: raw.confidence,
    reason: raw.reason,
    intent: raw.intent,
    shouldRetrieve: raw.shouldRetrieve,
    retrieveQuery: raw.retrieveQuery,
    memories: raw.memories.map((memory) => ({
      text: memory.text,
      kind: memory.kind,
      topic: memory.topic ?? undefined,
      importance: memory.importance,
      confidence: memory.confidence,
      entities: memory.entities.length > 0 ? memory.entities : extractEntities(memory.text),
      sourceText: memory.sourceText ?? input.message,
      cluster: memory.cluster ?? inferCluster(memory.text, memory.topic ?? undefined, memory.kind),
      supersedes: memory.supersedes
    })),
    supersedeMemoryIds: raw.supersedeMemoryIds
  });
}

function validateSupersedeIds(ids: string[], input: TurnMemoryPlanningInput) {
  const activeIds = new Set((input.memories ?? []).filter((memory) => memory.status !== "superseded").map((memory) => memory.id));
  const ineligibleId = ids.find((id) => !activeIds.has(id));
  if (ineligibleId) {
    throw new Error(`Selected supersede id "${ineligibleId}" was not eligible.`);
  }
}

function buildTurnPlannerInstructions() {
  return [
    "You are Engram's turn memory planner.",
    "Create one plan for the latest user message before the assistant answers.",
    "Store durable user-specific facts, stable preferences, project facts, relationship facts, long-lived requirements, and corrections.",
    "Do not store standalone world facts unless the conversation context makes them a user preference or personal context.",
    "Set shouldRetrieve true only when stored memory is needed to answer the current turn.",
    "For store-only statements, shouldRetrieve must be false.",
    "For corrections, include supersedeMemoryIds for older active memories that the new memory replaces.",
    "Use concise normalized memory text beginning with User when possible.",
    "Return only JSON that matches the provided schema."
  ].join(" ");
}

function buildTurnPlannerPrompt(input: TurnMemoryPlanningInput) {
  const memories =
    input.memories && input.memories.length > 0
      ? input.memories
          .slice(-20)
          .map(
            (memory) =>
              `- id: ${memory.id}\n  text: ${memory.text}\n  topic: ${memory.topic ?? "unknown"}\n  kind: ${memory.kind ?? "unknown"}\n  cluster: ${memory.cluster ?? "unknown"}\n  entities: ${(memory.entities ?? []).join(", ") || "none"}\n  status: ${memory.status ?? "active"}`
          )
          .join("\n")
      : "No stored memories yet.";

  return `Latest user message:\n${input.message}\n\nStored memories:\n${memories}`;
}

function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";

  if ("output_text" in payload && typeof payload.output_text === "string") {
    return payload.output_text;
  }

  if (!("output" in payload) || !Array.isArray(payload.output)) return "";

  return payload.output
    .flatMap((item) => {
      if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray(item.content)) {
        return [];
      }

      return item.content.map(extractContentText);
    })
    .filter(Boolean)
    .join("");
}

function extractContentText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  if ("text" in content && typeof content.text === "string") return content.text;
  return "";
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const memoryJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "kind", "topic", "importance", "confidence", "entities", "sourceText", "cluster", "supersedes"],
  properties: {
    text: { type: "string" },
    kind: {
      type: "string",
      enum: ["preference", "personal_fact", "project_fact", "place_fact", "relationship", "correction", "semantic", "other"]
    },
    topic: { type: ["string", "null"] },
    importance: { type: "number", minimum: 0, maximum: 1 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    entities: { type: "array", items: { type: "string" } },
    sourceText: { type: ["string", "null"] },
    cluster: { type: ["string", "null"] },
    supersedes: { type: "array", items: { type: "string" } }
  }
} as const;

const openAITurnMemoryPlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["confidence", "reason", "intent", "shouldRetrieve", "retrieveQuery", "memories", "supersedeMemoryIds"],
  properties: {
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string" },
    intent: {
      type: "string",
      enum: ["durable_statement", "memory_question", "mixed", "general_chat", "command", "correction", "ambiguous"]
    },
    shouldRetrieve: { type: "boolean" },
    retrieveQuery: { type: ["string", "null"] },
    memories: { type: "array", items: memoryJsonSchema },
    supersedeMemoryIds: { type: "array", items: { type: "string" } }
  }
} as const;
