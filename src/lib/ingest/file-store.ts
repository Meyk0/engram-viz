import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseMemoryTelemetryEvent } from "@/lib/telemetry";
import type { MemoryTelemetryEvent } from "@/lib/telemetry";
import type {
  MemoryTelemetryStore,
  StoredMemoryTelemetryEvent,
  TelemetryAppendResult,
  TelemetryReadResult,
  TelemetryTenantContext
} from "@/lib/ingest/types";

const TELEMETRY_FILENAME = "memory-telemetry.ndjson";

export type FileMemoryTelemetryStoreOptions = {
  directory: string;
  now?: () => Date | string;
};

/** Append-only local telemetry storage intended for a single Engram Studio process. */
export class FileMemoryTelemetryStore implements MemoryTelemetryStore {
  readonly filePath: string;

  private readonly now: () => Date | string;
  private records: StoredMemoryTelemetryEvent[] | undefined;
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(options: FileMemoryTelemetryStoreOptions) {
    const directory = options.directory.trim();
    if (!directory) throw new Error("Local telemetry directory must not be empty.");
    this.filePath = path.join(path.resolve(directory), TELEMETRY_FILENAME);
    this.now = options.now ?? (() => new Date());
  }

  append(
    context: TelemetryTenantContext,
    events: readonly MemoryTelemetryEvent[]
  ): Promise<TelemetryAppendResult> {
    return this.enqueue(async () => {
      validateContext(context);
      const records = await this.load();
      const existing = new Set(
        records.map((record) => eventKey(record.tenantId, record.projectId, record.eventId))
      );
      const batch = new Set<string>();
      const accepted: StoredMemoryTelemetryEvent[] = [];
      const duplicateEventIds: string[] = [];
      let cursor = records.at(-1)?.cursor ?? 0;

      for (const input of events) {
        const event = parseMemoryTelemetryEvent(input);
        if (event.projectId !== undefined && event.projectId !== context.projectId) {
          throw new Error(`Telemetry event "${event.eventId}" belongs to a different project.`);
        }
        const key = eventKey(context.tenantId, context.projectId, event.eventId);
        if (existing.has(key) || batch.has(key)) {
          duplicateEventIds.push(event.eventId);
          continue;
        }
        batch.add(key);
        cursor += 1;
        accepted.push({
          cursor,
          tenantId: context.tenantId,
          projectId: context.projectId,
          eventId: event.eventId,
          sequence: event.sequence,
          occurredAt: event.timestamp,
          receivedAt: timestamp(this.now()),
          event: structuredClone(event)
        });
      }

      if (accepted.length > 0) {
        await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
        await appendFile(
          this.filePath,
          `${accepted.map((record) => JSON.stringify(record)).join("\n")}\n`,
          { encoding: "utf8", mode: 0o600 }
        );
        records.push(...accepted);
      }

      return {
        acceptedEventIds: accepted.map((record) => record.eventId),
        duplicateEventIds,
        highWaterCursor: contextHighWater(records, context)
      };
    });
  }

  async read(
    context: TelemetryTenantContext,
    input: { afterCursor: number; limit: number }
  ): Promise<TelemetryReadResult> {
    validateContext(context);
    if (!Number.isSafeInteger(input.afterCursor) || input.afterCursor < 0) {
      throw new Error("afterCursor must be a non-negative safe integer.");
    }
    if (!Number.isSafeInteger(input.limit) || input.limit < 1) {
      throw new Error("limit must be a positive safe integer.");
    }
    await this.writeQueue;
    const records = await this.load();
    const events = records
      .filter((record) =>
        record.tenantId === context.tenantId &&
        record.projectId === context.projectId &&
        record.cursor > input.afterCursor
      )
      .slice(0, input.limit)
      .map((record) => structuredClone(record));
    return {
      events,
      highWaterCursor: events.at(-1)?.cursor ?? input.afterCursor
    };
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async load() {
    if (this.records) return this.records;
    let raw = "";
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) {
        this.records = [];
        return this.records;
      }
      throw error;
    }
    this.records = raw
      .split("\n")
      .filter((line) => line.trim())
      .map((line, index) => parseStoredRecord(line, index + 1));
    return this.records;
  }
}

function parseStoredRecord(line: string, lineNumber: number): StoredMemoryTelemetryEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error(`Local telemetry file contains invalid JSON on line ${lineNumber}.`);
  }
  if (!isRecord(value)) throw new Error(`Local telemetry line ${lineNumber} is not an object.`);
  const event = parseMemoryTelemetryEvent(value.event);
  if (
    !Number.isSafeInteger(value.cursor) || Number(value.cursor) < 1 ||
    typeof value.tenantId !== "string" || !value.tenantId ||
    typeof value.projectId !== "string" || !value.projectId ||
    value.eventId !== event.eventId ||
    typeof value.occurredAt !== "string" ||
    typeof value.receivedAt !== "string"
  ) {
    throw new Error(`Local telemetry line ${lineNumber} is malformed.`);
  }
  return {
    cursor: Number(value.cursor),
    tenantId: value.tenantId,
    projectId: value.projectId,
    eventId: event.eventId,
    sequence: event.sequence,
    occurredAt: value.occurredAt,
    receivedAt: value.receivedAt,
    event
  };
}

function validateContext(context: TelemetryTenantContext) {
  for (const [field, value] of Object.entries(context)) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Telemetry tenant context ${field} must be a non-empty string.`);
    }
  }
}

function contextHighWater(
  records: readonly StoredMemoryTelemetryEvent[],
  context: TelemetryTenantContext
) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record.tenantId === context.tenantId && record.projectId === context.projectId) {
      return record.cursor;
    }
  }
  return 0;
}

function timestamp(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Telemetry clock returned an invalid timestamp.");
  return date.toISOString();
}

function eventKey(tenantId: string, projectId: string, eventId: string) {
  return JSON.stringify([tenantId, projectId, eventId]);
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
