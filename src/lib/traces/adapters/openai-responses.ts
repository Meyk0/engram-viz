import type { NormalizedTrace, NormalizedTraceStep } from "@/lib/traces/types";
import {
  asArray,
  asRecord,
  firstDefined,
  firstString,
  isRecord,
  normalizeStatus,
  normalizeTimestamp,
  parseJsonValue,
  sanitizeJson,
  sortAndReindexSteps,
  stableId
} from "@/lib/traces/adapters/helpers";
import { mapMemoryOperation } from "@/lib/traces/adapters/memory-tools";

type ResponseCapture = {
  response: Record<string, unknown>;
  wrapper: Record<string, unknown>;
  sourceIndex: number;
};

function responseCaptures(input: unknown): ResponseCapture[] {
  const root = asRecord(input);
  if (root.object === "response" || root.type === "response") {
    return [{ response: root, wrapper: {}, sourceIndex: 0 }];
  }

  return asArray(root.responses).flatMap((entry, sourceIndex) => {
    if (!isRecord(entry)) return [];
    const nested = asRecord(entry.response);
    const response = nested.object === "response" || nested.type === "response" ? nested : entry;
    return response.object === "response" || response.type === "response"
      ? [{ response, wrapper: entry, sourceIndex }]
      : [];
  });
}

export function canImportOpenAIResponses(input: unknown): boolean {
  return responseCaptures(input).length > 0;
}

function outputItems(capture: ResponseCapture): Record<string, unknown>[] {
  return asArray(capture.response.output).filter(isRecord);
}

export function importOpenAIResponses(input: unknown): NormalizedTrace {
  const root = asRecord(input);
  const captures = responseCaptures(input);
  const steps: NormalizedTraceStep[] = [];
  const outputsByCallId = new Map<string, Record<string, unknown>>();

  captures.forEach((capture) => {
    const possibleOutputs = [
      ...asArray(capture.wrapper.input),
      ...asArray(capture.response.input),
      ...outputItems(capture)
    ].filter(isRecord);
    possibleOutputs.forEach((item) => {
      if (item.type !== "function_call_output") return;
      const callId = firstString(item.call_id, item.callId);
      if (callId) outputsByCallId.set(callId, item);
    });
  });

  captures.forEach((capture) => {
    const responseId = firstString(capture.response.id) ?? `response-${capture.sourceIndex}`;
    const items = outputItems(capture);

    items.forEach((item, itemIndex) => {
      if (item.type !== "function_call") return;
      const callId = firstString(item.call_id, item.callId, item.id) ??
        stableId("response-call", `${responseId}:${itemIndex}:${JSON.stringify(sanitizeJson(item))}`);
      const name = firstString(item.name) ?? "function_call";
      const outputItem = outputsByCallId.get(callId);
      const rawInput = parseJsonValue(firstDefined(item.arguments, item.input));
      const rawOutput = parseJsonValue(firstDefined(outputItem?.output, outputItem?.result));
      const startedAt = normalizeTimestamp(firstDefined(
        item.started_at,
        item.startedAt,
        capture.wrapper.started_at,
        capture.wrapper.startedAt,
        capture.response.created_at,
        capture.response.createdAt
      ));
      const endedAt = normalizeTimestamp(firstDefined(
        item.ended_at,
        item.endedAt,
        outputItem?.ended_at,
        outputItem?.endedAt,
        capture.wrapper.ended_at,
        capture.wrapper.endedAt
      ));
      const sourcePath = `responses[${capture.sourceIndex}].output[${itemIndex}]`;
      const index = steps.length;

      steps.push({
        id: callId,
        index,
        kind: "tool",
        name,
        status: normalizeStatus(firstDefined(item.status, outputItem?.status, outputItem ? "completed" : undefined)),
        ...(startedAt ? { startedAt } : {}),
        ...(endedAt ? { endedAt } : {}),
        ...(sanitizeJson(rawInput) !== undefined ? { input: sanitizeJson(rawInput) } : {}),
        ...(sanitizeJson(rawOutput) !== undefined ? { output: sanitizeJson(rawOutput) } : {}),
        memoryMappings: mapMemoryOperation({
          stepId: callId,
          toolName: name,
          input: rawInput,
          output: rawOutput,
          timestamp: startedAt,
          sourcePath
        })
      });
    });
  });

  const firstResponse = captures[0]?.response ?? {};
  const lastResponse = captures.at(-1)?.response ?? {};
  const traceId = firstString(root.id, firstResponse.id) ??
    stableId("responses-trace", JSON.stringify(sanitizeJson(input)));
  const metadata = sanitizeJson(root.metadata);

  return {
    schemaVersion: 1,
    trace: {
      id: traceId,
      name: firstString(root.name, root.workflow_name, root.workflowName) ?? "Imported Responses trace",
      source: {
        provider: "openai",
        format: "responses-api",
        ...(firstString(root.sdk_version, root.sdkVersion) ? { sdkVersion: firstString(root.sdk_version, root.sdkVersion) } : {})
      },
      ...(normalizeTimestamp(firstDefined(
        root.started_at,
        root.startedAt,
        captures[0]?.wrapper.started_at,
        captures[0]?.wrapper.startedAt,
        firstResponse.created_at,
        firstResponse.createdAt
      )) ? {
        startedAt: normalizeTimestamp(firstDefined(
          root.started_at,
          root.startedAt,
          captures[0]?.wrapper.started_at,
          captures[0]?.wrapper.startedAt,
          firstResponse.created_at,
          firstResponse.createdAt
        ))
      } : {}),
      ...(normalizeTimestamp(firstDefined(
        root.ended_at,
        root.endedAt,
        captures.at(-1)?.wrapper.ended_at,
        captures.at(-1)?.wrapper.endedAt,
        lastResponse.completed_at,
        lastResponse.completedAt
      )) ? {
        endedAt: normalizeTimestamp(firstDefined(
          root.ended_at,
          root.endedAt,
          captures.at(-1)?.wrapper.ended_at,
          captures.at(-1)?.wrapper.endedAt,
          lastResponse.completed_at,
          lastResponse.completedAt
        ))
      } : {}),
      ...(isRecord(metadata) ? { metadata } : {})
    },
    steps: sortAndReindexSteps(steps)
  };
}
