import { parseMemoryTelemetryEvent } from "@/lib/telemetry";
import type { MemoryTelemetryEvent } from "@/lib/telemetry";
import type {
  MemoryTelemetryStore,
  StoredMemoryTelemetryEvent,
  TelemetryAppendResult,
  TelemetryReadResult,
  TelemetryTenantContext
} from "@/lib/ingest/types";

const TELEMETRY_TABLE = "memory_telemetry_events";
const DEFAULT_MEMORY_CAPACITY = 10_000;
const DEFAULT_SUPABASE_PAGE_SIZE = 1_000;
const MAX_ERROR_BODY_LENGTH = 500;

type Clock = () => Date | string;

export type TelemetryFetch = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export type InMemoryMemoryTelemetryStoreOptions = {
  capacity?: number;
  now?: Clock;
};

export type SupabaseMemoryTelemetryStoreOptions = {
  url: string;
  secretKey: string;
  fetch?: TelemetryFetch;
  pageSize?: number;
  now?: Clock;
};

export type MemoryTelemetryStoreEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

export type MemoryTelemetryStoreFromEnvOptions = {
  env?: MemoryTelemetryStoreEnvironment;
  fetch?: TelemetryFetch;
  memoryCapacity?: number;
  supabasePageSize?: number;
  now?: Clock;
};

export class MemoryTelemetryStoreConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryTelemetryStoreConfigurationError";
  }
}

export class MemoryTelemetryStoreCapacityError extends Error {
  constructor(capacity: number) {
    super(`The in-memory telemetry store capacity of ${capacity} events would be exceeded.`);
    this.name = "MemoryTelemetryStoreCapacityError";
  }
}

export class MemoryTelemetryStoreRequestError extends Error {
  readonly status: number;

  constructor(status: number, detail?: string) {
    super(
      detail
        ? `Supabase telemetry request failed with status ${status}: ${detail}`
        : `Supabase telemetry request failed with status ${status}.`
    );
    this.name = "MemoryTelemetryStoreRequestError";
    this.status = status;
  }
}

export class InMemoryMemoryTelemetryStore implements MemoryTelemetryStore {
  readonly capacity: number;

  private readonly now: Clock;
  private readonly records: StoredMemoryTelemetryEvent[] = [];
  private readonly eventKeys = new Set<string>();
  private nextCursor = 1;

  constructor(options: InMemoryMemoryTelemetryStoreOptions = {}) {
    this.capacity = positiveInteger(options.capacity ?? DEFAULT_MEMORY_CAPACITY, "capacity");
    this.now = options.now ?? (() => new Date());
  }

  async append(
    context: TelemetryTenantContext,
    events: readonly MemoryTelemetryEvent[]
  ): Promise<TelemetryAppendResult> {
    validateContext(context);

    const parsedEvents = events.map((event) => validateEventForContext(event, context));
    const batchKeys = new Set<string>();
    const acceptedEvents: MemoryTelemetryEvent[] = [];
    const duplicateEventIds: string[] = [];

    for (const event of parsedEvents) {
      const key = eventKey(context, event.eventId);
      if (this.eventKeys.has(key) || batchKeys.has(key)) {
        duplicateEventIds.push(event.eventId);
        continue;
      }
      batchKeys.add(key);
      acceptedEvents.push(event);
    }

    if (this.records.length + acceptedEvents.length > this.capacity) {
      throw new MemoryTelemetryStoreCapacityError(this.capacity);
    }

    const acceptedEventIds: string[] = [];
    for (const event of acceptedEvents) {
      const receivedAt = clockTimestamp(this.now);
      const record: StoredMemoryTelemetryEvent = {
        cursor: this.nextCursor,
        tenantId: context.tenantId,
        projectId: context.projectId,
        eventId: event.eventId,
        sequence: event.sequence,
        occurredAt: event.timestamp,
        receivedAt,
        event: clone(event)
      };

      this.nextCursor += 1;
      this.records.push(record);
      this.eventKeys.add(eventKey(context, event.eventId));
      acceptedEventIds.push(event.eventId);
    }

    return immutable({
      acceptedEventIds,
      duplicateEventIds,
      highWaterCursor: this.contextHighWater(context)
    });
  }

  async read(
    context: TelemetryTenantContext,
    input: { afterCursor: number; limit: number }
  ): Promise<TelemetryReadResult> {
    validateContext(context);
    validateReadInput(input);

    const events = this.records
      .filter((record) =>
        record.tenantId === context.tenantId &&
        record.projectId === context.projectId &&
        record.cursor > input.afterCursor
      )
      .slice(0, input.limit)
      .map((record) => clone(record));

    return immutable({
      events,
      highWaterCursor: events.at(-1)?.cursor ?? input.afterCursor
    });
  }

  private contextHighWater(context: TelemetryTenantContext) {
    for (let index = this.records.length - 1; index >= 0; index -= 1) {
      const record = this.records[index];
      if (record.tenantId === context.tenantId && record.projectId === context.projectId) {
        return record.cursor;
      }
    }
    return 0;
  }
}

export class SupabaseDataApiMemoryTelemetryStore implements MemoryTelemetryStore {
  readonly pageSize: number;

  private readonly baseUrl: string;
  private readonly secretKey: string;
  private readonly request: TelemetryFetch;
  private readonly now: Clock;

  constructor(options: SupabaseMemoryTelemetryStoreOptions) {
    const url = options.url.trim();
    const secretKey = options.secretKey.trim();
    if (!url) {
      throw new MemoryTelemetryStoreConfigurationError("A server-side SUPABASE_URL is required.");
    }
    if (!secretKey) {
      throw new MemoryTelemetryStoreConfigurationError(
        "A server-side SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required."
      );
    }

    this.baseUrl = normalizeSupabaseUrl(url);
    this.secretKey = secretKey;
    this.request = options.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!this.request) {
      throw new MemoryTelemetryStoreConfigurationError("A fetch implementation is required.");
    }
    this.pageSize = positiveInteger(options.pageSize ?? DEFAULT_SUPABASE_PAGE_SIZE, "pageSize");
    this.now = options.now ?? (() => new Date());
  }

  async append(
    context: TelemetryTenantContext,
    events: readonly MemoryTelemetryEvent[]
  ): Promise<TelemetryAppendResult> {
    validateContext(context);

    const parsedEvents = events.map((event) => validateEventForContext(event, context));
    const uniqueEvents: MemoryTelemetryEvent[] = [];
    const seen = new Set<string>();
    for (const event of parsedEvents) {
      if (seen.has(event.eventId)) continue;
      seen.add(event.eventId);
      uniqueEvents.push(event);
    }

    let insertedRows: SupabaseStoredRow[] = [];
    if (uniqueEvents.length > 0) {
      const url = new URL(`${this.baseUrl}/rest/v1/${TELEMETRY_TABLE}`);
      url.searchParams.set("on_conflict", "tenant_id,project_id,event_id");
      url.searchParams.set(
        "select",
        "cursor,tenant_id,project_id,event_id,sequence,occurred_at,received_at,payload"
      );

      const rows = uniqueEvents.map((event) => ({
        tenant_id: context.tenantId,
        project_id: context.projectId,
        ingest_key_id: context.keyId,
        event_id: event.eventId,
        sequence: event.sequence,
        occurred_at: event.timestamp,
        received_at: clockTimestamp(this.now),
        payload: event
      }));
      const response = await this.request(url, {
        method: "POST",
        headers: this.headers({
          "Content-Type": "application/json",
          Prefer: "resolution=ignore-duplicates,return=representation"
        }),
        body: JSON.stringify(rows)
      });
      insertedRows = await parseStoredRowsResponse(response, context);
      const requestedIds = new Set(uniqueEvents.map(({ eventId }) => eventId));
      const returnedIds = new Set<string>();
      for (const row of insertedRows) {
        if (!requestedIds.has(row.event_id) || returnedIds.has(row.event_id)) {
          throw new MemoryTelemetryStoreRequestError(
            502,
            "Supabase returned an unexpected inserted event."
          );
        }
        returnedIds.add(row.event_id);
      }
    }

    const insertedIds = new Set(insertedRows.map((row) => row.event_id));
    const acceptedEventIds: string[] = [];
    const duplicateEventIds: string[] = [];
    const acceptedOccurrences = new Set<string>();
    for (const event of parsedEvents) {
      if (insertedIds.has(event.eventId) && !acceptedOccurrences.has(event.eventId)) {
        acceptedOccurrences.add(event.eventId);
        acceptedEventIds.push(event.eventId);
      } else {
        duplicateEventIds.push(event.eventId);
      }
    }

    return immutable({
      acceptedEventIds,
      duplicateEventIds,
      highWaterCursor: await this.readContextHighWater(context)
    });
  }

  async read(
    context: TelemetryTenantContext,
    input: { afterCursor: number; limit: number }
  ): Promise<TelemetryReadResult> {
    validateContext(context);
    validateReadInput(input);

    const events: StoredMemoryTelemetryEvent[] = [];
    let cursor = input.afterCursor;

    while (events.length < input.limit) {
      const requested = Math.min(this.pageSize, input.limit - events.length);
      const url = this.scopedReadUrl(context);
      url.searchParams.set(
        "select",
        "cursor,tenant_id,project_id,event_id,sequence,occurred_at,received_at,payload"
      );
      url.searchParams.set("cursor", `gt.${cursor}`);
      url.searchParams.set("order", "cursor.asc");
      url.searchParams.set("limit", String(requested));

      const response = await this.request(url, {
        method: "GET",
        headers: this.headers()
      });
      const rows = await parseStoredRowsResponse(response, context);
      const page = rows.map(toStoredEvent);
      if (page.some((record, index) => record.cursor <= (index === 0 ? cursor : page[index - 1].cursor))) {
        throw new MemoryTelemetryStoreRequestError(502, "Supabase returned non-monotonic cursors.");
      }

      events.push(...page);
      if (page.length === 0) break;
      cursor = page.at(-1)?.cursor ?? cursor;
    }

    return immutable({
      events,
      highWaterCursor: events.at(-1)?.cursor ?? input.afterCursor
    });
  }

  private async readContextHighWater(context: TelemetryTenantContext) {
    const url = this.scopedReadUrl(context);
    url.searchParams.set("select", "cursor");
    url.searchParams.set("order", "cursor.desc");
    url.searchParams.set("limit", "1");
    const response = await this.request(url, {
      method: "GET",
      headers: this.headers()
    });
    const rows = await parseJsonResponse(response);
    if (!Array.isArray(rows)) {
      throw new MemoryTelemetryStoreRequestError(502, "Supabase returned an invalid high-water response.");
    }
    if (rows.length === 0) return 0;
    if (rows.length > 1) {
      throw new MemoryTelemetryStoreRequestError(502, "Supabase returned an invalid high-water response.");
    }
    return safeCursor(recordField(rows[0], "cursor"));
  }

  private scopedReadUrl(context: TelemetryTenantContext) {
    const url = new URL(`${this.baseUrl}/rest/v1/${TELEMETRY_TABLE}`);
    url.searchParams.set("tenant_id", `eq.${context.tenantId}`);
    url.searchParams.set("project_id", `eq.${context.projectId}`);
    return url;
  }

  private headers(extra: Record<string, string> = {}): HeadersInit {
    return {
      Accept: "application/json",
      apikey: this.secretKey,
      Authorization: `Bearer ${this.secretKey}`,
      ...extra
    };
  }
}

export function createInMemoryMemoryTelemetryStore(
  options: InMemoryMemoryTelemetryStoreOptions = {}
) {
  return new InMemoryMemoryTelemetryStore(options);
}

export function createSupabaseMemoryTelemetryStore(
  options: SupabaseMemoryTelemetryStoreOptions
) {
  return new SupabaseDataApiMemoryTelemetryStore(options);
}

export function createMemoryTelemetryStoreFromEnv(
  options: MemoryTelemetryStoreFromEnvOptions = {}
): MemoryTelemetryStore {
  const env = options.env ?? process.env;
  const url = env.SUPABASE_URL?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim() ||
    env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (url && secretKey) {
    return createSupabaseMemoryTelemetryStore({
      url,
      secretKey,
      fetch: options.fetch,
      pageSize: options.supabasePageSize,
      now: options.now
    });
  }

  if (url || secretKey) {
    throw new MemoryTelemetryStoreConfigurationError(
      "Durable telemetry storage requires both SUPABASE_URL and a server-side Supabase secret."
    );
  }

  return createInMemoryMemoryTelemetryStore({
    capacity: options.memoryCapacity,
    now: options.now
  });
}

type SupabaseStoredRow = {
  cursor: number;
  tenant_id: string;
  project_id: string;
  event_id: string;
  sequence?: number;
  occurred_at: string;
  received_at: string;
  payload: MemoryTelemetryEvent;
};

async function parseStoredRowsResponse(
  response: Response,
  context: TelemetryTenantContext
): Promise<SupabaseStoredRow[]> {
  const value = await parseJsonResponse(response);
  if (!Array.isArray(value)) {
    throw new MemoryTelemetryStoreRequestError(502, "Supabase returned an invalid row response.");
  }
  return value.map((row) => parseStoredRow(row, context));
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!response.ok) {
    throw new MemoryTelemetryStoreRequestError(
      response.status,
      safeErrorDetail(body)
    );
  }
  if (!body.trim()) return [];
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new MemoryTelemetryStoreRequestError(502, "Supabase returned invalid JSON.");
  }
}

function parseStoredRow(value: unknown, context: TelemetryTenantContext): SupabaseStoredRow {
  if (!isRecord(value)) {
    throw new MemoryTelemetryStoreRequestError(502, "Supabase returned a non-object row.");
  }
  const tenantId = stringValue(value.tenant_id, "tenant_id");
  const projectId = stringValue(value.project_id, "project_id");
  if (tenantId !== context.tenantId || projectId !== context.projectId) {
    throw new MemoryTelemetryStoreRequestError(502, "Supabase returned a row outside the requested scope.");
  }
  const event = parseMemoryTelemetryEvent(value.payload);
  const eventId = stringValue(value.event_id, "event_id");
  if (event.eventId !== eventId) {
    throw new MemoryTelemetryStoreRequestError(502, "Stored event metadata does not match its payload.");
  }
  if (event.projectId !== undefined && event.projectId !== projectId) {
    throw new MemoryTelemetryStoreRequestError(502, "Stored event payload has a mismatched project.");
  }
  const sequence = optionalNonnegativeInteger(value.sequence, "sequence");
  if (sequence !== event.sequence) {
    throw new MemoryTelemetryStoreRequestError(502, "Stored event sequence does not match its payload.");
  }
  const occurredAt = timestampValue(value.occurred_at, "occurred_at");
  if (new Date(occurredAt).getTime() !== new Date(event.timestamp).getTime()) {
    throw new MemoryTelemetryStoreRequestError(502, "Stored event timestamp does not match its payload.");
  }

  return {
    cursor: safeCursor(value.cursor),
    tenant_id: tenantId,
    project_id: projectId,
    event_id: eventId,
    sequence,
    occurred_at: occurredAt,
    received_at: timestampValue(value.received_at, "received_at"),
    payload: event
  };
}

function toStoredEvent(row: SupabaseStoredRow): StoredMemoryTelemetryEvent {
  return {
    cursor: row.cursor,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    eventId: row.event_id,
    sequence: row.sequence,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    event: clone(row.payload)
  };
}

function validateEventForContext(
  input: MemoryTelemetryEvent,
  context: TelemetryTenantContext
) {
  const event = parseMemoryTelemetryEvent(input);
  if (event.projectId !== undefined && event.projectId !== context.projectId) {
    throw new MemoryTelemetryStoreConfigurationError(
      `Telemetry event "${event.eventId}" belongs to a different project.`
    );
  }
  return event;
}

function validateContext(context: TelemetryTenantContext) {
  for (const [field, value] of Object.entries(context)) {
    if (typeof value !== "string" || !value.trim()) {
      throw new MemoryTelemetryStoreConfigurationError(
        `Telemetry tenant context ${field} must be a non-empty string.`
      );
    }
  }
}

function validateReadInput(input: { afterCursor: number; limit: number }) {
  if (!Number.isSafeInteger(input.afterCursor) || input.afterCursor < 0) {
    throw new MemoryTelemetryStoreConfigurationError("afterCursor must be a non-negative safe integer.");
  }
  positiveInteger(input.limit, "limit");
}

function normalizeSupabaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MemoryTelemetryStoreConfigurationError("SUPABASE_URL must be an absolute URL.");
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new MemoryTelemetryStoreConfigurationError("SUPABASE_URL must use HTTPS outside local development.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function eventKey(context: TelemetryTenantContext, eventId: string) {
  return JSON.stringify([context.tenantId, context.projectId, eventId]);
}

function positiveInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new MemoryTelemetryStoreConfigurationError(`${field} must be a positive safe integer.`);
  }
  return value;
}

function clockTimestamp(now: Clock) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new MemoryTelemetryStoreConfigurationError("The telemetry store clock returned an invalid date.");
  }
  return date.toISOString();
}

function safeCursor(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new MemoryTelemetryStoreRequestError(502, "Supabase returned an unsafe cursor.");
  }
  return value;
}

function optionalNonnegativeInteger(value: unknown, field: string) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new MemoryTelemetryStoreRequestError(502, `Supabase returned an invalid ${field}.`);
  }
  return value;
}

function timestampValue(value: unknown, field: string) {
  const text = stringValue(value, field);
  if (Number.isNaN(new Date(text).getTime())) {
    throw new MemoryTelemetryStoreRequestError(502, `Supabase returned an invalid ${field}.`);
  }
  return text;
}

function stringValue(value: unknown, field: string) {
  if (typeof value !== "string" || !value) {
    throw new MemoryTelemetryStoreRequestError(502, `Supabase returned an invalid ${field}.`);
  }
  return value;
}

function recordField(value: unknown, field: string) {
  if (!isRecord(value)) {
    throw new MemoryTelemetryStoreRequestError(502, "Supabase returned a non-object row.");
  }
  return value[field];
}

function safeErrorDetail(body: string) {
  const trimmed = body.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isRecord(parsed) && typeof parsed.message === "string") {
      return parsed.message.slice(0, MAX_ERROR_BODY_LENGTH);
    }
  } catch {
    // A short plain-text response is still useful, but credentials are never included here.
  }
  return trimmed.slice(0, MAX_ERROR_BODY_LENGTH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function immutable<T>(value: T): T {
  return deepFreeze(clone(value));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
