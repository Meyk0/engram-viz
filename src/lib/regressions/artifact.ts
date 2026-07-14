import type { TurnRecord } from "@/lib/evidence/types";
import type { MemoryBranchReplayResult, MemoryCheckpoint } from "@/lib/lab/types";
import { memoryRegressionArtifactSchema } from "@/lib/regressions/schema";
import type {
  MemoryRegressionArtifact,
  MemoryRegressionAssertionsInput,
  MemoryRegressionObservation,
  MemoryRegressionReplayResult
} from "@/lib/regressions/types";
import type { ChatMessage, EngramMemory } from "@/types";

export const MEMORY_REGRESSION_CAVEAT =
  "This artifact captures observable inputs, memory context, and outputs. A passing or changed replay is behavioral evidence, not proof of causality or reproduction of hidden model state.";

export function createMemoryRegressionArtifact(input: {
  checkpoint: MemoryCheckpoint;
  title?: string;
  description?: string;
  id?: string;
  createdAt?: string;
  memoryFixture?: readonly EngramMemory[];
  turnInput?: {
    userMessage: string;
    history: readonly ChatMessage[];
  };
  replayResults?: {
    baseline?: MemoryRegressionReplayResult;
    treatment?: MemoryRegressionReplayResult;
  };
  assertions?: MemoryRegressionAssertionsInput;
  metadata?: Readonly<Record<string, string>>;
}): MemoryRegressionArtifact {
  const record = input.checkpoint.turnRecord;
  const turnInput = resolveTurnInput(input.checkpoint, record, input.turnInput);
  const memories = structuredClone(input.memoryFixture ?? input.checkpoint.memories);
  const recorded = recordedObservation(input.checkpoint, record);
  const baseline = input.replayResults?.baseline
    ? replayObservation(input.replayResults.baseline)
    : undefined;
  const treatment = input.replayResults?.treatment
    ? replayObservation(input.replayResults.treatment)
    : undefined;
  const replayed = Boolean(baseline || treatment);
  const defaultMustRetrieve = treatment?.memoryContext.retrievalObserved
    ? treatment.memoryContext.retrievedMemoryIds
    : recorded?.memoryContext.retrievalObserved
      ? recorded.memoryContext.retrievedMemoryIds
      : [];
  const assertions = {
    retrieval: {
      mustRetrieve: normalizeIds(
        input.assertions?.retrieval?.mustRetrieve ?? defaultMustRetrieve
      ),
      mustNotRetrieve: normalizeIds(input.assertions?.retrieval?.mustNotRetrieve ?? []),
      ...(input.assertions?.retrieval?.maxLoaded === undefined
        ? {}
        : { maxLoaded: input.assertions.retrieval.maxLoaded })
    },
    answer: {
      match: "case-insensitive-substring" as const,
      contains: normalizePhrases(input.assertions?.answer?.contains ?? []),
      notContains: normalizePhrases(input.assertions?.answer?.notContains ?? [])
    }
  };
  const createdAt = input.createdAt ?? input.checkpoint.createdAt;
  const title = input.title?.trim() || input.checkpoint.label.trim() || "Memory regression";
  const id = input.id?.trim() || `memory-regression-${stableHash(JSON.stringify({
    checkpointId: input.checkpoint.id,
    title,
    assertions
  }))}`;

  const artifact = {
    kind: "engram.memory-regression" as const,
    version: 1 as const,
    id,
    title,
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    createdAt,
    provenance: {
      generator: {
        name: "engram" as const,
        contractVersion: 1 as const
      },
      source: {
        kind: "checkpoint" as const,
        checkpointVersion: 1 as const,
        checkpointId: input.checkpoint.id,
        checkpointSource: input.checkpoint.source,
        sourceId: input.checkpoint.sourceId,
        sourceCreatedAt: input.checkpoint.createdAt,
        index: input.checkpoint.index
      },
      ...(record ? {
        turn: {
          recordId: record.id,
          sessionId: record.sessionId,
          provider: structuredClone(record.provider)
        }
      } : {}),
      ...(input.metadata && Object.keys(input.metadata).length > 0
        ? { metadata: structuredClone(input.metadata) }
        : {})
    },
    fixture: {
      memories,
      input: turnInput
    },
    evidence: {
      basis: recorded
        ? replayed ? "recorded-and-replayed" as const : "recorded" as const
        : replayed ? "replayed" as const : "checkpoint-state" as const,
      claim: "behavioral-observation" as const,
      causalClaim: false as const,
      caveat: MEMORY_REGRESSION_CAVEAT,
      ...(recorded ? { recorded } : {}),
      ...(baseline ? { baseline } : {}),
      ...(treatment ? { treatment } : {})
    },
    assertions
  };

  return deepFreeze(memoryRegressionArtifactSchema.parse(artifact));
}

export function replayResultsFromBranchReplay(
  result: MemoryBranchReplayResult
): {
  baseline: MemoryRegressionReplayResult;
  treatment: MemoryRegressionReplayResult;
} {
  const shared = {
    retrievalObserved: false,
    provider: structuredClone(result.provider),
    recordId: result.recordId,
    branchId: result.branchId,
    note: result.caveat
  };

  return {
    baseline: {
      ...shared,
      answer: result.baselineAnswer,
      loadedMemoryIds: [...result.baselineMemoryIds],
      runCount: result.comparison.baselineRuns
    },
    treatment: {
      ...shared,
      answer: result.branchAnswer,
      loadedMemoryIds: [...result.branchMemoryIds],
      runCount: result.comparison.counterfactualRuns
    }
  };
}

export function serializeMemoryRegressionArtifact(
  artifact: MemoryRegressionArtifact,
  indentation = 2
): string {
  const parsed = memoryRegressionArtifactSchema.parse(artifact);
  return JSON.stringify(parsed, null, indentation);
}

export function parseMemoryRegressionArtifact(serialized: string): MemoryRegressionArtifact {
  return deepFreeze(memoryRegressionArtifactSchema.parse(JSON.parse(serialized)));
}

function resolveTurnInput(
  checkpoint: MemoryCheckpoint,
  record: TurnRecord | undefined,
  override: { userMessage: string; history: readonly ChatMessage[] } | undefined
) {
  const userMessage = override?.userMessage ?? record?.userMessage ?? checkpoint.query;
  if (!userMessage?.trim()) {
    throw new Error("A regression artifact requires a recorded query or explicit turn input.");
  }

  return {
    userMessage: userMessage.trim(),
    history: structuredClone(override?.history ?? record?.history ?? [])
  };
}

function recordedObservation(
  checkpoint: MemoryCheckpoint,
  record: TurnRecord | undefined
): MemoryRegressionObservation | undefined {
  const answer = checkpoint.answer ?? record?.originalAnswer;
  if (answer === undefined) return undefined;

  const retrievedMemoryIds = record
    ? record.retrievedMemories.map((memory) => memory.id)
    : checkpoint.retrieval?.matches
      ?.filter((match) => match.selected)
      .map((match) => match.id) ?? [];
  const retrievalObserved = Boolean(
    record?.events.some((event) => event.type === "retrieve")
      || record?.retrieval
      || checkpoint.retrieval
  );

  return {
    evidence: "recorded",
    answer,
    memoryContext: {
      source: retrievalObserved ? "recorded-retrieval" : "unknown",
      retrievalObserved,
      retrievedMemoryIds: normalizeIds(retrievedMemoryIds),
      loadedMemoryIds: normalizeIds(checkpoint.loadedMemoryIds)
    },
    runCount: 1,
    ...(record ? {
      provider: structuredClone(record.provider),
      recordId: record.id
    } : {}),
    occurredAt: checkpoint.createdAt
  };
}

function replayObservation(result: MemoryRegressionReplayResult): MemoryRegressionObservation {
  const retrievalObserved = result.retrievalObserved ?? false;
  return {
    evidence: "replayed",
    answer: result.answer,
    memoryContext: {
      source: "replay-input",
      retrievalObserved,
      retrievedMemoryIds: normalizeIds(result.retrievedMemoryIds ?? []),
      loadedMemoryIds: normalizeIds(result.loadedMemoryIds ?? [])
    },
    runCount: result.runCount ?? 1,
    ...(result.provider ? { provider: structuredClone(result.provider) } : {}),
    ...(result.recordId ? { recordId: result.recordId } : {}),
    ...(result.branchId ? { branchId: result.branchId } : {}),
    ...(result.occurredAt ? { occurredAt: result.occurredAt } : {}),
    ...(result.note?.trim() ? { note: result.note.trim() } : {})
  };
}

function normalizeIds(values: readonly string[]): string[] {
  return unique(values.map((value) => value.trim()).filter(Boolean));
}

function normalizePhrases(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const trimmed = value.trim();
    const key = trimmed.toLocaleLowerCase();
    if (!trimmed || seen.has(key)) return [];
    seen.add(key);
    return [trimmed];
  });
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
