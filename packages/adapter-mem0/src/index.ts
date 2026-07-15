import type { CaptureMemory, EngramClient, EngramTurn } from "@engramviz/sdk";

type AnyMethod = (...args: never[]) => unknown;

export type Mem0Like = {
  add?: AnyMethod;
  search?: AnyMethod;
  update?: AnyMethod;
  delete?: AnyMethod;
  deleteAll?: AnyMethod;
  [key: string]: unknown;
};

export type Mem0MemoryRecord = {
  id: string;
  memory?: string;
  score?: number;
  metadata?: Record<string, unknown>;
  raw: Record<string, unknown>;
};

export type Mem0InstrumentationGap = {
  operation: "add" | "search" | "update" | "delete" | "deleteAll";
  reason: string;
  result?: unknown;
};

export type InstrumentMem0Options = {
  tier?: CaptureMemory["tier"];
  scope?: CaptureMemory["scope"];
  storeId?: string;
  selectedIds?: (records: readonly Mem0MemoryRecord[], result: unknown) => readonly string[];
  onInstrumentationGap?: (gap: Mem0InstrumentationGap) => void;
};

/**
 * Wraps both Mem0 Platform and OSS clients without importing a specific mem0ai build.
 * Unknown methods are passed through untouched.
 */
export function instrumentMem0<T extends object>(
  client: T,
  engram: EngramClient,
  options: InstrumentMem0Options = {}
): T {
  return new Proxy(client, {
    get(target, property, receiver) {
      const original = Reflect.get(target, property, receiver);
      if (typeof original !== "function" || typeof property !== "string") return original;
      if (!["add", "search", "update", "delete", "deleteAll"].includes(property)) {
        return original.bind(target);
      }
      return async (...args: unknown[]) => {
        const result = await original.apply(target, args);
        const turn = engram.activeTurn();
        if (!turn) return result;
        if (property === "add") await captureAdd(turn, result, options);
        if (property === "search") await captureSearch(turn, args, result, options);
        if (property === "update") await captureUpdate(turn, args, result, options);
        if (property === "delete") await captureDelete(turn, args, result, options);
        if (property === "deleteAll") gap(options, property, "Mem0 deleteAll does not expose the affected memory IDs.", result);
        return result;
      };
    }
  });
}

export function mem0MemoryRecords(result: unknown): Mem0MemoryRecord[] {
  return resultRows(result).flatMap((row) => {
    const id = stringValue(row.id) ?? stringValue(row.memory_id) ?? stringValue(row.memoryId);
    if (!id) return [];
    const memory = stringValue(row.memory) ?? stringValue(row.text) ?? stringValue(row.content);
    const metadata = recordValue(row.metadata);
    return [{
      id,
      ...(memory ? { memory } : {}),
      ...(numberValue(row.score) !== undefined ? { score: numberValue(row.score) } : {}),
      ...(metadata ? { metadata } : {}),
      raw: row
    }];
  });
}

export function mem0MemoryIds(result: unknown): string[] {
  return mem0MemoryRecords(result).map((record) => record.id);
}

async function captureAdd(turn: EngramTurn, result: unknown, options: InstrumentMem0Options) {
  const records = mem0MemoryRecords(result);
  if (records.length === 0) {
    const pending = isRecord(result) && (result.status === "PENDING" || typeof result.event_id === "string");
    gap(
      options,
      "add",
      pending
        ? "Mem0 Platform accepted an asynchronous add but did not expose the resulting memory IDs yet."
        : "Mem0 add returned no concrete memory IDs.",
      result
    );
    return;
  }
  for (const record of records) {
    const action = actionValue(record.raw);
    if (action === "DELETE") {
      await turn.delete([record.id], "Mem0 add pipeline deleted a memory", evidence("add", "Mem0 returned a DELETE action."));
    } else if (action === "UPDATE") {
      await turn.update(toCaptureMemory(record, options), {}, evidence("add", "Mem0 returned an UPDATE action."));
    } else {
      await turn.store(toCaptureMemory(record, options), evidence("add", "Mem0 returned a concrete memory record."));
    }
  }
}

async function captureSearch(
  turn: EngramTurn,
  args: unknown[],
  result: unknown,
  options: InstrumentMem0Options
) {
  const records = mem0MemoryRecords(result);
  if (records.length === 0) {
    await turn.retrieve({ query: stringValue(args[0]) ?? "", candidates: [], selectedIds: [] }, evidence("search"));
    return;
  }
  const selected = new Set(options.selectedIds?.(records, result) ?? records.map((record) => record.id));
  await turn.retrieve({
    query: stringValue(args[0]) ?? "",
    candidates: records.map((record, index) => ({
      memoryId: record.id,
      rank: index + 1,
      ...(record.score !== undefined ? { score: record.score } : {}),
      selected: selected.has(record.id)
    })),
    selectedIds: records.filter((record) => selected.has(record.id)).map((record) => record.id),
    limit: positiveInteger(findOptions(args)?.limit)
  }, evidence("search", "Ranks and scores are copied from the Mem0 search response."));
}

async function captureUpdate(
  turn: EngramTurn,
  args: unknown[],
  result: unknown,
  options: InstrumentMem0Options
) {
  const id = stringValue(args[0]) ?? mem0MemoryIds(result)[0];
  if (!id) {
    gap(options, "update", "Mem0 update returned without a memory ID.", result);
    return;
  }
  const record = mem0MemoryRecords(result).find((candidate) => candidate.id === id);
  const requested = isRecord(args[1])
    ? stringValue(args[1].text) ?? stringValue(args[1].memory)
    : stringValue(args[1]);
  await turn.update(toCaptureMemory(record ?? { id, ...(requested ? { memory: requested } : {}), raw: {} }, options), {}, evidence("update"));
}

async function captureDelete(
  turn: EngramTurn,
  args: unknown[],
  result: unknown,
  options: InstrumentMem0Options
) {
  const id = stringValue(args[0]) ?? mem0MemoryIds(result)[0];
  if (!id) {
    gap(options, "delete", "Mem0 delete returned without a memory ID.", result);
    return;
  }
  await turn.delete([id], "Mem0 delete completed", evidence("delete"));
}

function toCaptureMemory(record: Mem0MemoryRecord, options: InstrumentMem0Options): CaptureMemory {
  const createdAt = stringValue(record.raw.created_at) ?? stringValue(record.raw.createdAt);
  const metadata = sanitizeMetadata(record.metadata);
  return {
    id: record.id,
    ...(record.memory ? { content: record.memory } : {}),
    tier: options.tier ?? "episodic",
    scope: options.scope ?? "user",
    provider: "mem0",
    ...(options.storeId ? { storeId: options.storeId } : {}),
    ...((metadata || createdAt) ? { metadata: { ...(metadata ?? {}), ...(createdAt ? { createdAt } : {}) } } : {})
  };
}

function evidence(operation: string, note?: string) {
  return {
    level: "observed" as const,
    adapter: "mem0",
    sourcePath: `mem0.${operation} response`,
    ...(note ? { note } : {})
  };
}

function resultRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result.filter(isRecord);
  if (!isRecord(result)) return [];
  if (Array.isArray(result.results)) return result.results.filter(isRecord);
  if (isRecord(result.data) && Array.isArray(result.data.results)) return result.data.results.filter(isRecord);
  if (Array.isArray(result.data)) return result.data.filter(isRecord);
  return hasMemoryId(result) ? [result] : [];
}

function actionValue(row: Record<string, unknown>) {
  return (stringValue(row.event) ?? stringValue(row.action) ?? "ADD").toUpperCase();
}

function findOptions(args: unknown[]) {
  return args.find((arg): arg is Record<string, unknown> => isRecord(arg));
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function sanitizeMetadata(value: Record<string, unknown> | undefined) {
  if (!value) return undefined;
  return JSON.parse(JSON.stringify(value)) as Record<string, string | number | boolean | null>;
}

function gap(options: InstrumentMem0Options, operation: Mem0InstrumentationGap["operation"], reason: string, result?: unknown) {
  options.onInstrumentationGap?.({ operation, reason, ...(result !== undefined ? { result } : {}) });
}

function hasMemoryId(value: Record<string, unknown>) {
  return Boolean(stringValue(value.id) ?? stringValue(value.memory_id) ?? stringValue(value.memoryId));
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
