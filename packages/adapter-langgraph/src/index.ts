import type { CaptureMemory, CaptureRetrieval, EngramClient, EngramTurn } from "@engramviz/sdk";
import {
  buildMemoryPolicyReplayResult,
  parseMemoryExecutorManifest,
  parseMemoryPolicyReplayRequest,
  type JsonValue,
  type MemoryDecisionRunV3,
  type MemoryExecutorManifest,
  type MemoryInterventionV2,
  type MemoryPolicyReplayRequest,
  type MemoryReplayExecutor,
  type MemoryReplaySideEffectMode
} from "@engramviz/core";

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

export type LangGraphRunnableConfig = {
  configurable?: Record<string, unknown>;
  signal?: AbortSignal;
};

export type LangGraphStateSnapshot = {
  values: unknown;
  next?: readonly string[];
  config?: LangGraphRunnableConfig;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  parentConfig?: LangGraphRunnableConfig;
  tasks?: readonly unknown[];
};

export type LangGraphExecutable = {
  updateState: (
    config: LangGraphRunnableConfig,
    values: unknown,
    asNode?: string
  ) => Promise<LangGraphRunnableConfig>;
  invoke: (input: null, config?: LangGraphRunnableConfig) => Promise<unknown>;
  getState: (config: LangGraphRunnableConfig) => Promise<LangGraphStateSnapshot>;
};

export type LangGraphReplayCheckpoint = {
  values: Record<string, JsonValue>;
  asNode: string;
  checkpointId?: string;
  threadId?: string;
  next?: string[];
};

export type LangGraphReplayVariant = "baseline" | "treatment";

export type LangGraphReplayRuntime = {
  graph: LangGraphExecutable;
  config: LangGraphRunnableConfig;
  isolation: {
    checkpoint: "isolated";
    memoryStore: "isolated";
    sideEffects: MemoryReplaySideEffectMode;
  };
  dispose?: () => void | Promise<void>;
};

export type DefineLangGraphExecutorOptions = {
  id: string;
  name?: string;
  version: string;
  langGraphVersion?: string;
  deterministic?: boolean;
  defaultSideEffectMode?: MemoryReplaySideEffectMode;
  supportedSideEffectModes?: MemoryReplaySideEffectMode[];
  createRuntime: (context: {
    variant: LangGraphReplayVariant;
    source: MemoryDecisionRunV3;
    intervention: MemoryInterventionV2;
    sideEffectMode: MemoryReplaySideEffectMode;
  }) => LangGraphReplayRuntime | Promise<LangGraphReplayRuntime>;
  checkpoint?: (source: MemoryDecisionRunV3) => LangGraphReplayCheckpoint;
  applyIntervention: (context: {
    checkpoint: LangGraphReplayCheckpoint;
    intervention: MemoryInterventionV2;
    runtime: LangGraphReplayRuntime;
    source: MemoryDecisionRunV3;
  }) => Record<string, JsonValue> | Promise<Record<string, JsonValue>>;
  observe: (context: {
    finalState: LangGraphStateSnapshot;
    output: unknown;
    runtime: LangGraphReplayRuntime;
    source: MemoryDecisionRunV3;
    variant: LangGraphReplayVariant;
    intervention: MemoryInterventionV2;
  }) => MemoryDecisionRunV3 | Promise<MemoryDecisionRunV3>;
  caveat?: string;
};

export const LANGGRAPH_EXECUTOR_CAVEAT =
  "LangGraph replay re-executes the developer's graph downstream from an isolated checkpoint fork. Engram compares observable memory decisions and answers; it does not expose hidden model reasoning. Store and tool isolation are enforced at the integration boundary and remain the application's responsibility inside custom nodes.";

export function defineLangGraphExecutor(options: DefineLangGraphExecutorOptions): MemoryReplayExecutor {
  const supportedModes = options.supportedSideEffectModes ?? ["blocked", "recorded"];
  const defaultMode = options.defaultSideEffectMode ?? "blocked";
  const manifest = parseMemoryExecutorManifest({
    format: "engram.memory-executor",
    version: 1,
    id: options.id,
    name: options.name ?? options.id,
    executorVersion: options.version,
    framework: {
      id: "langgraph",
      ...(options.langGraphVersion ? { version: options.langGraphVersion } : {})
    },
    capabilities: {
      levels: ["policy", "agent"],
      deterministic: options.deterministic ?? false,
      reusesRecordedCandidates: false,
      rerunsCandidateGeneration: true,
      rerunsEligibility: true,
      rerunsRanking: true,
      rerunsSelection: true,
      rerunsContextAssembly: true,
      rerunsGeneration: true,
      supportsPolicyInterventions: true,
      supportsStateInterventions: true,
      supportsRepeatedRuns: true
    },
    sideEffects: {
      defaultMode,
      supportedModes
    }
  }) as MemoryExecutorManifest;

  return {
    manifest,
    async replay(requestInput, replayOptions = {}) {
      const request = parseMemoryPolicyReplayRequest(requestInput);
      const sideEffectMode = replayOptions.sideEffectMode ?? manifest.sideEffects.defaultMode;
      if (!manifest.sideEffects.supportedModes.includes(sideEffectMode)) {
        throw new Error(`Executor ${manifest.id} does not support side-effect mode ${sideEffectMode}.`);
      }
      throwIfAborted(replayOptions.signal);
      const checkpoint = (options.checkpoint ?? readLangGraphReplayCheckpoint)(request.baseline);
      const baseline = await executeVariant("baseline", checkpoint, request, sideEffectMode, options, replayOptions.signal);
      throwIfAborted(replayOptions.signal);
      const treatment = await executeVariant("treatment", checkpoint, request, sideEffectMode, options, replayOptions.signal);
      throwIfAborted(replayOptions.signal);
      return buildMemoryPolicyReplayResult({
        manifest,
        request,
        baseline,
        treatment,
        caveat: options.caveat ?? LANGGRAPH_EXECUTOR_CAVEAT
      });
    }
  };
}

export async function captureLangGraphReplayCheckpoint(
  graph: Pick<LangGraphExecutable, "getState">,
  config: LangGraphRunnableConfig,
  options: { asNode: string }
): Promise<LangGraphReplayCheckpoint> {
  const snapshot = await graph.getState(config);
  const values = jsonRecord(snapshot.values, "LangGraph checkpoint values");
  const configurable = snapshot.config?.configurable ?? config.configurable;
  const checkpointId = stringValue(configurable?.checkpoint_id);
  const threadId = stringValue(configurable?.thread_id);
  return {
    values,
    asNode: requiredString(options.asNode, "asNode"),
    ...(checkpointId ? { checkpointId } : {}),
    ...(threadId ? { threadId } : {}),
    ...(snapshot.next ? { next: [...snapshot.next] } : {})
  };
}

export function langGraphReplayMetadata(checkpoint: LangGraphReplayCheckpoint) {
  return {
    langgraph: {
      replayCheckpoint: structuredClone(checkpoint)
    }
  } satisfies Record<string, JsonValue>;
}

export function readLangGraphReplayCheckpoint(source: MemoryDecisionRunV3): LangGraphReplayCheckpoint {
  const langgraph = recordValue(source.metadata?.langgraph);
  const checkpoint = recordValue(langgraph?.replayCheckpoint);
  if (!checkpoint) {
    throw new Error("The captured run is missing metadata.langgraph.replayCheckpoint.");
  }
  const values = jsonRecord(checkpoint.values, "LangGraph replay checkpoint values");
  const asNode = requiredString(checkpoint.asNode, "LangGraph replay checkpoint asNode");
  const next = Array.isArray(checkpoint.next) && checkpoint.next.every((value) => typeof value === "string")
    ? checkpoint.next
    : undefined;
  const checkpointId = stringValue(checkpoint.checkpointId);
  const threadId = stringValue(checkpoint.threadId);
  return {
    values,
    asNode,
    ...(checkpointId ? { checkpointId } : {}),
    ...(threadId ? { threadId } : {}),
    ...(next ? { next: [...next] } : {})
  };
}

async function executeVariant(
  variant: LangGraphReplayVariant,
  checkpoint: LangGraphReplayCheckpoint,
  request: MemoryPolicyReplayRequest,
  sideEffectMode: MemoryReplaySideEffectMode,
  options: DefineLangGraphExecutorOptions,
  signal?: AbortSignal
) {
  const runtime = await options.createRuntime({
    variant,
    source: request.baseline,
    intervention: request.intervention,
    sideEffectMode
  });
  assertRuntimeIsolation(runtime, sideEffectMode);
  try {
    throwIfAborted(signal);
    const values = variant === "baseline"
      ? structuredClone(checkpoint.values)
      : await options.applyIntervention({
          checkpoint: structuredClone(checkpoint),
          intervention: request.intervention,
          runtime,
          source: request.baseline
        });
    const seedConfig = await runtime.graph.updateState(runtime.config, values, checkpoint.asNode);
    throwIfAborted(signal);
    const invocationConfig = signal ? { ...seedConfig, signal } : seedConfig;
    const output = await runtime.graph.invoke(null, invocationConfig);
    throwIfAborted(signal);
    const finalState = await runtime.graph.getState(latestThreadConfig(seedConfig));
    return options.observe({
      finalState,
      output,
      runtime,
      source: request.baseline,
      variant,
      intervention: request.intervention
    });
  } finally {
    await runtime.dispose?.();
  }
}

function assertRuntimeIsolation(runtime: LangGraphReplayRuntime, sideEffectMode: MemoryReplaySideEffectMode) {
  if (runtime.isolation.checkpoint !== "isolated") {
    throw new Error("LangGraph replay requires an isolated checkpoint runtime.");
  }
  if (runtime.isolation.memoryStore !== "isolated") {
    throw new Error("LangGraph replay requires an isolated memory Store runtime.");
  }
  if (runtime.isolation.sideEffects !== sideEffectMode) {
    throw new Error(`LangGraph runtime declared ${runtime.isolation.sideEffects} side effects; ${sideEffectMode} was requested.`);
  }
}

function latestThreadConfig(config: LangGraphRunnableConfig): LangGraphRunnableConfig {
  if (!config.configurable) return config;
  const configurable = { ...config.configurable };
  delete configurable.checkpoint_id;
  return { ...config, configurable };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new Error("LangGraph replay was aborted.");
}

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

function requiredString(value: unknown, label: string) {
  const parsed = stringValue(value);
  if (!parsed) throw new Error(`${label} must be a non-empty string.`);
  return parsed;
}

function jsonRecord(value: unknown, label: string): Record<string, JsonValue> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  try {
    const clone = JSON.parse(JSON.stringify(value)) as unknown;
    if (!isRecord(clone)) throw new Error();
    return clone as Record<string, JsonValue>;
  } catch {
    throw new Error(`${label} must be JSON serializable.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
