import type { TurnRecord } from "@/lib/evidence/types";
import { buildMemoryIncident } from "@/lib/incidents/build";
import type {
  MemoryIncident,
  MemoryIncidentEvidenceOrigins
} from "@/lib/incidents/types";
import { buildTraceCheckpoints } from "@/lib/lab/checkpoints";
import type { MemoryCheckpoint } from "@/lib/lab/types";
import type {
  JsonValue,
  NormalizedTrace,
  NormalizedTraceStep,
  TraceMemoryMapping
} from "@/lib/traces/types";
import type { EngramEvent, EngramMemory } from "@/types";

export class IncidentTraceImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncidentTraceImportError";
  }
}

type BuildMemoryIncidentFromTraceOptions = {
  expectedAnswer: string;
  title?: string;
};

export function buildMemoryIncidentFromTrace(
  trace: NormalizedTrace,
  options: BuildMemoryIncidentFromTraceOptions
): MemoryIncident {
  const expectedAnswer = options.expectedAnswer.trim();
  if (!expectedAnswer) {
    throw new IncidentTraceImportError("Describe the expected answer before importing this incident.");
  }

  const answerStepIndex = findAnswerStepIndex(trace.steps);
  if (answerStepIndex < 0) {
    throw new IncidentTraceImportError(
      "This trace has no recorded model answer. It can still be inspected in Observe mode, but it cannot be replayed as an incident."
    );
  }

  const answerStep = trace.steps[answerStepIndex]!;
  const question = extractTurnText(answerStep.input, "user");
  const answer = extractTurnText(answerStep.output, "assistant");
  if (!question || !answer) {
    throw new IncidentTraceImportError(
      "Engram found a model step but could not identify both its user question and assistant answer. Record those fields explicitly to create an incident."
    );
  }

  const baseCheckpoint = buildTraceCheckpoints(trace)[answerStepIndex];
  if (!baseCheckpoint) {
    throw new IncidentTraceImportError("The trace could not be converted into a replay checkpoint.");
  }

  const retrieve = latestEvent(baseCheckpoint.events, "retrieve");
  const retrievedMemories = resolveRetrievedMemories(
    baseCheckpoint.memories,
    retrieve?.accessed ?? [],
    retrieve?.ids ?? []
  );
  const startedAt = answerStep.startedAt ?? baseCheckpoint.createdAt;
  const completedAt = answerStep.endedAt ?? startedAt;
  const record: TurnRecord = {
    version: 1,
    id: `turn-${trace.trace.id}-${answerStep.id}`,
    sessionId: trace.trace.groupId ?? trace.trace.id,
    startedAt,
    completedAt,
    userMessage: question,
    history: [],
    retrievedMemories,
    ...(retrieve?.retrieval ? { retrieval: structuredClone(retrieve.retrieval) } : {}),
    events: structuredClone(baseCheckpoint.events),
    originalAnswer: answer,
    provider: {
      id: trace.trace.source.provider.toLocaleLowerCase().includes("openai") ? "openai" : "demo"
    }
  };
  const checkpoint: MemoryCheckpoint = {
    ...structuredClone(baseCheckpoint),
    label: compactLabel(question),
    query: retrieve?.query ?? question,
    answer,
    turnRecord: record
  };
  const evidenceOrigins = traceEvidenceOrigins(trace.steps.slice(0, answerStepIndex + 1));

  return buildMemoryIncident({
    checkpoint,
    expectedAnswer,
    evidenceOrigins,
    title: options.title?.trim() || `Unexpected answer in ${trace.trace.name}`,
    id: `incident-${trace.trace.id}-${answerStep.id}`
  });
}

function findAnswerStepIndex(steps: NormalizedTraceStep[]): number {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (!step || (step.kind !== "model" && step.kind !== "message")) continue;
    if (extractTurnText(step.output, "assistant")) return index;
  }
  return -1;
}

function extractTurnText(value: JsonValue | undefined, role: "user" | "assistant"): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return extractTurnText(JSON.parse(trimmed) as JsonValue, role) ?? trimmed;
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const matchingRole = [...value].reverse().find((item) =>
      isJsonRecord(item) && typeof item.role === "string" && item.role === role
    );
    if (matchingRole) return extractTurnText(matchingRole, role);
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const text = extractTurnText(value[index], role);
      if (text) return text;
    }
    return undefined;
  }

  if (typeof value.role === "string" && value.role !== role) return undefined;
  const preferredKeys = role === "assistant"
    ? ["output_text", "answer", "text", "content", "message", "output", "response"]
    : ["query", "prompt", "text", "content", "message", "input"];
  for (const key of preferredKeys) {
    const text = extractTurnText(value[key], role);
    if (text) return text;
  }
  return undefined;
}

function traceEvidenceOrigins(steps: NormalizedTraceStep[]): MemoryIncidentEvidenceOrigins {
  const mappings = steps.flatMap((step) => step.memoryMappings);
  return {
    memory_state: mappingOrigin(mappings, ["init", "store", "consolidate"]),
    retrieval: mappingOrigin(mappings, ["retrieve"]),
    active_context: mappingOrigin(mappings, ["load", "fire"]),
    answer: "observed"
  };
}

function mappingOrigin(
  mappings: TraceMemoryMapping[],
  eventTypes: EngramEvent["type"][]
): "observed" | "mapped" | "unavailable" {
  const relevant = mappings.filter(
    (mapping): mapping is Extract<TraceMemoryMapping, { event: EngramEvent }> =>
      mapping.event !== null && eventTypes.includes(mapping.event.type)
  );
  if (relevant.length === 0) return "unavailable";
  return relevant.every((mapping) => mapping.provenance === "observed") ? "observed" : "mapped";
}

function resolveRetrievedMemories(
  memories: EngramMemory[],
  accessed: EngramMemory[],
  ids: string[]
): EngramMemory[] {
  const byId = new Map([...memories, ...accessed].map((memory) => [memory.id, memory]));
  return ids.flatMap((id) => {
    const memory = byId.get(id);
    return memory ? [structuredClone(memory)] : [];
  });
}

function latestEvent<T extends EngramEvent["type"]>(
  events: EngramEvent[],
  type: T
): Extract<EngramEvent, { type: T }> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === type) return event as Extract<EngramEvent, { type: T }>;
  }
  return undefined;
}

function isJsonRecord(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactLabel(value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 62 ? `${trimmed.slice(0, 59)}...` : trimmed;
}
