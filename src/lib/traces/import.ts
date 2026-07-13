import { parseNormalizedTrace } from "@/lib/traces/schema";
import type { NormalizedTrace, TraceImportResult } from "@/lib/traces/types";
import {
  canImportOpenAIAgents,
  canImportOpenAIResponses,
  importOpenAIAgents,
  importOpenAIResponses
} from "@/lib/traces/adapters";
import { isRecord, sanitizeJson, sortAndReindexSteps } from "@/lib/traces/adapters/helpers";

const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_TRACE_STEPS = 1000;

function parseInput(input: string | unknown): unknown {
  if (typeof input !== "string") return input;
  if (new TextEncoder().encode(input).byteLength > MAX_JSON_BYTES) {
    throw new Error("Trace JSON exceeds the 2 MB import limit.");
  }

  try {
    return JSON.parse(input) as unknown;
  } catch {
    throw new Error("Trace import requires valid JSON.");
  }
}

function sanitizeNormalizedTrace(input: unknown): NormalizedTrace {
  const sanitized = sanitizeJson(input);
  const trace = parseNormalizedTrace(sanitized);
  return {
    ...trace,
    steps: sortAndReindexSteps(trace.steps)
  };
}

export function importAgentTrace(input: string | unknown): TraceImportResult {
  const parsed = parseInput(input);
  if (!isRecord(parsed) && !Array.isArray(parsed)) {
    throw new Error("Unsupported trace format. Import an Engram trace, OpenAI Agents export, or Responses capture.");
  }

  let trace: NormalizedTrace;
  if (isRecord(parsed) && parsed.schemaVersion === 1 && isRecord(parsed.trace) && Array.isArray(parsed.steps)) {
    trace = sanitizeNormalizedTrace(parsed);
  } else if (canImportOpenAIAgents(parsed)) {
    trace = importOpenAIAgents(parsed);
  } else if (canImportOpenAIResponses(parsed)) {
    trace = importOpenAIResponses(parsed);
  } else {
    throw new Error("Unsupported trace format. Import an Engram trace, OpenAI Agents export, or Responses capture.");
  }

  if (trace.steps.length > MAX_TRACE_STEPS) {
    throw new Error(`Trace contains more than ${MAX_TRACE_STEPS} steps.`);
  }

  const validated = parseNormalizedTrace(trace);
  const memoryOperationCount = validated.steps.reduce(
    (count, step) => count + step.memoryMappings.filter((mapping) => mapping.event !== null).length,
    0
  );

  return {
    trace: validated,
    warnings: memoryOperationCount === 0
      ? ["No memory operations were observed in this trace. Generic agent activity will not animate the memory model."]
      : []
  };
}
