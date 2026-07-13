import type {
  BuildMemoryLineageInput,
  MemoryLineageEdge,
  MemoryLineageEdgeKind,
  MemoryLineageGraph,
  MemoryLineageNode
} from "@/lib/lineage/types";
import type { DreamProposal, EngramEvent, EngramMemory } from "@/types";

const memoryNodeId = (id: string) => `memory:${id}`;
const turnNodeId = (id: string) => `turn:${id}`;
const dreamNodeId = (id: string) => `dream:${id}`;

export function buildMemoryLineage(input: BuildMemoryLineageInput): MemoryLineageGraph {
  const memories = collectMemorySnapshots(input);
  const nodes = new Map<string, MemoryLineageNode>();
  const edges = new Map<string, MemoryLineageEdge>();

  const ensureMemoryNode = (id: string) => {
    const nodeId = memoryNodeId(id);
    if (nodes.has(nodeId)) return nodeId;

    const memory = memories.get(id);
    nodes.set(nodeId, memory ? memoryToNode(memory) : missingMemoryNode(id));
    return nodeId;
  };

  const addEdge = (
    sourceId: string,
    targetId: string,
    kind: MemoryLineageEdgeKind,
    label: string
  ) => {
    if (sourceId === targetId) return;
    const id = `${kind}:${sourceId}->${targetId}`;
    if (!edges.has(id)) edges.set(id, { id, sourceId, targetId, kind, label });
  };

  memories.forEach((memory) => {
    const targetId = ensureMemoryNode(memory.id);
    unique(memory.sourceMemoryIds ?? []).forEach((sourceMemoryId) => {
      addEdge(ensureMemoryNode(sourceMemoryId), targetId, "derived", "contributed to");
    });
    unique(memory.supersedes ?? []).forEach((supersededMemoryId) => {
      addEdge(ensureMemoryNode(supersededMemoryId), targetId, "superseded_by", "updated by");
    });
  });

  input.turnRecords.forEach((record) => {
    const id = turnNodeId(record.id);
    nodes.set(id, {
      id,
      kind: "turn",
      label: record.userMessage,
      detail: answerDetail(record.originalAnswer),
      timestamp: record.startedAt
    });

    record.retrievedMemories.forEach((memory) => {
      addEdge(ensureMemoryNode(memory.id), id, "supplied_to_answer", "supplied to answer");
    });

    record.events.forEach((event) => processEvent(event, id));
  });

  input.events.forEach((event) => processEvent(event));

  const focusNodeId = ensureMemoryNode(input.focusMemoryId);
  const connectedIds = connectedComponent(focusNodeId, edges.values());
  const connectedNodes = [...nodes.values()]
    .filter((node) => connectedIds.has(node.id))
    .sort(compareNodes);
  const connectedEdges = [...edges.values()]
    .filter((edge) => connectedIds.has(edge.sourceId) && connectedIds.has(edge.targetId))
    .sort(compareEdges);

  return {
    focusMemoryId: input.focusMemoryId,
    nodes: connectedNodes,
    edges: connectedEdges,
    relatedMemoryIds: connectedNodes
      .filter((node) => node.kind === "memory" && node.memoryId)
      .map((node) => node.memoryId as string)
      .sort()
  };

  function processEvent(event: EngramEvent, ownerTurnId?: string) {
    switch (event.type) {
      case "store": {
        const targetId = ensureMemoryNode(event.memory.id);
        if (ownerTurnId) addEdge(ownerTurnId, targetId, "created", "created memory");
        unique(event.memory.supersedes ?? []).forEach((supersededMemoryId) => {
          addEdge(ensureMemoryNode(supersededMemoryId), targetId, "superseded_by", "updated by");
        });
        break;
      }
      case "consolidate": {
        const resultId = ensureMemoryNode(event.added.id);
        if (ownerTurnId) addEdge(ownerTurnId, resultId, "created", "created stable memory");
        unique([...(event.removed ?? []), ...(event.added.sourceMemoryIds ?? [])]).forEach(
          (sourceMemoryId) => {
            addEdge(ensureMemoryNode(sourceMemoryId), resultId, "derived", "contributed to");
          }
        );
        break;
      }
      case "dream_apply":
        processAppliedDream(event.proposal, ownerTurnId);
        break;
      default:
        break;
    }
  }

  function processAppliedDream(proposal: DreamProposal, ownerTurnId?: string) {
    const id = dreamNodeId(proposal.id);
    nodes.set(id, {
      id,
      kind: "dream",
      label: "Applied Dream",
      detail: proposal.reason,
      timestamp: proposal.created_at
    });

    proposal.operations.forEach((operation) => {
      const sourceIds = unique(operation.sourceIds);
      sourceIds.forEach((sourceMemoryId) => {
        addEdge(ensureMemoryNode(sourceMemoryId), id, "dream_proposed", "reviewed in applied Dream");
      });

      if (!operation.result) {
        unique(operation.supersedeIds ?? []).forEach((supersededMemoryId) => {
          addEdge(id, ensureMemoryNode(supersededMemoryId), "dream_proposed", "retired during applied Dream");
        });
        return;
      }

      const resultId = ensureMemoryNode(operation.result.id);
      addEdge(id, resultId, "created", "created during applied Dream");
      if (ownerTurnId) addEdge(ownerTurnId, resultId, "created", "created memory");

      if (operation.type === "merge" || operation.type === "insight") {
        unique([...sourceIds, ...(operation.result.sourceMemoryIds ?? [])]).forEach((sourceMemoryId) => {
          addEdge(ensureMemoryNode(sourceMemoryId), resultId, "derived", "contributed to");
        });
      }

      if (operation.type === "supersede") {
        unique([
          ...(operation.supersedeIds ?? sourceIds),
          ...(operation.result.supersedes ?? [])
        ]).forEach((supersededMemoryId) => {
          addEdge(ensureMemoryNode(supersededMemoryId), resultId, "superseded_by", "updated by");
        });
      }
    });
  }
}

function collectMemorySnapshots(input: BuildMemoryLineageInput) {
  const memories = new Map<string, EngramMemory>();
  const collect = (memory: EngramMemory) => memories.set(memory.id, memory);
  const collectEvent = (event: EngramEvent) => {
    switch (event.type) {
      case "init":
        event.memories.forEach(collect);
        break;
      case "store":
        collect(event.memory);
        break;
      case "retrieve":
        event.accessed?.forEach(collect);
        break;
      case "consolidate":
        collect(event.added);
        break;
      case "dream_apply":
        event.proposal.operations.forEach((operation) => {
          if (operation.result) collect(operation.result);
        });
        break;
      default:
        break;
    }
  };

  input.events.forEach(collectEvent);
  input.turnRecords.forEach((record) => {
    record.retrievedMemories.forEach(collect);
    record.events.forEach(collectEvent);
  });
  input.memories.forEach(collect);
  return memories;
}

function memoryToNode(memory: EngramMemory): MemoryLineageNode {
  return {
    id: memoryNodeId(memory.id),
    kind: "memory",
    label: memory.text,
    detail: memory.status === "superseded" ? "Retired memory" : regionLabel(memory.region),
    timestamp: memory.created_at,
    memoryId: memory.id,
    region: memory.region,
    status: memory.status
  };
}

function missingMemoryNode(id: string): MemoryLineageNode {
  return {
    id: memoryNodeId(id),
    kind: "memory",
    label: "Memory details unavailable",
    detail: `Reference: ${id}`,
    memoryId: id
  };
}

function regionLabel(region: EngramMemory["region"]) {
  switch (region) {
    case "hippocampus":
      return "New memory";
    case "prefrontal":
      return "Working memory";
    case "temporal":
      return "Stable knowledge";
  }
}

function answerDetail(answer: string) {
  const normalized = answer.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return `Answer: ${normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized}`;
}

function connectedComponent(startId: string, edges: Iterable<MemoryLineageEdge>) {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    addNeighbor(edge.sourceId, edge.targetId);
    addNeighbor(edge.targetId, edge.sourceId);
  }

  const visited = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    [...(adjacency.get(current) ?? [])].sort().forEach((neighbor) => {
      if (!visited.has(neighbor)) queue.push(neighbor);
    });
  }
  return visited;

  function addNeighbor(source: string, target: string) {
    const neighbors = adjacency.get(source) ?? new Set<string>();
    neighbors.add(target);
    adjacency.set(source, neighbors);
  }
}

function compareNodes(left: MemoryLineageNode, right: MemoryLineageNode) {
  const timestamp = (left.timestamp ?? "").localeCompare(right.timestamp ?? "");
  if (timestamp !== 0) return timestamp;
  const kindOrder = { turn: 0, dream: 1, memory: 2 } as const;
  return kindOrder[left.kind] - kindOrder[right.kind] || left.id.localeCompare(right.id);
}

function compareEdges(left: MemoryLineageEdge, right: MemoryLineageEdge) {
  return (
    left.sourceId.localeCompare(right.sourceId) ||
    left.targetId.localeCompare(right.targetId) ||
    left.kind.localeCompare(right.kind) ||
    left.id.localeCompare(right.id)
  );
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
