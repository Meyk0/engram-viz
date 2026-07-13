import type { NormalizedTrace, NormalizedTraceStep } from "@/lib/traces/types";
import {
  asArray,
  asRecord,
  firstDefined,
  firstString,
  isRecord,
  normalizeKind,
  normalizeStatus,
  normalizeTimestamp,
  parseJsonValue,
  sanitizeJson,
  sortAndReindexSteps,
  stableId
} from "@/lib/traces/adapters/helpers";
import { mapMemoryOperation } from "@/lib/traces/adapters/memory-tools";

function objectType(item: Record<string, unknown>): string | undefined {
  return firstString(item.object, item.type);
}

export function canImportOpenAIAgents(input: unknown): boolean {
  const record = asRecord(input);
  const items = Array.isArray(input) ? input : asArray(record.items);
  return items.some((item) => {
    if (!isRecord(item)) return false;
    const type = objectType(item);
    return type === "trace" || type === "trace.span";
  });
}

export function importOpenAIAgents(input: unknown): NormalizedTrace {
  const wrapper = asRecord(input);
  const items = Array.isArray(input) ? input : asArray(wrapper.items);
  const traceItem = items.find((item) => isRecord(item) && objectType(item) === "trace");
  const traceRecord = asRecord(traceItem);
  const traceId = firstString(traceRecord.id, traceRecord.trace_id, traceRecord.traceId) ??
    stableId("agents-trace", JSON.stringify(sanitizeJson(items)));
  const spans = items.flatMap((item, itemIndex) =>
    isRecord(item) && objectType(item) === "trace.span" ? [{ span: item, itemIndex }] : []
  );

  const steps: NormalizedTraceStep[] = spans.map(({ span, itemIndex }, sourceIndex) => {
    const data = asRecord(firstDefined(span.span_data, span.spanData, span.data));
    const dataType = firstString(data.type, span.span_type, span.spanType) ?? "custom";
    const stepId = firstString(span.id, span.span_id, span.spanId) ??
      stableId("agents-step", `${traceId}:${sourceIndex}:${JSON.stringify(sanitizeJson(span))}`);
    const name = firstString(
      data.name,
      data.function_name,
      data.functionName,
      data.tool_name,
      data.toolName,
      span.name,
      dataType
    ) ?? "agent step";
    const startedAt = normalizeTimestamp(firstDefined(span.started_at, span.startedAt, data.started_at, data.startedAt));
    const endedAt = normalizeTimestamp(firstDefined(span.ended_at, span.endedAt, data.ended_at, data.endedAt));
    const rawInput = parseJsonValue(firstDefined(data.input, data.arguments, data.event, span.input));
    const rawOutput = parseJsonValue(firstDefined(data.output, data.result, span.output));
    const sourcePath = `items[${itemIndex}]`;

    return {
      id: stepId,
      ...(firstString(span.parent_id, span.parentId) ? { parentId: firstString(span.parent_id, span.parentId) } : {}),
      index: sourceIndex,
      kind: normalizeKind(dataType),
      name,
      status: normalizeStatus(
        firstDefined(span.status, data.status, endedAt ? "completed" : undefined),
        Boolean(span.error ?? data.error)
      ),
      ...(startedAt ? { startedAt } : {}),
      ...(endedAt ? { endedAt } : {}),
      ...(sanitizeJson(rawInput) !== undefined ? { input: sanitizeJson(rawInput) } : {}),
      ...(sanitizeJson(rawOutput) !== undefined ? { output: sanitizeJson(rawOutput) } : {}),
      memoryMappings: mapMemoryOperation({
        stepId,
        toolName: name,
        input: rawInput,
        output: rawOutput,
        timestamp: startedAt,
        sourcePath
      })
    };
  });

  const metadata = sanitizeJson(firstDefined(traceRecord.metadata, wrapper.metadata));
  return {
    schemaVersion: 1,
    trace: {
      id: traceId,
      name: firstString(traceRecord.workflow_name, traceRecord.workflowName, traceRecord.name) ?? "Imported agent trace",
      source: {
        provider: "openai",
        format: "agents-sdk-export",
        ...(firstString(wrapper.sdk_version, wrapper.sdkVersion) ? { sdkVersion: firstString(wrapper.sdk_version, wrapper.sdkVersion) } : {})
      },
      ...(firstString(traceRecord.group_id, traceRecord.groupId) ? { groupId: firstString(traceRecord.group_id, traceRecord.groupId) } : {}),
      ...(normalizeTimestamp(firstDefined(traceRecord.started_at, traceRecord.startedAt, steps[0]?.startedAt))
        ? { startedAt: normalizeTimestamp(firstDefined(traceRecord.started_at, traceRecord.startedAt, steps[0]?.startedAt)) }
        : {}),
      ...(normalizeTimestamp(firstDefined(traceRecord.ended_at, traceRecord.endedAt, steps.at(-1)?.endedAt))
        ? { endedAt: normalizeTimestamp(firstDefined(traceRecord.ended_at, traceRecord.endedAt, steps.at(-1)?.endedAt)) }
        : {}),
      ...(isRecord(metadata) ? { metadata } : {})
    },
    steps: sortAndReindexSteps(steps)
  };
}
