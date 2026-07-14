import { createHash, timingSafeEqual } from "node:crypto";
import type { TelemetryTenantContext } from "@/lib/ingest/types";

export const TELEMETRY_INGEST_KEYS_ENV = "ENGRAM_INGEST_KEYS_JSON";

export type TelemetryIngestKey = TelemetryTenantContext & {
  tokenSha256: string;
};

export class TelemetryIngestAuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelemetryIngestAuthConfigurationError";
  }
}

export function parseTelemetryIngestKeys(raw = process.env[TELEMETRY_INGEST_KEYS_ENV]): TelemetryIngestKey[] {
  if (!raw?.trim()) return [];

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new TelemetryIngestAuthConfigurationError(`${TELEMETRY_INGEST_KEYS_ENV} must be valid JSON.`);
  }
  if (!Array.isArray(value)) {
    throw new TelemetryIngestAuthConfigurationError(`${TELEMETRY_INGEST_KEYS_ENV} must be a JSON array.`);
  }

  const keys = value.map((entry, index) => parseKey(entry, index));
  const keyIds = new Set<string>();
  for (const key of keys) {
    if (keyIds.has(key.keyId)) {
      throw new TelemetryIngestAuthConfigurationError(`Duplicate telemetry keyId "${key.keyId}".`);
    }
    keyIds.add(key.keyId);
  }
  return keys;
}

export function authenticateTelemetryRequest(
  request: Request,
  keys = parseTelemetryIngestKeys()
): TelemetryTenantContext | undefined {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1] || keys.length === 0) return undefined;

  const candidate = Buffer.from(hashTelemetryIngestToken(match[1]), "hex");
  const configured = keys.find((key) => {
    const expected = Buffer.from(key.tokenSha256, "hex");
    return expected.length === candidate.length && timingSafeEqual(expected, candidate);
  });
  if (!configured) return undefined;
  return {
    tenantId: configured.tenantId,
    projectId: configured.projectId,
    keyId: configured.keyId
  };
}

export function hashTelemetryIngestToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function parseKey(value: unknown, index: number): TelemetryIngestKey {
  if (!isRecord(value)) invalid(index, "must be an object");
  const keyId = stringField(value, "keyId", index);
  const tenantId = stringField(value, "tenantId", index);
  const projectId = stringField(value, "projectId", index);
  const tokenSha256 = stringField(value, "tokenSha256", index).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(tokenSha256)) invalid(index, "tokenSha256 must be a SHA-256 hex digest");
  return { keyId, tenantId, projectId, tokenSha256 };
}

function stringField(value: Record<string, unknown>, field: string, index: number) {
  const candidate = value[field];
  if (typeof candidate !== "string" || !candidate.trim() || candidate.length > 160) {
    invalid(index, `${field} must be a non-empty string of at most 160 characters`);
  }
  return candidate.trim();
}

function invalid(index: number, reason: string): never {
  throw new TelemetryIngestAuthConfigurationError(
    `${TELEMETRY_INGEST_KEYS_ENV}[${index}] ${reason}.`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
