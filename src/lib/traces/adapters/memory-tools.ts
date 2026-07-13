import { parseEngramEvent } from "@/lib/events/schema";
import type { TraceMemoryMapping } from "@/lib/traces/types";
import type { EngramMemory } from "@/types";
import {
  asArray,
  asRecord,
  deterministicTimestamp,
  firstDefined,
  firstNumber,
  firstString,
  isRecord,
  parseJsonValue,
  stableId,
  stringList
} from "@/lib/traces/adapters/helpers";

const MEMORY_TOOL_NAMES = new Set([
  "store_memory",
  "retrieve_memory",
  "update_memory",
  "consolidate_memories"
]);

type MappingContext = {
  stepId: string;
  toolName: string;
  input: unknown;
  output: unknown;
  timestamp?: string;
  sourcePath: string;
};

export function isMemoryTool(name: string): boolean {
  return MEMORY_TOOL_NAMES.has(name);
}

function clampImportance(value: number | undefined): number {
  return Math.max(0, Math.min(1, value ?? 0.5));
}

function memoryText(record: Record<string, unknown>, fallback: string): string {
  return firstString(
    record.text,
    record.content,
    record.fact,
    record.value,
    record.summary,
    record.memory
  ) ?? fallback;
}

function buildMemory(
  candidate: unknown,
  context: MappingContext,
  region: EngramMemory["region"],
  fallbackText: string
): EngramMemory {
  const record = asRecord(parseJsonValue(candidate));
  const seedText = memoryText(record, fallbackText);
  const id = firstString(record.id, record.memory_id, record.memoryId) ??
    stableId("imported-memory", `${context.stepId}:${context.toolName}:${seedText}`);
  const createdAt = deterministicTimestamp(
    firstDefined(record.created_at, record.createdAt, context.timestamp)
  );
  const entities = stringList(record.entities);
  const supersedes = stringList(firstDefined(record.supersedes, record.supersede_ids, record.supersedeIds));
  const sourceMemoryIds = stringList(
    firstDefined(record.sourceMemoryIds, record.source_memory_ids, record.sourceIds, record.source_ids)
  );

  return {
    id,
    text: seedText,
    importance: clampImportance(firstNumber(record.importance, record.score)),
    region,
    created_at: createdAt,
    access_count: Math.max(0, Math.trunc(firstNumber(record.access_count, record.accessCount) ?? 0)),
    ...(firstString(record.topic) ? { topic: firstString(record.topic) } : {}),
    ...(firstString(record.kind) ? { kind: firstString(record.kind) } : {}),
    ...(entities.length > 0 ? { entities } : {}),
    ...(firstNumber(record.confidence) !== undefined
      ? { confidence: clampImportance(firstNumber(record.confidence)) }
      : {}),
    ...(supersedes.length > 0 ? { supersedes } : {}),
    ...(sourceMemoryIds.length > 0 ? { sourceMemoryIds } : {})
  };
}

function candidateMemory(input: Record<string, unknown>, output: Record<string, unknown>): unknown {
  const outputLooksLikeMemory = firstString(
    output.text,
    output.content,
    output.fact,
    output.value,
    output.summary
  );
  return firstDefined(output.memory, output.result, outputLooksLikeMemory ? output : undefined, input.memory, input);
}

function resultIds(output: Record<string, unknown>, input: Record<string, unknown>, rawOutput: unknown): string[] {
  const direct = stringList(firstDefined(output.ids, output.memory_ids, output.memoryIds));
  if (direct.length > 0) return direct;

  const collections = firstDefined(output.memories, output.results, output.matches);
  const fromCollections = stringList(collections);
  if (fromCollections.length > 0) return fromCollections;
  const fromRawOutput = stringList(rawOutput);
  if (fromRawOutput.length > 0) return fromRawOutput;
  return stringList(firstDefined(input.ids, input.memory_ids, input.memoryIds));
}

function accessedMemories(
  output: Record<string, unknown>,
  rawOutput: unknown,
  context: MappingContext
): EngramMemory[] {
  const candidates = asArray(firstDefined(output.memories, output.results, output.matches, rawOutput));
  return candidates.flatMap((candidate, index) => {
    if (!isRecord(candidate)) return [];
    const nested = isRecord(candidate.memory) ? candidate.memory : candidate;
    const hasText = firstString(nested.text, nested.content, nested.fact, nested.value, nested.summary);
    if (!hasText) return [];
    return [buildMemory(nested, { ...context, stepId: `${context.stepId}-${index}` }, "hippocampus", hasText)];
  });
}

function observedCustomMapping(context: MappingContext): TraceMemoryMapping[] {
  const candidates = [
    parseJsonValue(context.input),
    parseJsonValue(context.output),
    asRecord(parseJsonValue(context.input)).event,
    asRecord(parseJsonValue(context.output)).event
  ];

  for (const candidate of candidates) {
    try {
      const event = parseEngramEvent(candidate);
      return [{
        provenance: "observed",
        event,
        sourcePath: context.sourcePath,
        note: "Observed as a native Engram memory event in the imported trace."
      }];
    } catch {
      // Keep checking likely event locations before treating the custom span as non-memory activity.
    }
  }
  return [];
}

export function mapMemoryOperation(context: MappingContext): TraceMemoryMapping[] {
  if (context.toolName === "engram.memory") return observedCustomMapping(context);
  if (!isMemoryTool(context.toolName)) return [];

  const parsedInput = parseJsonValue(context.input);
  const parsedOutput = parseJsonValue(context.output);
  const input = asRecord(parsedInput);
  const output = asRecord(parsedOutput);
  const defaultsNote = "Missing fields use deterministic import defaults: stable id, importance 0.5, access count 0, source timestamp, and hippocampus for new memories.";

  if (context.toolName === "store_memory" || context.toolName === "update_memory") {
    let memory = buildMemory(
      candidateMemory(input, output),
      context,
      "hippocampus",
      "Imported memory"
    );
    if (context.toolName === "update_memory") {
      const supersedes = stringList(firstDefined(
        input.supersedes,
        input.supersede_ids,
        input.supersedeIds,
        input.memory_id,
        input.memoryId,
        input.id
      ));
      if (supersedes.length > 0 && !memory.supersedes?.length) memory.supersedes = supersedes;
      if (supersedes.includes(memory.id)) {
        memory = {
          ...memory,
          id: stableId("imported-memory", `${context.stepId}:replacement:${memory.text}`)
        };
      }
    }
    return [{
      provenance: "mapped",
      event: parseEngramEvent({ type: "store", memory }),
      sourcePath: context.sourcePath,
      note: `${context.toolName} was mapped to a store event. ${defaultsNote}`
    }];
  }

  if (context.toolName === "retrieve_memory") {
    const query = firstString(input.query, input.text, input.search, input.prompt) ?? "Imported memory query";
    const accessed = accessedMemories(output, parsedOutput, context);
    const ids = resultIds(output, input, parsedOutput);
    const resolvedIds = ids.length > 0 ? ids : accessed.map((memory) => memory.id);
    return [{
      provenance: "mapped",
      event: parseEngramEvent({
        type: "retrieve",
        query,
        ids: resolvedIds,
        ...(accessed.length > 0 ? { accessed } : {})
      }),
      sourcePath: context.sourcePath,
      note: `retrieve_memory was mapped using returned memory ids when available. ${defaultsNote}`
    }];
  }

  const removed = stringList(firstDefined(
    input.ids,
    input.memory_ids,
    input.memoryIds,
    input.source_ids,
    input.sourceIds,
    output.removed
  ));
  const outputLooksLikeMemory = firstString(output.text, output.content, output.summary);
  const addedCandidate = firstDefined(
    output.added,
    output.memory,
    output.result,
    outputLooksLikeMemory ? output : undefined,
    input.result,
    input.summary
  );
  const added = buildMemory(addedCandidate, context, "temporal", "Imported consolidated memory");
  if (!added.sourceMemoryIds?.length && removed.length > 0) added.sourceMemoryIds = removed;
  return [{
    provenance: "mapped",
    event: parseEngramEvent({ type: "consolidate", removed, added }),
    sourcePath: context.sourcePath,
    note: `consolidate_memories was mapped to a temporal memory and its source ids. ${defaultsNote}`
  }];
}
