import type {
  NormalizedTraceStep,
  TraceAgentRef,
  TraceHandoffRef,
  TraceMemoryScope,
  TraceMemoryScopeRef,
  TraceTopologyContext
} from "@/lib/traces/types";
import {
  asRecord,
  firstDefined,
  firstString,
  parseJsonValue,
  stableId
} from "@/lib/traces/adapters/helpers";

export function extractTopologyContext(input: {
  data: Record<string, unknown>;
  span: Record<string, unknown>;
  input: unknown;
  output: unknown;
  sourcePath: string;
  stepId: string;
  kind: NormalizedTraceStep["kind"];
  hasMemoryMapping: boolean;
}): TraceTopologyContext | undefined {
  const inputRecord = asRecord(parseJsonValue(input.input));
  const outputRecord = asRecord(parseJsonValue(input.output));
  const metadata = asRecord(firstDefined(input.data.metadata, input.span.metadata));
  const agent = readStepAgent(input.data, input.span, input.sourcePath, input.kind);
  const memory = input.hasMemoryMapping
    ? readMemoryScope(input.data, inputRecord, outputRecord, metadata, input.sourcePath)
    : undefined;
  const handoff = input.kind === "handoff"
    ? readHandoff(input.data, inputRecord, outputRecord, input.sourcePath)
    : undefined;

  return agent || memory || handoff ? { agent, memory, handoff } : undefined;
}

export function propagateParentAgents(steps: NormalizedTraceStep[]): NormalizedTraceStep[] {
  const byId = new Map(steps.map((step) => [step.id, step]));

  return steps.map((step) => {
    const parentAgent = step.topology?.agent ? undefined : findParentAgent(step, byId);
    const agent = step.topology?.agent ?? (parentAgent ? {
      ...parentAgent,
      provenance: "mapped" as const,
      sourcePath: `parent:${parentAgent.sourcePath}`,
      note: "Mapped from the recorded parent-agent span relationship."
    } : undefined);
    const handoff = step.topology?.handoff && !step.topology.handoff.from && agent
      ? {
          ...step.topology.handoff,
          from: agent,
          provenance: step.topology.handoff.provenance === "unknown" ? "mapped" as const : step.topology.handoff.provenance,
          note: `${step.topology.handoff.note} Source agent mapped from the parent span.`
        }
      : step.topology?.handoff;
    const topology = agent || step.topology?.memory || handoff
      ? { ...step.topology, agent, handoff }
      : undefined;
    return topology ? { ...step, topology } : step;
  });
}

function readStepAgent(
  data: Record<string, unknown>,
  span: Record<string, unknown>,
  sourcePath: string,
  kind: NormalizedTraceStep["kind"]
): TraceAgentRef | undefined {
  const agentRecord = asRecord(firstDefined(data.agent, span.agent));
  const explicitId = firstString(
    data.agent_id,
    data.agentId,
    agentRecord.id,
    span.agent_id,
    span.agentId
  );
  const explicitName = firstString(
    data.agent_name,
    data.agentName,
    agentRecord.name,
    span.agent_name,
    span.agentName
  );
  const spanAgentName = kind === "agent" ? firstString(data.name, span.name) : undefined;
  const name = explicitName ?? spanAgentName;
  if (!explicitId && !name) return undefined;
  const id = explicitId ?? stableId("mapped-agent", name ?? "agent");
  return {
    id,
    name: name ?? explicitId ?? "Recorded agent",
    provenance: explicitId ? "observed" : "mapped",
    sourcePath,
    note: explicitId
      ? "Agent identity was recorded in span fields."
      : "Agent id was deterministically mapped from the recorded agent name."
  };
}

function readMemoryScope(
  data: Record<string, unknown>,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  metadata: Record<string, unknown>,
  sourcePath: string
): TraceMemoryScopeRef {
  const rawScope = firstString(
    data.memory_scope,
    data.memoryScope,
    input.memory_scope,
    input.memoryScope,
    output.memory_scope,
    output.memoryScope,
    metadata.memory_scope,
    metadata.memoryScope
  );
  const storeId = firstString(
    data.memory_store_id,
    data.memoryStoreId,
    data.store_id,
    data.storeId,
    input.memory_store_id,
    input.memoryStoreId,
    input.store_id,
    input.storeId,
    output.memory_store_id,
    output.memoryStoreId,
    output.store_id,
    output.storeId,
    metadata.memory_store_id,
    metadata.memoryStoreId
  );
  const scope = normalizeMemoryScope(rawScope);
  return {
    scope,
    ...(storeId ? { storeId } : {}),
    provenance: scope === "unknown" ? "unknown" : "observed",
    sourcePath,
    note: scope === "unknown"
      ? "The trace recorded a memory operation but did not record its memory scope."
      : `Memory scope "${scope}" was recorded in trace fields.`
  };
}

function readHandoff(
  data: Record<string, unknown>,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  sourcePath: string
): TraceHandoffRef {
  const from = readNamedAgent(
    firstDefined(data.from_agent, data.fromAgent, data.source_agent, data.sourceAgent, input.from_agent, input.fromAgent),
    "handoff-from",
    sourcePath
  );
  const to = readNamedAgent(
    firstDefined(data.to_agent, data.toAgent, data.target_agent, data.targetAgent, input.to_agent, input.toAgent, output.to_agent, output.toAgent),
    "handoff-to",
    sourcePath
  );
  return {
    from,
    to,
    provenance: from || to ? "observed" : "unknown",
    sourcePath,
    note: from || to
      ? "Handoff endpoint fields were recorded in the span."
      : "A handoff was recorded, but its source and target agents were not."
  };
}

function readNamedAgent(value: unknown, prefix: string, sourcePath: string): TraceAgentRef | undefined {
  const record = asRecord(value);
  const explicitId = firstString(record.id, record.agent_id, record.agentId);
  const name = firstString(record.name, record.agent_name, record.agentName, typeof value === "string" ? value : undefined);
  if (!explicitId && !name) return undefined;
  return {
    id: explicitId ?? stableId(prefix, name ?? "agent"),
    name: name ?? explicitId ?? "Recorded agent",
    provenance: explicitId ? "observed" : "mapped",
    sourcePath,
    note: explicitId
      ? "Handoff agent identity was recorded."
      : "Handoff agent id was mapped from its recorded name."
  };
}

function normalizeMemoryScope(value?: string): TraceMemoryScope {
  switch (value?.toLowerCase().replace(/[ -]/g, "_")) {
    case "user":
    case "user_memory":
    case "profile":
      return "user";
    case "agent":
    case "private":
    case "agent_private":
      return "agent";
    case "run":
    case "session":
    case "thread":
      return "run";
    case "shared":
    case "team":
    case "global":
      return "shared";
    default:
      return "unknown";
  }
}

function findParentAgent(
  step: NormalizedTraceStep,
  byId: Map<string, NormalizedTraceStep>
): TraceAgentRef | undefined {
  const visited = new Set<string>();
  let parentId = step.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) return undefined;
    if (parent.topology?.agent) return parent.topology.agent;
    parentId = parent.parentId;
  }
  return undefined;
}
