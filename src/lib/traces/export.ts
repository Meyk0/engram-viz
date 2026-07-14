import { parseNormalizedTrace } from "@/lib/traces/schema";
import type { EngramTraceBundle, JsonValue, NormalizedTrace } from "@/lib/traces/types";

const SENSITIVE_KEY_PATTERN = /(?:^|[_-])(api[_-]?key|authorization|auth|token|secret|password|passwd|cookie|session[_-]?key|tracing[_-]?api[_-]?key)(?:$|[_-])/i;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const OPENAI_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{12,}\b/g;
const REDACTED = "[REDACTED]";

export function createEngramTraceBundle(
  trace: NormalizedTrace,
  exportedAt = new Date().toISOString()
): EngramTraceBundle {
  const redacted = redactSensitiveJson(trace);
  return {
    format: "engram.trace",
    version: 1,
    exportedAt,
    trace: parseNormalizedTrace(redacted.value),
    redactions: {
      count: redacted.count,
      policy: "engram-safe-export-v1"
    }
  };
}

export function isEngramTraceBundle(value: unknown): value is EngramTraceBundle {
  if (!isRecord(value) || value.format !== "engram.trace" || value.version !== 1) return false;
  if (!isRecord(value.redactions) || value.redactions.policy !== "engram-safe-export-v1") return false;
  return isRecord(value.trace);
}

export function redactSensitiveJson(value: unknown): { value: JsonValue; count: number } {
  const counter = { count: 0 };
  const redacted = redactValue(value, counter);
  return { value: redacted ?? null, count: counter.count };
}

function redactValue(value: unknown, counter: { count: number }): JsonValue | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "string") return redactString(value, counter);
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const redacted = redactValue(item, counter);
      return redacted === undefined ? [] : [redacted];
    });
  }
  if (!isRecord(value)) return undefined;

  const output: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(`_${key}_`)) {
      output[key] = REDACTED;
      counter.count += 1;
      continue;
    }
    const redacted = redactValue(item, counter);
    if (redacted !== undefined) output[key] = redacted;
  }
  return output;
}

function redactString(value: string, counter: { count: number }) {
  let count = 0;
  const redacted = value
    .replace(BEARER_PATTERN, () => {
      count += 1;
      return REDACTED;
    })
    .replace(OPENAI_KEY_PATTERN, () => {
      count += 1;
      return REDACTED;
    });
  counter.count += count;
  return redacted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
