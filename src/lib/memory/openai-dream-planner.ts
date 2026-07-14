import { randomUUID } from "node:crypto";
import { z } from "zod";
import { parseDreamProposal, DreamPlannerFallbackError, type DreamPlanner, type DreamPlanningInput } from "@/lib/memory/dream-planner";
import type { DreamOperation, DreamProposal, EngramMemory } from "@/types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_DREAM_PLANNER_MODEL = "gpt-5.4-mini";
const DEFAULT_MIN_CONFIDENCE = 0.7;

const openAIRawDreamMemorySchema = z
  .object({
    id: z.string().min(1).nullable(),
    text: z.string().min(1),
    importance: z.number().min(0).max(1),
    topic: z.string().min(1).nullable(),
    kind: z.string().min(1).nullable(),
    entities: z.array(z.string().min(1)),
    confidence: z.number().min(0).max(1).nullable(),
    sourceText: z.string().min(1).nullable(),
    cluster: z.string().min(1).nullable(),
    status: z.enum(["active", "superseded"]).nullable(),
    supersedes: z.array(z.string().min(1)),
    sourceMemoryIds: z.array(z.string().min(1)),
    region: z.enum(["prefrontal", "hippocampus", "temporal"])
  })
  .strict();

const openAIRawDreamOperationSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(["merge", "supersede", "insight"]),
    sourceIds: z.array(z.string().min(1)),
    result: openAIRawDreamMemorySchema.nullable(),
    supersedeIds: z.array(z.string().min(1)),
    reason: z.string().min(1),
    confidence: z.number().min(0).max(1)
  })
  .strict();

const openAIRawDreamProposalSchema = z
  .object({
    status: z.enum(["proposed", "skipped"]),
    reason: z.string().min(1),
    operations: z.array(openAIRawDreamOperationSchema)
  })
  .strict();

export type OpenAIDreamPlannerOptions = {
  apiKey?: string;
  fetcher?: typeof fetch;
  minConfidence?: number;
  model?: string;
};

export class OpenAIDreamPlanner implements DreamPlanner {
  readonly provider = "llm" as const;
  private readonly apiKey?: string;
  private readonly fetcher: typeof fetch;
  private readonly minConfidence: number;
  private readonly model: string;

  constructor(options: OpenAIDreamPlannerOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    this.fetcher = options.fetcher ?? fetch;
    this.minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    this.model =
      options.model ??
      process.env.OPENAI_DREAM_PLANNER_MODEL ??
      process.env.OPENAI_MEMORY_PLANNER_MODEL ??
      process.env.OPENAI_MODEL ??
      DEFAULT_OPENAI_DREAM_PLANNER_MODEL;
  }

  async decide(input: DreamPlanningInput): Promise<DreamProposal> {
    if (!this.apiKey) {
      throw new DreamPlannerFallbackError("OpenAI dream planner is enabled but OPENAI_API_KEY is missing.");
    }

    const eligibleMemories = input.memories.filter((memory) => memory.status !== "superseded");
    if (eligibleMemories.length < 3) {
      throw new DreamPlannerFallbackError("OpenAI dream planner needs at least three active memories.");
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
          instructions: buildDreamPlannerInstructions(),
          input: buildDreamPlannerPrompt(eligibleMemories),
          max_output_tokens: 900,
          text: {
            format: {
              type: "json_schema",
              name: "engram_dream_proposal",
              strict: true,
              schema: openAIDreamProposalJsonSchema
            }
          }
        })
      });
    } catch (error) {
      throw new DreamPlannerFallbackError(`OpenAI dream planner request failed: ${formatError(error)}.`);
    }

    if (!response.ok) {
      throw new DreamPlannerFallbackError(`OpenAI dream planner returned HTTP ${response.status}.`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new DreamPlannerFallbackError(`OpenAI dream planner response was not JSON: ${formatError(error)}.`);
    }

    const text = extractResponseText(payload);
    if (!text) {
      throw new DreamPlannerFallbackError("OpenAI dream planner response did not include JSON text.");
    }

    let proposal: DreamProposal;
    try {
      proposal = parseOpenAIDreamProposal(text, input);
    } catch (error) {
      throw new DreamPlannerFallbackError(`OpenAI dream planner output failed validation: ${formatError(error)}.`);
    }

    const confidence = proposalConfidence(proposal);
    if (confidence < this.minConfidence) {
      throw new DreamPlannerFallbackError(
        `OpenAI dream planner confidence ${confidence.toFixed(2)} was below ${this.minConfidence.toFixed(2)}.`
      );
    }

    return proposal;
  }
}

export function parseOpenAIDreamProposal(outputText: string, input: DreamPlanningInput): DreamProposal {
  const raw = openAIRawDreamProposalSchema.parse(JSON.parse(outputText));
  const now = toIsoDate(input.now);
  const eligibleMemories = eligibleMemoryList(input.memories);

  if (raw.status === "skipped") {
    if (raw.operations.length > 0) {
      throw new Error("Skipped dream proposals cannot include operations.");
    }

    return parseDreamProposal({
      id: proposalId(now, "skip"),
      provider: "llm",
      status: "skipped",
      reason: raw.reason,
      operations: [],
      created_at: now
    });
  }

  if (raw.operations.length === 0) {
    throw new Error("Proposed dream proposals must include at least one operation.");
  }

  validateProposalIds(raw.operations, input.memories);

  const reservedMemoryIds = new Set(input.memories.map((memory) => memory.id));
  const operations = raw.operations.map((operation) =>
    normalizeOperation(operation, eligibleMemories, now, reservedMemoryIds)
  );

  return parseDreamProposal({
    id: proposalId(now, operations[0]?.type ?? "proposal"),
    provider: "llm",
    status: "proposed",
    reason: raw.reason,
    operations,
    created_at: now
  });
}

function normalizeOperation(
  raw: z.infer<typeof openAIRawDreamOperationSchema>,
  eligibleMemories: EngramMemory[],
  now: string,
  reservedMemoryIds: Set<string>
): DreamOperation {
  const sourceMemories = validateOperation(raw, eligibleMemories);
  const sourceIds = sourceMemories.map((memory) => memory.id);

  return {
    id: raw.id,
    type: raw.type,
    sourceIds,
    result: raw.result && (raw.type === "merge" || raw.type === "insight")
      ? normalizeDreamMemory(raw.result, raw.type, sourceIds, now, reservedMemoryIds)
      : undefined,
    supersedeIds: normalizedSupersedeIds(raw),
    reason: raw.reason,
    confidence: raw.confidence
  };
}

function normalizeDreamMemory(
  raw: z.infer<typeof openAIRawDreamMemorySchema>,
  operationType: "merge" | "insight",
  sourceIds: string[],
  now: string,
  reservedMemoryIds: Set<string>
): EngramMemory {
  const id = createServerOwnedMemoryId(operationType, reservedMemoryIds);

  return {
    id,
    text: raw.text,
    importance: raw.importance,
    topic: raw.topic ?? undefined,
    kind: "semantic",
    entities: raw.entities.length > 0 ? raw.entities : undefined,
    confidence: raw.confidence ?? undefined,
    sourceText: raw.sourceText ?? undefined,
    cluster: raw.cluster ?? undefined,
    status: "active",
    supersedes: operationType === "merge" ? sourceIds : undefined,
    sourceMemoryIds: sourceIds,
    region: "temporal",
    created_at: now,
    access_count: 0
  };
}

function validateProposalIds(
  operations: Array<z.infer<typeof openAIRawDreamOperationSchema>>,
  memories: EngramMemory[]
) {
  const operationIds = operations.map((operation) => operation.id);
  if (new Set(operationIds).size !== operationIds.length) {
    throw new Error("Dream operation ids must be unique.");
  }

  const existingMemoryIds = new Set(memories.map((memory) => memory.id));
  const claimedResultIds = operations.flatMap((operation) =>
    operation.result?.id ? [operation.result.id] : []
  );

  if (new Set(claimedResultIds).size !== claimedResultIds.length) {
    throw new Error("Model-proposed dream result ids must be unique.");
  }

  const collidingResultId = claimedResultIds.find((id) => existingMemoryIds.has(id));
  if (collidingResultId) {
    throw new Error(`Model-proposed dream result id "${collidingResultId}" collides with an existing memory.`);
  }
}

function validateOperation(
  raw: z.infer<typeof openAIRawDreamOperationSchema>,
  eligibleMemories: EngramMemory[]
): EngramMemory[] {
  const activeById = new Map(eligibleMemories.map((memory) => [memory.id, memory]));
  const allSelectedIds = [...raw.sourceIds, ...raw.supersedeIds];

  if (new Set(raw.sourceIds).size !== raw.sourceIds.length) {
    throw new Error("Dream operation source ids must be unique.");
  }

  if (new Set(raw.supersedeIds).size !== raw.supersedeIds.length) {
    throw new Error("Dream operation supersede ids must be unique.");
  }

  const ineligibleId = allSelectedIds.find((id) => !activeById.has(id));
  if (ineligibleId) {
    throw new Error(`Selected dream memory id "${ineligibleId}" was not eligible.`);
  }

  const sourceMemories = raw.sourceIds.map((id) => activeById.get(id)).filter(isEngramMemory);

  if (raw.type === "merge" && raw.sourceIds.length < 2) {
    throw new Error("Dream merge operations require at least two source ids.");
  }

  if (raw.type === "supersede" && raw.supersedeIds.length < 1) {
    throw new Error("Dream supersede operations require supersede ids.");
  }

  if (raw.type === "insight" && raw.sourceIds.length < 3) {
    throw new Error("Dream insight operations require at least three source ids.");
  }

  const overlap = raw.sourceIds.find((id) => raw.supersedeIds.includes(id));
  if (overlap && raw.type === "supersede") {
    throw new Error(`Dream supersede source id "${overlap}" cannot also be superseded.`);
  }

  if ((raw.type === "merge" || raw.type === "insight") && !raw.result) {
    throw new Error(`Dream ${raw.type} operations require a result memory.`);
  }

  if (raw.type === "supersede" && raw.result) {
    throw new Error("Dream supersede operations cannot create a result memory.");
  }

  if (raw.type === "merge") {
    if (sourceMemories.some((memory) => memory.region !== "hippocampus")) {
      throw new Error("Dream merge sources must be active hippocampus memories.");
    }
    assertSameIdSet(raw.supersedeIds, raw.sourceIds, "Dream merge supersede ids must exactly match source ids.");
    assertRelatedSourceSet(sourceMemories, "merge");
  }

  if (raw.type === "insight") {
    if (raw.supersedeIds.length > 0) {
      throw new Error("Dream insight operations cannot supersede source memories.");
    }
    assertRelatedSourceSet(sourceMemories, "insight");
  }

  if (raw.type === "supersede") {
    const targetMemories = raw.supersedeIds.map((id) => activeById.get(id)).filter(isEngramMemory);
    const unrelatedTarget = targetMemories.find(
      (target) => !sourceMemories.some((source) => shareMemorySignal(source, target, true))
    );
    if (unrelatedTarget) {
      throw new Error(`Dream supersede target "${unrelatedTarget.id}" is unrelated to its source memories.`);
    }
  }

  if (raw.result) {
    assertSameIdSet(
      raw.result.sourceMemoryIds,
      raw.sourceIds,
      `Dream ${raw.type} result sourceMemoryIds must exactly match source ids.`
    );

    if (raw.type === "merge" && raw.result.supersedes.length > 0) {
      assertSameIdSet(
        raw.result.supersedes,
        raw.sourceIds,
        "Dream merge result supersedes must be empty or exactly match source ids."
      );
    }

    if (raw.type === "insight" && raw.result.supersedes.length > 0) {
      throw new Error("Dream insight result cannot supersede source memories.");
    }
  }

  return sourceMemories;
}

function normalizedSupersedeIds(raw: z.infer<typeof openAIRawDreamOperationSchema>) {
  if (raw.type === "merge") return raw.sourceIds;
  if (raw.type === "supersede") return raw.supersedeIds;
  return undefined;
}

function assertSameIdSet(actual: string[], expected: string[], message: string) {
  if (new Set(actual).size !== actual.length || new Set(expected).size !== expected.length) {
    throw new Error(message);
  }

  const actualIds = actual.slice().sort();
  const expectedIds = expected.slice().sort();
  if (actualIds.length !== expectedIds.length || actualIds.some((id, index) => id !== expectedIds[index])) {
    throw new Error(message);
  }
}

function assertRelatedSourceSet(memories: EngramMemory[], operation: "merge" | "insight") {
  const first = memories[0];
  if (!first) {
    throw new Error(`Dream ${operation} source memories do not share a supported memory signal.`);
  }

  let sharedSignals = memorySignals(first, operation === "insight");
  memories.slice(1).forEach((memory) => {
    const candidateSignals = memorySignals(memory, operation === "insight");
    sharedSignals = new Set([...sharedSignals].filter((signal) => candidateSignals.has(signal)));
  });

  if (sharedSignals.size === 0) {
    throw new Error(`Dream ${operation} source memories do not share a supported memory signal.`);
  }
}

function shareMemorySignal(left: EngramMemory, right: EngramMemory, includeTopic: boolean) {
  const leftSignals = memorySignals(left, includeTopic);
  for (const signal of memorySignals(right, includeTopic)) {
    if (leftSignals.has(signal)) return true;
  }
  return false;
}

function memorySignals(memory: EngramMemory, includeTopic: boolean) {
  const signals = new Set<string>();
  const cluster = normalizeSignal(memory.cluster);
  if (cluster) signals.add(`cluster:${cluster}`);
  (memory.entities ?? []).forEach((entity) => {
    const normalized = normalizeSignal(entity);
    if (normalized) signals.add(`entity:${normalized}`);
  });
  if (includeTopic) {
    const topic = normalizeSignal(memory.topic);
    if (topic) signals.add(`topic:${topic}`);
  }
  return signals;
}

function normalizeSignal(value: string | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

function eligibleMemoryList(memories: EngramMemory[]) {
  return memories.filter((memory) => memory.status !== "superseded").slice(-40);
}

function createServerOwnedMemoryId(operationType: "merge" | "insight", reservedIds: Set<string>) {
  let id: string;
  do {
    id = `dream-result-${operationType}-${randomUUID()}`;
  } while (reservedIds.has(id));
  reservedIds.add(id);
  return id;
}

function isEngramMemory(memory: EngramMemory | undefined): memory is EngramMemory {
  return Boolean(memory);
}

function proposalConfidence(proposal: DreamProposal) {
  if (proposal.status === "skipped") return 1;
  return Math.min(1, ...proposal.operations.map((operation) => operation.confidence));
}

function buildDreamPlannerInstructions() {
  return [
    "You are Engram's dream-mode planner.",
    "Plan offline memory operations over active memories only.",
    "Use merge for duplicate or tightly related same-topic hippocampus memories.",
    "Use supersede for obvious conflicts where a newer active memory replaces older active memories.",
    "Use insight for recurring patterns supported by at least three active memories.",
    "Skip when there is no technically honest operation.",
    "Never invent source ids. Use only ids from the prompt.",
    "For merge and insight results, set id to null and make sourceMemoryIds exactly match sourceIds.",
    "Merge only active hippocampus memories and set supersedeIds to exactly the merged sourceIds.",
    "Insight operations must not supersede their sources. Supersede operations must not return a result memory.",
    "Engram assigns result ids, region, status, kind, lineage, and supersession metadata after validation.",
    "Return only JSON that matches the provided schema."
  ].join(" ");
}

function buildDreamPlannerPrompt(memories: EngramMemory[]) {
  const memoryLines = memories
    .slice(-40)
    .map(
      (memory) =>
        `- id: ${memory.id}\n  text: ${memory.text}\n  region: ${memory.region}\n  topic: ${memory.topic ?? "unknown"}\n  kind: ${memory.kind ?? "unknown"}\n  cluster: ${memory.cluster ?? "unknown"}\n  entities: ${(memory.entities ?? []).join(", ") || "none"}\n  supersedes: ${(memory.supersedes ?? []).join(", ") || "none"}\n  created_at: ${memory.created_at}`
    )
    .join("\n");

  return `Active memories:\n${memoryLines}`;
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

function proposalId(now: string, suffix: string) {
  return `dream-${now.replace(/\D/g, "").slice(0, 14)}-${suffix}`;
}

function toIsoDate(now: Date | string | undefined) {
  if (now instanceof Date) return now.toISOString();
  if (typeof now === "string") return new Date(now).toISOString();
  return new Date().toISOString();
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const openAIDreamMemoryJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "text",
    "importance",
    "topic",
    "kind",
    "entities",
    "confidence",
    "sourceText",
    "cluster",
    "status",
    "supersedes",
    "sourceMemoryIds",
    "region"
  ],
  properties: {
    id: { type: ["string", "null"] },
    text: { type: "string" },
    importance: { type: "number", minimum: 0, maximum: 1 },
    topic: { type: ["string", "null"] },
    kind: { type: ["string", "null"] },
    entities: { type: "array", items: { type: "string" } },
    confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
    sourceText: { type: ["string", "null"] },
    cluster: { type: ["string", "null"] },
    status: { type: ["string", "null"], enum: ["active", "superseded", null] },
    supersedes: { type: "array", items: { type: "string" } },
    sourceMemoryIds: { type: "array", items: { type: "string" } },
    region: { type: "string", enum: ["prefrontal", "hippocampus", "temporal"] }
  }
} as const;

const openAIDreamOperationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "type", "sourceIds", "result", "supersedeIds", "reason", "confidence"],
  properties: {
    id: { type: "string" },
    type: { type: "string", enum: ["merge", "supersede", "insight"] },
    sourceIds: { type: "array", items: { type: "string" } },
    result: { anyOf: [openAIDreamMemoryJsonSchema, { type: "null" }] },
    supersedeIds: { type: "array", items: { type: "string" } },
    reason: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
} as const;

const openAIDreamProposalJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "reason", "operations"],
  properties: {
    status: { type: "string", enum: ["proposed", "skipped"] },
    reason: { type: "string" },
    operations: { type: "array", items: openAIDreamOperationJsonSchema }
  }
} as const;
