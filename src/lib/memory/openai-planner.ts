import { z } from "zod";
import {
  deterministicMemoryDecisionPlanner,
  memoryDecisionSchema,
  parseMemoryDecision,
  type MemoryDecision,
  type MemoryDecisionPlanner,
  type MemoryPlanningInput
} from "@/lib/memory/decision";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MEMORY_PLANNER_MODEL = "gpt-5.4-mini";
const DEFAULT_MIN_CONFIDENCE = 0.65;

const openAIRawMemoryDecisionSchema = z
  .object({
    operation: z.enum(["store", "ignore"]),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1),
    memoryText: z.string().min(1).nullable(),
    topic: z.string().min(1).nullable(),
    importance: z.number().min(0).max(1).nullable(),
    relatedMemoryIds: z.array(z.string().min(1))
  })
  .strict();

export type OpenAIMemoryDecisionPlannerOptions = {
  apiKey?: string;
  fallbackPlanner?: MemoryDecisionPlanner;
  fetcher?: typeof fetch;
  minConfidence?: number;
  model?: string;
};

export class OpenAIMemoryDecisionPlanner implements MemoryDecisionPlanner {
  readonly provider = "llm" as const;
  private readonly apiKey?: string;
  private readonly fallbackPlanner: MemoryDecisionPlanner;
  private readonly fetcher: typeof fetch;
  private readonly minConfidence: number;
  private readonly model: string;

  constructor(options: OpenAIMemoryDecisionPlannerOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    this.fallbackPlanner = options.fallbackPlanner ?? deterministicMemoryDecisionPlanner;
    this.fetcher = options.fetcher ?? fetch;
    this.minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    this.model =
      options.model ??
      process.env.OPENAI_MEMORY_PLANNER_MODEL ??
      process.env.OPENAI_MODEL ??
      DEFAULT_OPENAI_MEMORY_PLANNER_MODEL;
  }

  async decide(input: MemoryPlanningInput): Promise<MemoryDecision> {
    if (!this.apiKey) {
      return this.fallback(input, "OpenAI memory planner is enabled but OPENAI_API_KEY is missing.");
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
          instructions: buildPlannerInstructions(),
          input: buildPlannerPrompt(input),
          max_output_tokens: 320,
          text: {
            format: {
              type: "json_schema",
              name: "engram_memory_decision",
              strict: true,
              schema: openAIMemoryDecisionJsonSchema
            }
          }
        })
      });
    } catch (error) {
      return this.fallback(input, `OpenAI memory planner request failed: ${formatError(error)}.`);
    }

    if (!response.ok) {
      return this.fallback(input, `OpenAI memory planner returned HTTP ${response.status}.`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      return this.fallback(input, `OpenAI memory planner response was not JSON: ${formatError(error)}.`);
    }

    const text = extractResponseText(payload);
    if (!text) {
      return this.fallback(input, "OpenAI memory planner response did not include JSON text.");
    }

    let decision: MemoryDecision;
    try {
      decision = parseOpenAIDecision(text, input);
    } catch (error) {
      return this.fallback(input, `OpenAI memory planner output failed validation: ${formatError(error)}.`);
    }

    if (decision.confidence < this.minConfidence) {
      return this.fallback(
        input,
        `OpenAI memory planner confidence ${decision.confidence.toFixed(2)} was below ${this.minConfidence.toFixed(2)}.`
      );
    }

    return decision;
  }

  private async fallback(input: MemoryPlanningInput, reason: string): Promise<MemoryDecision> {
    const decision = await this.fallbackPlanner.decide(input);
    const relatedMemoryIds = getRelatedMemoryIds(input, decision);

    return memoryDecisionSchema.parse({
      ...decision,
      provider: "fallback",
      reason: `${reason} Deterministic fallback: ${decision.reason}`,
      relatedMemoryIds
    });
  }
}

export function parseOpenAIDecision(outputText: string, input: MemoryPlanningInput): MemoryDecision {
  const raw = openAIRawMemoryDecisionSchema.parse(JSON.parse(outputText));
  const relatedMemoryIds = raw.relatedMemoryIds.length > 0 ? raw.relatedMemoryIds : getRelatedMemoryIds(input);

  if (raw.operation === "ignore") {
    return parseMemoryDecision({
      provider: "llm",
      operation: "ignore",
      confidence: raw.confidence,
      reason: raw.reason,
      relatedMemoryIds
    });
  }

  return parseMemoryDecision({
    provider: "llm",
    operation: "store",
    confidence: raw.confidence,
    reason: raw.reason,
    memoryText: raw.memoryText,
    topic: raw.topic ?? undefined,
    importance: raw.importance,
    relatedMemoryIds
  });
}

function buildPlannerInstructions() {
  return [
    "You are Engram's memory decision planner.",
    "Decide whether the user's latest message contains a durable memory worth storing.",
    "Store durable preferences, stable personal facts, project facts, and long-lived requirements.",
    "Ignore questions, one-off commands, greetings, acknowledgements, jokes, and transient requests.",
    "Use relatedMemoryIds only for memory ids that directly influenced the decision.",
    "Return only JSON that matches the provided schema."
  ].join(" ");
}

function buildPlannerPrompt(input: MemoryPlanningInput) {
  const relatedMemories =
    input.relatedMemories && input.relatedMemories.length > 0
      ? input.relatedMemories
          .map(
            (memory) =>
              `- id: ${memory.id}\n  text: ${memory.text}\n  topic: ${memory.topic ?? "unknown"}\n  importance: ${memory.importance.toFixed(2)}`
          )
          .join("\n")
      : "No related memory traces were retrieved.";

  return `User message:\n${input.message}\n\nRelated memory traces:\n${relatedMemories}`;
}

function getRelatedMemoryIds(input: MemoryPlanningInput, decision?: MemoryDecision) {
  if (decision?.relatedMemoryIds.length) return decision.relatedMemoryIds;
  if (input.relatedMemoryIds?.length) return input.relatedMemoryIds;
  return input.relatedMemories?.map((memory) => memory.id) ?? [];
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

const openAIMemoryDecisionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["operation", "confidence", "reason", "memoryText", "topic", "importance", "relatedMemoryIds"],
  properties: {
    operation: {
      type: "string",
      enum: ["store", "ignore"],
      description: "Use store only for durable memory-worthy content; otherwise use ignore."
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1
    },
    reason: {
      type: "string",
      description: "Short explanation for the decision."
    },
    memoryText: {
      type: ["string", "null"],
      description: "Normalized durable memory text for store decisions; null for ignore decisions."
    },
    topic: {
      type: ["string", "null"],
      description: "Short topic label for store decisions; null when unknown or ignored."
    },
    importance: {
      type: ["number", "null"],
      minimum: 0,
      maximum: 1,
      description: "Memory importance from 0 to 1 for store decisions; null for ignore decisions."
    },
    relatedMemoryIds: {
      type: "array",
      items: { type: "string" },
      description: "IDs of retrieved memories that influenced the decision."
    }
  }
} as const;
