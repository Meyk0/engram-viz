import type {
  JsonValue,
  NormalizedTraceStep,
  TraceStepKind,
  TraceStepStatus
} from "@/lib/traces/types";

const SENSITIVE_KEY_PATTERN = /^(authorization|tracing[_-]?api[_-]?key)$/i;

export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

export function firstString(...values: unknown[]): string | undefined {
  const value = values.find((candidate) => typeof candidate === "string" && candidate.length > 0);
  return typeof value === "string" ? value : undefined;
}

export function firstNumber(...values: unknown[]): number | undefined {
  const value = values.find((candidate) => typeof candidate === "number" && Number.isFinite(candidate));
  return typeof value === "number" ? value : undefined;
}

export function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return value;

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

export function sanitizeJson(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const sanitized = sanitizeJson(item);
      return sanitized === undefined ? [] : [sanitized];
    });
  }
  if (!isRecord(value)) return undefined;

  const sanitized: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    const cleanItem = sanitizeJson(item);
    if (cleanItem !== undefined) sanitized[key] = cleanItem;
  }
  return sanitized;
}

export function stableId(prefix: string, seed: string): string {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

export function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

export function deterministicTimestamp(value: unknown): string {
  return normalizeTimestamp(value) ?? "1970-01-01T00:00:00.000Z";
}

export function normalizeStatus(value: unknown, hasError = false): TraceStepStatus {
  if (hasError) return "error";
  if (value === "in_progress" || value === "completed" || value === "error") return value;
  if (value === "success" || value === "succeeded") return "completed";
  if (value === "failed") return "error";
  return "unknown";
}

export function normalizeKind(value: unknown): TraceStepKind {
  switch (value) {
    case "agent":
      return "agent";
    case "generation":
    case "response":
    case "model":
      return "model";
    case "function":
    case "tool":
    case "function_call":
      return "tool";
    case "handoff":
      return "handoff";
    case "guardrail":
      return "guardrail";
    case "message":
      return "message";
    case "error":
      return "error";
    default:
      return "custom";
  }
}

export function sortAndReindexSteps(steps: NormalizedTraceStep[]): NormalizedTraceStep[] {
  return steps
    .map((step, sourceIndex) => ({ step, sourceIndex }))
    .sort((left, right) => {
      const leftTime = left.step.startedAt ? Date.parse(left.step.startedAt) : Number.POSITIVE_INFINITY;
      const rightTime = right.step.startedAt ? Date.parse(right.step.startedAt) : Number.POSITIVE_INFINITY;
      if (leftTime !== rightTime) return leftTime - rightTime;
      return left.sourceIndex - right.sourceIndex;
    })
    .map(({ step }, index) => ({ ...step, index }));
}

export function stringList(value: unknown): string[] {
  if (typeof value === "string") return value.length > 0 ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.length > 0) return [item];
    if (!isRecord(item)) return [];
    const id = firstString(item.id, item.memory_id, item.memoryId);
    return id ? [id] : [];
  });
}
