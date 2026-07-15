import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseAgentTurnEnvelope } from "@engramviz/core";
import type { AgentTurnEnvelope } from "@engramviz/core";
import type { TelemetryTenantContext } from "@/lib/ingest/types";

const TURNS_FILENAME = "agent-turns.ndjson";

export type StoredAgentTurn = {
  cursor: number;
  tenantId: string;
  projectId: string;
  receivedAt: string;
  turn: AgentTurnEnvelope;
};

export interface AgentTurnStore {
  append(context: TelemetryTenantContext, turn: AgentTurnEnvelope): Promise<{ duplicate: boolean; cursor: number }>;
  read(context: TelemetryTenantContext): Promise<StoredAgentTurn[]>;
}

export class InMemoryAgentTurnStore implements AgentTurnStore {
  private readonly records: StoredAgentTurn[] = [];

  async append(context: TelemetryTenantContext, input: AgentTurnEnvelope) {
    const turn = validateTurn(context, input);
    const existing = this.records.find((record) => sameTurn(record, context, turn.turnId));
    if (existing) return { duplicate: true, cursor: existing.cursor };
    const record = createStoredTurn(this.records.at(-1)?.cursor ?? 0, context, turn);
    this.records.push(record);
    return { duplicate: false, cursor: record.cursor };
  }

  async read(context: TelemetryTenantContext) {
    return this.records
      .filter((record) => record.tenantId === context.tenantId && record.projectId === context.projectId)
      .map((record) => structuredClone(record));
  }
}

export class FileAgentTurnStore implements AgentTurnStore {
  readonly filePath: string;
  private records: StoredAgentTurn[] | undefined;
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(directory: string) {
    if (!directory.trim()) throw new Error("Local turn directory must not be empty.");
    this.filePath = path.join(path.resolve(directory), TURNS_FILENAME);
  }

  append(context: TelemetryTenantContext, input: AgentTurnEnvelope) {
    return this.enqueue(async () => {
      const turn = validateTurn(context, input);
      const records = await this.load();
      const existing = records.find((record) => sameTurn(record, context, turn.turnId));
      if (existing) return { duplicate: true, cursor: existing.cursor };
      const record = createStoredTurn(records.at(-1)?.cursor ?? 0, context, turn);
      await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      await appendFile(this.filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
      records.push(record);
      return { duplicate: false, cursor: record.cursor };
    });
  }

  async read(context: TelemetryTenantContext) {
    await this.writeQueue;
    return (await this.load())
      .filter((record) => record.tenantId === context.tenantId && record.projectId === context.projectId)
      .map((record) => structuredClone(record));
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
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        this.records = [];
        return this.records;
      }
      throw error;
    }
    this.records = raw.split("\n").filter(Boolean).map((line, index) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error(`Local turn file contains invalid JSON on line ${index + 1}.`);
      }
      if (!isRecord(value) || !isRecord(value.turn)) {
        throw new Error(`Local turn line ${index + 1} is malformed.`);
      }
      const turn = parseAgentTurnEnvelope(value.turn);
      if (
        !Number.isSafeInteger(value.cursor) || Number(value.cursor) < 1 ||
        typeof value.tenantId !== "string" || typeof value.projectId !== "string" ||
        typeof value.receivedAt !== "string"
      ) throw new Error(`Local turn line ${index + 1} is malformed.`);
      return {
        cursor: Number(value.cursor),
        tenantId: value.tenantId,
        projectId: value.projectId,
        receivedAt: value.receivedAt,
        turn
      };
    });
    return this.records;
  }
}

function validateTurn(context: TelemetryTenantContext, input: AgentTurnEnvelope) {
  const turn = parseAgentTurnEnvelope(input);
  if (turn.projectId !== undefined && turn.projectId !== context.projectId) {
    throw new Error(`Agent turn "${turn.turnId}" belongs to a different project.`);
  }
  return turn;
}

function createStoredTurn(
  currentCursor: number,
  context: TelemetryTenantContext,
  turn: AgentTurnEnvelope
): StoredAgentTurn {
  return {
    cursor: currentCursor + 1,
    tenantId: context.tenantId,
    projectId: context.projectId,
    receivedAt: new Date().toISOString(),
    turn: structuredClone(turn)
  };
}

function sameTurn(record: StoredAgentTurn, context: TelemetryTenantContext, turnId: string) {
  return record.tenantId === context.tenantId &&
    record.projectId === context.projectId &&
    record.turn.turnId === turnId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
