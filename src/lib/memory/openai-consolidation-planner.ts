import { z } from "zod";
import {
  consolidationDecisionSchema,
  deterministicMemoryConsolidationPlanner,
  findConsolidationCandidate,
  selectConsolidationPool,
  type ConsolidationDecision,
  type ConsolidationPlanningInput,
  type MemoryConsolidationPlanner
} from "@/lib/memory/consolidationPolicy";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_CONSOLIDATION_MODEL = "gpt-5.4-mini";
const DEFAULT_MIN_CONFIDENCE = 0.7;

const openAIRawConsolidationDecisionSchema = z
  .object({
    operation: z.enum(["consolidate", "skip"]),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1),
    ids: z.array(z.string().min(1)),
    consolidatedText: z.string().min(1).nullable(),
    topic: z.string().min(1).nullable(),
    entities: z.array(z.string().min(1))
  })
  .strict();

export type OpenAIConsolidationPlannerOptions = {
  apiKey?: string;
  fallbackPlanner?: MemoryConsolidationPlanner;
  fetcher?: typeof fetch;
  minConfidence?: number;
  model?: string;
};

export class OpenAIConsolidationPlanner implements MemoryConsolidationPlanner {
  readonly provider = "llm" as const;
  private readonly apiKey?: string;
  private readonly fallbackPlanner: MemoryConsolidationPlanner;
  private readonly fetcher: typeof fetch;
  private readonly minConfidence: number;
  private readonly model: string;

  constructor(options: OpenAIConsolidationPlannerOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    this.fallbackPlanner = options.fallbackPlanner ?? deterministicMemoryConsolidationPlanner;
    this.fetcher = options.fetcher ?? fetch;
    this.minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    this.model =
      options.model ??
      process.env.OPENAI_CONSOLIDATION_PLANNER_MODEL ??
      process.env.OPENAI_MEMORY_PLANNER_MODEL ??
      process.env.OPENAI_MODEL ??
      DEFAULT_OPENAI_CONSOLIDATION_MODEL;
  }

  async decide(input: ConsolidationPlanningInput): Promise<ConsolidationDecision> {
    const eligibleMemories = selectConsolidationPool(input);
    if (eligibleMemories.length < 2) {
      return this.fallbackPlanner.decide(input);
    }

    if (!this.apiKey) {
      return this.fallback(input, "OpenAI consolidation planner is enabled but OPENAI_API_KEY is missing.");
    }

    let response: Response;
    try {
      response = await this.fetcher(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.model,
          instructions: buildConsolidationInstructions(),
          input: buildConsolidationPrompt(eligibleMemories),
          max_output_tokens: 360,
          text: {
            format: {
              type: "json_schema",
              name: "engram_consolidation_decision",
              strict: true,
              schema: openAIConsolidationDecisionJsonSchema
            }
          }
        })
      });
    } catch (error) {
      return this.fallback(input, `OpenAI consolidation planner request failed: ${formatError(error)}.`);
    }

    if (!response.ok) {
      return this.fallback(input, `OpenAI consolidation planner returned HTTP ${response.status}.`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      return this.fallback(input, `OpenAI consolidation planner response was not JSON: ${formatError(error)}.`);
    }

    const text = extractResponseText(payload);
    if (!text) {
      return this.fallback(input, "OpenAI consolidation planner response did not include JSON text.");
    }

    let decision: ConsolidationDecision;
    try {
      decision = parseOpenAIConsolidationDecision(text, input);
    } catch (error) {
      return this.fallback(input, `OpenAI consolidation planner output failed validation: ${formatError(error)}.`);
    }

    if (decision.confidence < this.minConfidence) {
      return this.fallback(
        input,
        `OpenAI consolidation planner confidence ${decision.confidence.toFixed(2)} was below ${this.minConfidence.toFixed(2)}.`
      );
    }

    return decision;
  }

  private async fallback(input: ConsolidationPlanningInput, reason: string): Promise<ConsolidationDecision> {
    const decision = await this.fallbackPlanner.decide(input);

    return consolidationDecisionSchema.parse({
      ...decision,
      provider: "fallback",
      reason: `${reason} Deterministic fallback: ${decision.reason}`
    });
  }
}

export function parseOpenAIConsolidationDecision(
  outputText: string,
  input: ConsolidationPlanningInput
): ConsolidationDecision {
  const raw = openAIRawConsolidationDecisionSchema.parse(JSON.parse(outputText));

  if (raw.operation === "skip") {
    return consolidationDecisionSchema.parse({
      provider: "llm",
      operation: "skip",
      confidence: raw.confidence,
      reason: raw.reason
    });
  }

  validateConsolidationIds(raw.ids, input);

  return consolidationDecisionSchema.parse({
    provider: "llm",
    operation: "consolidate",
    confidence: raw.confidence,
    reason: raw.reason,
    ids: raw.ids,
    consolidatedText: raw.consolidatedText,
    topic: raw.topic ?? undefined,
    entities: raw.entities.length > 0 ? raw.entities : undefined
  });
}

function validateConsolidationIds(ids: string[], input: ConsolidationPlanningInput) {
  if (new Set(ids).size !== ids.length) {
    throw new Error("Consolidation ids must be unique.");
  }

  const eligibleIds = new Set(selectConsolidationPool(input).map((memory) => memory.id));
  const ineligibleId = ids.find((id) => !eligibleIds.has(id));
  if (ineligibleId) {
    throw new Error(`Selected consolidation id "${ineligibleId}" was not eligible.`);
  }
}

function buildConsolidationInstructions() {
  return [
    "You are Engram's memory consolidation planner.",
    "Decide whether eligible hippocampus memories should merge into one temporal semantic memory.",
    "Consolidate only when the memories describe the same stable preference, identity fact, project fact, or long-lived requirement.",
    "Skip if the memories are merely adjacent, contradictory, or too broad to summarize honestly.",
    "The consolidatedText must be a concise semantic memory, not a transcript.",
    "Use only eligible memory ids from the prompt.",
    "Return topic and entities for the consolidated memory when known.",
    "Return only JSON that matches the provided schema."
  ].join(" ");
}

function buildConsolidationPrompt(eligibleMemories: Array<ConsolidationPlanningInput["memories"][number]>) {
  const memoryLines = eligibleMemories
    .map(
      (memory) =>
        `- id: ${memory.id}\n  text: ${memory.text}\n  topic: ${memory.topic ?? "unknown"}\n  kind: ${memory.kind ?? "unknown"}\n  cluster: ${memory.cluster ?? "unknown"}\n  entities: ${(memory.entities ?? []).join(", ") || "none"}\n  importance: ${memory.importance.toFixed(2)}\n  access_count: ${memory.access_count}`
    )
    .join("\n");

  return `Eligible hippocampus memories:\n${memoryLines}`;
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

const openAIConsolidationDecisionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["operation", "confidence", "reason", "ids", "consolidatedText", "topic", "entities"],
  properties: {
    operation: {
      type: "string",
      enum: ["consolidate", "skip"],
      description: "Use consolidate only for genuinely mergeable durable memories; otherwise use skip."
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
    ids: {
      type: "array",
      items: { type: "string" },
      description: "Eligible source memory ids to merge. Empty for skip."
    },
    consolidatedText: {
      type: ["string", "null"],
      description: "Concise semantic memory for consolidate decisions; null for skip decisions."
    },
    topic: {
      type: ["string", "null"],
      description: "Topic for the semantic memory; null for skip decisions or when unknown."
    },
    entities: {
      type: "array",
      items: { type: "string" },
      description: "Entities represented in the semantic memory."
    }
  }
} as const;
