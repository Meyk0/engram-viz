import type { CaptureMemory, CaptureRetrieval, EngramClient, EngramTurn } from "@engramviz/sdk";

type AnyMethod = (...args: never[]) => unknown;

export type LangGraphStoreLike = {
  put?: AnyMethod;
  search?: AnyMethod;
  get?: AnyMethod;
  delete?: AnyMethod;
  batch?: AnyMethod;
  [key: string]: unknown;
};

export type LangGraphStoreItem = {
  namespace: string[];
  key: string;
  value: Record<string, unknown>;
  score?: number;
  createdAt?: string;
  updatedAt?: string;
  raw: Record<string, unknown>;
};

export type LangGraphPut = {
  namespace: string[];
  key: string;
  value: Record<string, unknown>;
  index?: false | string[];
};

export type LangGraphInstrumentationGap = {
  operation: "put" | "search" | "get" | "delete" | "batch";
  reason: string;
  result?: unknown;
};

export type InstrumentLangGraphStoreOptions = {
  tier?: CaptureMemory["tier"];
  scope?: CaptureMemory["scope"];
  storeId?: string;
  owner?: CaptureMemory["owner"] | ((item: Pick<LangGraphStoreItem, "namespace" | "key" | "value">) => CaptureMemory["owner"]);
  /** Declares selection only when the application actually selects Store results. */
  selectedIds?: (records: readonly LangGraphStoreItem[], result: unknown) => readonly string[];
  classifyPut?: "store" | "update" | ((put: LangGraphPut) => "store" | "update");
  content?: (item: Pick<LangGraphStoreItem, "namespace" | "key" | "value">) => CaptureMemory["content"];
  onInstrumentationGap?: (gap: LangGraphInstrumentationGap) => void;
};

/**
 * Wraps a LangGraph BaseStore-compatible object without importing LangGraph.
 * Unknown methods are passed through untouched.
 */
export function instrumentLangGraphStore<T extends object>(
  store: T,
  engram: EngramClient,
  options: InstrumentLangGraphStoreOptions = {}
): T {
  return new Proxy(store, {
    get(target, property, receiver) {
      const original = Reflect.get(target, property, receiver);
      if (typeof original !== "function" || typeof property !== "string") return original;
      if (!["put", "search", "get", "delete", "batch"].includes(property)) {
        return original.bind(target);
      }
      return async (...args: unknown[]) => {
        const result = await original.apply(target, args);
        const turn = engram.activeTurn();
        if (!turn) return result;
        if (property === "put") await capturePut(turn, args, options);
        if (property === "search") await captureSearch(turn, args, result, options);
        if (property === "get") await captureGet(turn, args, result, options);
        if (property === "delete") await captureDelete(turn, args, options);
        if (property === "batch") await captureBatch(turn, args, result, options);
        return result;
      };
    }
  });
}

export function langGraphStoreItems(result: unknown): LangGraphStoreItem[] {
  const rows = Array.isArray(result) ? result : [result];
  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const namespace = namespaceValue(row.namespace);
    const key = stringValue(row.key);
    const value = recordValue(row.value);
    if (!namespace || !key || !value) return [];
    const score = numberValue(row.score);
    const createdAt = dateValue(row.createdAt);
    const updatedAt = dateValue(row.updatedAt);
    return [{
      namespace,
      key,
      value,
      ...(score !== undefined ? { score } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      raw: row
    }];
  });
}

export function langGraphMemoryId(namespace: readonly string[], key: string) {
  const path = [...namespace, key].map((part) => encodeURIComponent(part)).join("/");
  return `langgraph:${path}`;
}

export function langGraphMemoryIds(result: unknown) {
  return langGraphStoreItems(result).map((item) => langGraphMemoryId(item.namespace, item.key));
}

async function capturePut(
  turn: EngramTurn,
  args: unknown[],
  options: InstrumentLangGraphStoreOptions
) {
  const put = putFromArgs(args);
  if (!put) {
    gap(options, "put", "LangGraph put did not expose a valid namespace, key, and value.");
    return;
  }
  const memory = toCaptureMemory(put, options);
  const operation = typeof options.classifyPut === "function"
    ? options.classifyPut(put)
    : options.classifyPut ?? "store";
  if (operation === "update") {
    await turn.update(memory, {}, evidence("put", "LangGraph put was explicitly classified as an update."));
  } else {
    await turn.store(memory, evidence("put", "LangGraph put is an upsert; this write was classified as a store."));
  }
}

async function captureSearch(
  turn: EngramTurn,
  args: unknown[],
  result: unknown,
  options: InstrumentLangGraphStoreOptions
) {
  const records = langGraphStoreItems(result);
  const searchOptions = recordValue(args[1]);
  const namespace = namespaceValue(args[0]) ?? [];
  const query = stringValue(searchOptions?.query) ?? `namespace:${namespace.join("/") || "root"}`;
  const selectedIds = options.selectedIds?.(records, result);
  const selected = selectedIds ? new Set(selectedIds) : undefined;
  await turn.retrieve({
    query,
    candidates: records.map((record, index) => {
      const memoryId = langGraphMemoryId(record.namespace, record.key);
      return {
        memoryId,
        memory: toTelemetryMemory(record, options),
        rank: index + 1,
        ...(record.score !== undefined ? { score: record.score } : {}),
        ...(selected ? { selected: selected.has(memoryId) } : {})
      };
    }),
    ...(selected ? {
      selectedIds: records
        .map((record) => langGraphMemoryId(record.namespace, record.key))
        .filter((memoryId) => selected.has(memoryId))
    } : {}),
    limit: positiveInteger(searchOptions?.limit)
  }, evidence(
    "search",
    selected
      ? "Candidate snapshots, ranks, and scores are mapped from LangGraph; selection is declared by the configured selectedIds callback."
      : "Candidate snapshots, ranks, and scores are mapped from LangGraph; downstream selection is not observable at this Store boundary."
  ));
}

async function captureGet(
  turn: EngramTurn,
  args: unknown[],
  result: unknown,
  options: InstrumentLangGraphStoreOptions
) {
  const namespace = namespaceValue(args[0]) ?? [];
  const key = stringValue(args[1]) ?? "unknown";
  const records = langGraphStoreItems(result);
  const selectedIds = options.selectedIds?.(records, result);
  const selected = selectedIds ? new Set(selectedIds) : undefined;
  await turn.retrieve({
    query: `key:${langGraphMemoryId(namespace, key)}`,
    candidates: records.map((record) => {
      const memoryId = langGraphMemoryId(record.namespace, record.key);
      return {
        memoryId,
        memory: toTelemetryMemory(record, options),
        rank: 1,
        ...(selected ? { selected: selected.has(memoryId) } : {})
      };
    }),
    ...(selected ? {
      selectedIds: records
        .map((record) => langGraphMemoryId(record.namespace, record.key))
        .filter((memoryId) => selected.has(memoryId))
    } : {}),
    limit: 1
  }, evidence(
    "get",
    records.length > 0
      ? selected
        ? "LangGraph returned the requested Store item; selection is declared by the configured selectedIds callback."
        : "LangGraph returned the requested Store item; downstream selection is not observable at this Store boundary."
      : "LangGraph returned no Store item."
  ));
  if (!namespaceValue(args[0]) || !stringValue(args[1])) {
    gap(options, "get", "LangGraph get did not expose a valid namespace and key.", result);
  }
}

async function captureDelete(
  turn: EngramTurn,
  args: unknown[],
  options: InstrumentLangGraphStoreOptions
) {
  const namespace = namespaceValue(args[0]);
  const key = stringValue(args[1]);
  if (!namespace || !key) {
    gap(options, "delete", "LangGraph delete did not expose a valid namespace and key.");
    return;
  }
  await turn.delete(
    [langGraphMemoryId(namespace, key)],
    "LangGraph Store delete completed",
    evidence("delete")
  );
}

async function captureBatch(
  turn: EngramTurn,
  args: unknown[],
  result: unknown,
  options: InstrumentLangGraphStoreOptions
) {
  const operations = Array.isArray(args[0]) ? args[0] : [];
  const results = Array.isArray(result) ? result : [];
  if (operations.length === 0) {
    gap(options, "batch", "LangGraph batch did not expose any operations.", result);
    return;
  }
  for (const [index, operation] of operations.entries()) {
    if (!isRecord(operation)) continue;
    if ("value" in operation && namespaceValue(operation.namespace) && stringValue(operation.key)) {
      if (operation.value === null) {
        await captureDelete(turn, [operation.namespace, operation.key], options);
      } else {
        await capturePut(turn, [operation.namespace, operation.key, operation.value, operation.index], options);
      }
    } else if (namespaceValue(operation.namespacePrefix)) {
      await captureSearch(turn, [operation.namespacePrefix, operation], results[index], options);
    } else if (namespaceValue(operation.namespace) && stringValue(operation.key)) {
      await captureGet(turn, [operation.namespace, operation.key], results[index], options);
    }
  }
}

function putFromArgs(args: unknown[]): LangGraphPut | undefined {
  const namespace = namespaceValue(args[0]);
  const key = stringValue(args[1]);
  const value = recordValue(args[2]);
  const index = args[3] === false ? false : namespaceValue(args[3]);
  if (!namespace || !key || !value) return undefined;
  return { namespace, key, value, ...(index !== undefined ? { index } : {}) };
}

function toCaptureMemory(put: LangGraphPut, options: InstrumentLangGraphStoreOptions): CaptureMemory {
  const item = { namespace: put.namespace, key: put.key, value: put.value };
  const customContent = options.content?.(item);
  const content = customContent ?? preferredContent(put.value) ?? jsonValue(put.value);
  const owner = resolveOwner(item, options);
  return {
    id: langGraphMemoryId(put.namespace, put.key),
    ...(content !== undefined ? { content } : {}),
    tier: options.tier ?? "episodic",
    scope: options.scope ?? "user",
    ...(owner ? { owner } : {}),
    provider: "langgraph",
    ...(options.storeId ? { storeId: options.storeId } : {}),
    metadata: {
      namespace: put.namespace,
      key: put.key,
      upsert: true,
      ...(put.index !== undefined ? { index: put.index } : {})
    }
  };
}

type CandidateMemory = NonNullable<NonNullable<CaptureRetrieval["candidates"]>[number]["memory"]>;

function toTelemetryMemory(
  item: LangGraphStoreItem,
  options: InstrumentLangGraphStoreOptions
): CandidateMemory {
  const content = options.content?.(item) ?? preferredContent(item.value) ?? jsonValue(item.value);
  const owner = resolveOwner(item, options);
  return {
    id: langGraphMemoryId(item.namespace, item.key),
    ...(content !== undefined ? { content } : {}),
    tier: options.tier ?? "episodic",
    scope: options.scope ?? "user",
    ...(owner ? { owner } : {}),
    provider: "langgraph",
    ...(options.storeId ? { storeId: options.storeId } : {}),
    metadata: {
      namespace: item.namespace,
      key: item.key,
      ...(item.createdAt ? { createdAt: item.createdAt } : {}),
      ...(item.updatedAt ? { updatedAt: item.updatedAt } : {})
    }
  };
}

function resolveOwner(
  item: Pick<LangGraphStoreItem, "namespace" | "key" | "value">,
  options: InstrumentLangGraphStoreOptions
): CaptureMemory["owner"] {
  const configured = typeof options.owner === "function" ? options.owner(item) : options.owner;
  const userIndex = item.namespace.findIndex((part) => part.toLowerCase() === "users");
  const inferredUserId = userIndex >= 0 ? item.namespace[userIndex + 1] : undefined;
  return {
    namespace: [...item.namespace],
    ...(inferredUserId ? { userId: inferredUserId } : {}),
    ...(configured ?? {})
  };
}

function preferredContent(value: Record<string, unknown>) {
  return stringValue(value.data)
    ?? stringValue(value.memory)
    ?? stringValue(value.text)
    ?? stringValue(value.content);
}

function evidence(operation: string, note?: string) {
  return {
    level: "mapped" as const,
    adapter: "langgraph",
    sourcePath: `langgraph.store.${operation}`,
    ...(note ? { note } : {})
  };
}

function gap(
  options: InstrumentLangGraphStoreOptions,
  operation: LangGraphInstrumentationGap["operation"],
  reason: string,
  result?: unknown
) {
  options.onInstrumentationGap?.({ operation, reason, ...(result !== undefined ? { result } : {}) });
}

function jsonValue(value: unknown): CaptureMemory["content"] {
  try {
    return JSON.parse(JSON.stringify(value)) as CaptureMemory["content"];
  } catch {
    return undefined;
  }
}

function namespaceValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((part) => typeof part === "string" && part.trim())) return undefined;
  return value.map((part) => part.trim());
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function dateValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString();
  return stringValue(value);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
