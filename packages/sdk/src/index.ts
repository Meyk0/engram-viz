import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  createMemoryTelemetryHttpTransport,
  MemoryTelemetryClient,
  type AgentTurnEnvelope,
  type JsonValue,
  type MemoryScope,
  type MemoryTelemetryEvent,
  type MemoryTelemetryOperation,
  type MemoryTier,
  type TelemetryMemoryRef,
  type TelemetryRetrievalCandidate
} from "@engramviz/core";

export type EngramClientOptions = {
  endpoint?: string;
  token?: string;
  projectId?: string;
  tenantId?: string;
  sessionId?: string;
  adapter?: string;
  fetch?: typeof fetch;
  strict?: boolean;
  onError?: (error: unknown) => void;
};

export type EngramTurnOptions = {
  input: string;
  provider: { id: string; model?: string };
  traceId?: string;
  turnId?: string;
  sessionId?: string;
  metadata?: Record<string, JsonValue>;
};

export type CaptureMemory = {
  id: string;
  content?: JsonValue;
  tier?: MemoryTier;
  scope?: MemoryScope;
  provider?: string;
  storeId?: string;
  metadata?: Record<string, JsonValue>;
};

export type CaptureRetrieval = {
  query: string;
  candidates?: TelemetryRetrievalCandidate[];
  selectedIds?: string[];
  limit?: number;
};

export type CaptureMutation = {
  sourceMemoryIds?: string[];
  targetMemoryIds?: string[];
  reason?: string;
};

export type CaptureEvidence = {
  level?: "observed" | "mapped";
  adapter?: string;
  sourcePath?: string;
  note?: string;
};

type TurnCallbackResult = string | { output: string };

const activeTurnStorage = new AsyncLocalStorage<EngramTurn>();

export class EngramClient {
  readonly endpoint: string;
  readonly projectId: string;
  readonly tenantId?: string;
  readonly sessionId: string;

  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly strict: boolean;
  private readonly onError?: (error: unknown) => void;
  private readonly adapter: string;
  private readonly telemetry: MemoryTelemetryClient;

  constructor(options: EngramClientOptions = {}) {
    this.endpoint = normalizeEndpoint(options.endpoint ?? process.env.ENGRAM_URL ?? "http://localhost:3100");
    this.token = required(options.token ?? process.env.ENGRAM_TOKEN, "Engram ingest token");
    this.projectId = required(options.projectId ?? process.env.ENGRAM_PROJECT_ID, "Engram project id");
    this.tenantId = options.tenantId;
    this.sessionId = options.sessionId ?? randomUUID();
    this.adapter = options.adapter ?? "engram-sdk";
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.strict = options.strict ?? false;
    this.onError = options.onError;
    this.telemetry = new MemoryTelemetryClient({
      transport: createMemoryTelemetryHttpTransport({
        endpoint: new URL("/api/telemetry/v2", this.endpoint).toString(),
        token: this.token,
        fetch: this.fetchImpl
      }),
      flushIntervalMs: 250,
      maxBatchSize: 25,
      retry: { maxAttempts: 3, initialDelayMs: 80, maxDelayMs: 500 },
      onDeliveryFailure: (failure) => this.report(failure.error)
    });
  }

  activeTurn(): EngramTurn | undefined {
    return activeTurnStorage.getStore();
  }

  async withTurn<T extends TurnCallbackResult>(
    options: EngramTurnOptions,
    callback: (turn: EngramTurn) => Promise<T>
  ): Promise<T> {
    const turn = new EngramTurn(this, options);
    try {
      const result = await activeTurnStorage.run(turn, () => callback(turn));
      turn.complete(typeof result === "string" ? result : result.output);
      await this.finishTurn(turn, "completed");
      return result;
    } catch (error) {
      await this.finishTurn(turn, "error", error);
      throw error;
    }
  }

  async emit(event: MemoryTelemetryEvent) {
    try {
      return await this.telemetry.emit(event);
    } catch (error) {
      this.report(error);
      if (this.strict) throw error;
      return undefined;
    }
  }

  private async finishTurn(turn: EngramTurn, status: AgentTurnEnvelope["status"], error?: unknown) {
    try {
      await this.telemetry.flush();
    } catch (flushError) {
      this.report(flushError);
      if (this.strict) throw flushError;
    }
    const envelope = turn.envelope(status, error);
    try {
      const response = await this.fetchImpl(new URL("/api/turns/v1", this.endpoint), {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(envelope)
      });
      if (!response.ok) throw new Error(`Engram turn ingest rejected the envelope (${response.status}).`);
    } catch (ingestError) {
      this.report(ingestError);
      if (this.strict) throw ingestError;
    }
  }

  private report(error: unknown) {
    this.onError?.(error);
  }

  _adapterName() {
    return this.adapter;
  }
}

export class EngramTurn {
  readonly turnId: string;
  readonly traceId: string;
  readonly sessionId: string;
  readonly startedAt = new Date().toISOString();
  readonly input: string;
  readonly provider: EngramTurnOptions["provider"];
  readonly metadata?: Record<string, JsonValue>;

  private readonly client: EngramClient;
  private readonly eventIds: string[] = [];
  private sequence = 0;
  private output?: string;

  constructor(client: EngramClient, options: EngramTurnOptions) {
    this.client = client;
    this.turnId = options.turnId ?? randomUUID();
    this.traceId = options.traceId ?? randomUUID();
    this.sessionId = options.sessionId ?? client.sessionId;
    this.input = required(options.input, "Turn input");
    this.provider = options.provider;
    this.metadata = options.metadata;
  }

  store(memory: CaptureMemory, evidence?: CaptureEvidence) {
    return this.memoryEvent("store", { memory: normalizeMemory(memory) }, evidence);
  }

  update(memory: CaptureMemory, mutation: CaptureMutation = {}, evidence?: CaptureEvidence) {
    return this.memoryEvent("update", { memory: normalizeMemory(memory), mutation }, evidence);
  }

  retrieve(input: CaptureRetrieval, evidence?: CaptureEvidence) {
    const selectedIds = input.selectedIds ?? input.candidates?.filter((candidate) => candidate.selected).map((candidate) => candidate.memoryId) ?? [];
    return this.memoryEvent("retrieve", {
      memoryIds: selectedIds,
      retrieval: {
        query: input.query,
        ...(input.limit ? { limit: input.limit } : {}),
        ...(input.candidates ? { candidates: input.candidates } : {}),
        selectedIds
      }
    }, evidence);
  }

  load(memoryIds: readonly string[], evidence?: CaptureEvidence) {
    const ids = uniqueIds(memoryIds);
    if (ids.length === 0) return Promise.resolve(undefined);
    return this.memoryEvent("load", { memoryIds: ids, retrieval: { loadedIds: ids } }, evidence);
  }

  supersede(memoryIds: readonly string[], reason?: string, evidence?: CaptureEvidence) {
    const ids = uniqueIds(memoryIds);
    return this.memoryEvent("supersede", {
      memoryIds: ids,
      ...(reason ? { mutation: { sourceMemoryIds: ids, reason } } : {})
    }, evidence);
  }

  delete(memoryIds: readonly string[], reason?: string, evidence?: CaptureEvidence) {
    const ids = uniqueIds(memoryIds);
    return this.memoryEvent("delete", {
      memoryIds: ids,
      ...(reason ? { mutation: { sourceMemoryIds: ids, reason } } : {})
    }, evidence);
  }

  summarize(memory: CaptureMemory, sourceMemoryIds: readonly string[], reason?: string, evidence?: CaptureEvidence) {
    return this.memoryEvent("summarize", {
      memory: normalizeMemory({ ...memory, tier: memory.tier ?? "semantic" }),
      mutation: {
        sourceMemoryIds: uniqueIds(sourceMemoryIds),
        targetMemoryIds: [memory.id],
        ...(reason ? { reason } : {})
      }
    }, evidence);
  }

  complete(output: string) {
    this.output = required(output, "Turn output");
  }

  envelope(status: AgentTurnEnvelope["status"], error?: unknown): AgentTurnEnvelope {
    const completedAt = new Date().toISOString();
    return {
      schemaVersion: 1,
      turnId: this.turnId,
      traceId: this.traceId,
      sessionId: this.sessionId,
      projectId: this.client.projectId,
      startedAt: this.startedAt,
      completedAt,
      input: this.input,
      ...(this.output ? { output: this.output } : {}),
      status,
      provider: this.provider,
      telemetryEventIds: [...this.eventIds],
      ...(status === "error" ? { error: normalizeError(error) } : {}),
      ...(this.metadata ? { metadata: this.metadata } : {})
    };
  }

  private async memoryEvent(
    operation: MemoryTelemetryOperation,
    fields: Partial<Pick<MemoryTelemetryEvent, "memory" | "memoryIds" | "retrieval" | "mutation">>,
    evidence: CaptureEvidence = {}
  ) {
    const sequence = this.sequence;
    this.sequence += 1;
    const event: MemoryTelemetryEvent = {
      schemaVersion: 2,
      eventId: `${this.traceId}:memory:${sequence}`,
      traceId: this.traceId,
      sessionId: this.sessionId,
      projectId: this.client.projectId,
      timestamp: new Date().toISOString(),
      sequence,
      operation,
      ...fields,
      evidence: {
        level: evidence.level ?? "observed",
        adapter: evidence.adapter ?? this.client._adapterName(),
        sourcePath: evidence.sourcePath ?? `EngramTurn.${operation}`,
        ...(evidence.note ? { note: evidence.note } : {})
      }
    };
    const emitted = await this.client.emit(event);
    if (emitted) this.eventIds.push(emitted.eventId);
    return emitted;
  }
}

export function getActiveEngramTurn(): EngramTurn | undefined {
  return activeTurnStorage.getStore();
}

function normalizeMemory(memory: CaptureMemory): TelemetryMemoryRef {
  return {
    id: required(memory.id, "Memory id"),
    ...(memory.content !== undefined ? { content: memory.content } : {}),
    tier: memory.tier ?? "episodic",
    scope: memory.scope ?? "user",
    ...(memory.provider ? { provider: memory.provider } : {}),
    ...(memory.storeId ? { storeId: memory.storeId } : {}),
    ...(memory.metadata ? { metadata: memory.metadata } : {})
  };
}

function uniqueIds(ids: readonly string[]) {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function normalizeEndpoint(value: string) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new TypeError("Engram endpoint must use HTTP or HTTPS.");
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function required(value: string | undefined, label: string) {
  const normalized = value?.trim();
  if (!normalized) throw new TypeError(`${label} is required.`);
  return normalized;
}

function normalizeError(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message || "Unknown error" };
  return { message: typeof error === "string" && error.trim() ? error : "Unknown error" };
}
