import type { AgentTopology, AgentTopologyEdge, AgentTopologyNode } from "@/lib/topology/types";
import type {
  NormalizedTrace,
  NormalizedTraceStep,
  TraceAgentRef,
  TraceMemoryScopeRef,
  TraceTopologyProvenance
} from "@/lib/traces/types";

export function buildAgentTopology(trace: NormalizedTrace, throughStepIndex = trace.steps.length - 1): AgentTopology {
  const steps = trace.steps.slice(0, Math.max(0, throughStepIndex + 1));
  const nodes = new Map<string, AgentTopologyNode>();
  const edges: AgentTopologyEdge[] = [];

  for (const step of steps) {
    if (step.topology?.agent) upsertAgent(nodes, step.topology.agent, step.id);
    if (step.topology?.handoff) {
      const from = step.topology.handoff.from;
      const to = step.topology.handoff.to;
      if (from) upsertAgent(nodes, from, step.id);
      if (to) upsertAgent(nodes, to, step.id);
      const fromId = from?.id ?? unknownAgentId("source");
      const toId = to?.id ?? unknownAgentId("target");
      if (!from) upsertUnknownAgent(nodes, fromId, "Unrecorded source", step.id);
      if (!to) upsertUnknownAgent(nodes, toId, "Unrecorded target", step.id);
      edges.push({
        id: `handoff-${step.id}`,
        kind: "handoff",
        from: agentNodeId(fromId),
        to: agentNodeId(toId),
        label: step.name,
        provenance: step.topology.handoff.provenance,
        stepId: step.id
      });
    }

    if (step.memoryMappings.some((mapping) => mapping.event)) {
      appendMemoryEdges(step, nodes, edges);
    }
  }

  const nodeList = [...nodes.values()].sort(compareNodes);
  const agentCount = nodeList.filter((node) => node.kind === "agent" && node.provenance !== "unknown").length;
  const storeCount = nodeList.filter((node) => node.kind === "store").length;
  const handoffCount = edges.filter((edge) => edge.kind === "handoff").length;
  const unknownScopeCount = nodeList.filter((node) => node.kind === "store" && node.scope === "unknown").length;

  return deepFreeze({
    version: 1,
    nodes: nodeList,
    edges,
    agentCount,
    storeCount,
    handoffCount,
    unknownScopeCount,
    meaningful: agentCount >= 2 || handoffCount > 0 || nodeList.some((node) => node.kind === "store" && node.scope !== "unknown"),
    caveat: "Topology reconstructs recorded actors, parent-span ownership, handoffs, and memory scope. Unknown scope remains unknown; the graph does not reveal hidden orchestration."
  });
}

function appendMemoryEdges(
  step: NormalizedTraceStep,
  nodes: Map<string, AgentTopologyNode>,
  edges: AgentTopologyEdge[]
) {
  const agent = step.topology?.agent;
  const agentId = agent?.id ?? unknownAgentId("actor");
  if (agent) upsertAgent(nodes, agent, step.id);
  else upsertUnknownAgent(nodes, agentId, "Unattributed operation", step.id);
  const scope = step.topology?.memory ?? unknownScope(step);
  const storeNode = upsertStore(nodes, scope, agentId, step.id);

  step.memoryMappings.forEach((mapping, mappingIndex) => {
    if (!mapping.event) return;
    const kind = edgeKind(mapping.event.type);
    const reads = kind === "memory_read";
    edges.push({
      id: `${kind}-${step.id}-${mappingIndex}`,
      kind,
      from: reads ? storeNode.id : agentNodeId(agentId),
      to: reads ? agentNodeId(agentId) : storeNode.id,
      label: eventLabel(mapping.event.type),
      provenance: combineProvenance(mapping.provenance, scope.provenance, agent?.provenance),
      stepId: step.id
    });
  });
}

function upsertAgent(nodes: Map<string, AgentTopologyNode>, agent: TraceAgentRef, stepId: string) {
  const id = agentNodeId(agent.id);
  const existing = nodes.get(id);
  if (existing?.kind === "agent") {
    if (!existing.stepIds.includes(stepId)) existing.stepIds.push(stepId);
    return existing;
  }
  const node: AgentTopologyNode = {
    id,
    kind: "agent",
    label: agent.name,
    provenance: agent.provenance,
    stepIds: [stepId]
  };
  nodes.set(id, node);
  return node;
}

function upsertUnknownAgent(nodes: Map<string, AgentTopologyNode>, id: string, label: string, stepId: string) {
  const nodeId = agentNodeId(id);
  const existing = nodes.get(nodeId);
  if (existing?.kind === "agent") {
    if (!existing.stepIds.includes(stepId)) existing.stepIds.push(stepId);
    return existing;
  }
  const node: AgentTopologyNode = { id: nodeId, kind: "agent", label, provenance: "unknown", stepIds: [stepId] };
  nodes.set(nodeId, node);
  return node;
}

function upsertStore(
  nodes: Map<string, AgentTopologyNode>,
  memory: TraceMemoryScopeRef,
  agentId: string,
  stepId: string
) {
  const discriminator = memory.storeId ?? (memory.scope === "agent" ? agentId : memory.scope);
  const id = `store:${memory.scope}:${discriminator}`;
  const existing = nodes.get(id);
  if (existing?.kind === "store") {
    if (!existing.stepIds.includes(stepId)) existing.stepIds.push(stepId);
    return existing;
  }
  const node: AgentTopologyNode = {
    id,
    kind: "store",
    label: storeLabel(memory),
    scope: memory.scope,
    ...(memory.storeId ? { storeId: memory.storeId } : {}),
    provenance: memory.provenance,
    stepIds: [stepId]
  };
  nodes.set(id, node);
  return node;
}

function unknownScope(step: NormalizedTraceStep): TraceMemoryScopeRef {
  return {
    scope: "unknown",
    provenance: "unknown",
    sourcePath: `step:${step.id}`,
    note: "No memory scope was recorded for this operation."
  };
}

function edgeKind(eventType: string): AgentTopologyEdge["kind"] {
  if (eventType === "retrieve" || eventType === "load" || eventType === "fire") return "memory_read";
  if (eventType === "consolidate" || eventType.startsWith("dream_")) return "memory_consolidate";
  return "memory_write";
}

function eventLabel(eventType: string) {
  if (eventType === "retrieve") return "retrieved";
  if (eventType === "load" || eventType === "fire") return "loaded";
  if (eventType === "consolidate") return "consolidated";
  if (eventType === "store") return "stored";
  return eventType.replace(/_/g, " ");
}

function combineProvenance(
  mapping: "observed" | "mapped",
  scope: TraceTopologyProvenance,
  agent?: "observed" | "mapped"
): TraceTopologyProvenance {
  if (scope === "unknown" || !agent) return "unknown";
  return mapping === "observed" && scope === "observed" && agent === "observed" ? "observed" : "mapped";
}

function storeLabel(memory: TraceMemoryScopeRef) {
  const label = {
    user: "User memory",
    agent: "Private agent memory",
    run: "Run memory",
    shared: "Shared memory",
    unknown: "Unknown scope"
  }[memory.scope];
  return memory.storeId ? `${label} / ${memory.storeId}` : label;
}

function compareNodes(left: AgentTopologyNode, right: AgentTopologyNode) {
  if (left.kind !== right.kind) return left.kind === "agent" ? -1 : 1;
  return left.label.localeCompare(right.label);
}

function agentNodeId(id: string) {
  return `agent:${id}`;
}

function unknownAgentId(role: string) {
  return `unknown-${role}`;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
