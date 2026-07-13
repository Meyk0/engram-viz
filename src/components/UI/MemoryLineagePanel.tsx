import {
  BrainCircuit,
  GitBranch,
  MessageSquareText,
  MoonStar,
  Target,
  X
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  MemoryLineageEdge,
  MemoryLineageEdgeKind,
  MemoryLineageGraph,
  MemoryLineageNode
} from "@/lib/lineage/types";
import "./memory-lineage.css";

export type MemoryLineagePanelProps = {
  graph?: MemoryLineageGraph;
  open: boolean;
  onClose: () => void;
  onSelectMemory?: (id: string) => void;
};

export function MemoryLineagePanel({
  graph,
  open,
  onClose,
  onSelectMemory
}: MemoryLineagePanelProps) {
  if (!open) return null;

  const nodes = graph ? orderNodes(graph) : [];
  const focusNode = graph
    ? graph.nodes.find((node) => node.memoryId === graph.focusMemoryId)
    : undefined;
  const incomingEdges = groupIncomingEdges(graph?.edges ?? []);

  return (
    <aside
      className="secondary-panel secondary-panel-right memory-lineage-panel"
      aria-label="Memory lineage"
    >
      <header className="memory-lineage-header">
        <div>
          <div className="memory-lineage-eyebrow">
            <GitBranch aria-hidden="true" size={12} />
            Provenance trace
          </div>
          <h2>Memory lineage</h2>
        </div>
        <button
          className="memory-lineage-close"
          type="button"
          onClick={onClose}
          aria-label="Close memory lineage"
        >
          <X aria-hidden="true" size={14} />
        </button>
      </header>

      <div className="memory-lineage-body">
        {!graph || nodes.length === 0 || !focusNode ? (
          <MemoryLineageEmpty />
        ) : (
          <>
            <section className="memory-lineage-focus" aria-labelledby="memory-lineage-focus-title">
              <div className="memory-lineage-section-label" id="memory-lineage-focus-title">
                <Target aria-hidden="true" size={11} />
                Focused memory
              </div>
              <p>{focusNode.label}</p>
              <div className="memory-lineage-focus-meta">
                {focusNode.region ? <span>{formatRegion(focusNode.region)}</span> : null}
                {focusNode.status ? <span>{formatStatus(focusNode.status)}</span> : null}
              </div>
            </section>

            <section className="memory-lineage-trace" aria-labelledby="memory-lineage-trace-title">
              <div className="memory-lineage-trace-heading">
                <h3 id="memory-lineage-trace-title">Provenance path</h3>
                <span>{nodes.length} nodes</span>
              </div>
              <ol className="memory-lineage-node-list">
                {nodes.map((node) => (
                  <LineageNodeItem
                    edges={incomingEdges.get(node.id) ?? []}
                    focusMemoryId={graph.focusMemoryId}
                    key={node.id}
                    node={node}
                    onSelectMemory={onSelectMemory}
                  />
                ))}
              </ol>
            </section>

            <LineageLegend />
          </>
        )}
      </div>
    </aside>
  );
}

function MemoryLineageEmpty() {
  return (
    <div className="memory-lineage-empty" role="status">
      <GitBranch aria-hidden="true" size={24} />
      <strong>No lineage to show yet</strong>
      <p>
        Store, retrieve, update, or dream over this memory to reveal where it came from and where it went.
      </p>
    </div>
  );
}

function LineageNodeItem({
  edges,
  focusMemoryId,
  node,
  onSelectMemory
}: {
  edges: MemoryLineageEdge[];
  focusMemoryId: string;
  node: MemoryLineageNode;
  onSelectMemory?: (id: string) => void;
}) {
  const focused = node.memoryId === focusMemoryId;
  const content = (
    <>
      <span className="memory-lineage-node-icon">{nodeIcon(node.kind)}</span>
      <span className="memory-lineage-node-copy">
        <span className="memory-lineage-node-meta">
          <b>{nodeKindLabel(node.kind)}</b>
          {node.timestamp ? <time dateTime={node.timestamp}>{formatTimestamp(node.timestamp)}</time> : null}
        </span>
        <strong>{node.label}</strong>
        {node.detail ? <small>{node.detail}</small> : null}
        {node.kind === "memory" && (node.region || node.status) ? (
          <span className="memory-lineage-node-tags">
            {node.region ? <i>{formatRegion(node.region)}</i> : null}
            {node.status ? <i>{formatStatus(node.status)}</i> : null}
          </span>
        ) : null}
      </span>
      {focused ? <span className="memory-lineage-focus-mark">Focus</span> : null}
    </>
  );

  return (
    <li className="memory-lineage-node-item" data-kind={node.kind} data-focused={focused}>
      {edges.length > 0 ? (
        <div className="memory-lineage-connectors" aria-label="Incoming relationships">
          {edges.map((edge) => (
            <span data-edge-kind={edge.kind} key={edge.id}>
              {edgeLabel(edge)}
            </span>
          ))}
        </div>
      ) : null}
      {node.kind === "memory" && node.memoryId && onSelectMemory ? (
        <button
          className="memory-lineage-node memory-lineage-node-button"
          type="button"
          onClick={() => onSelectMemory(node.memoryId!)}
          aria-label={`Select memory: ${node.label}`}
        >
          {content}
        </button>
      ) : (
        <div className="memory-lineage-node">{content}</div>
      )}
    </li>
  );
}

function LineageLegend() {
  return (
    <section className="memory-lineage-legend" aria-labelledby="memory-lineage-legend-title">
      <h3 id="memory-lineage-legend-title">Legend</h3>
      <ul>
        <li data-kind="memory">{nodeIcon("memory")}<span><b>Memory</b>Stored or stabilized knowledge</span></li>
        <li data-kind="turn">{nodeIcon("turn")}<span><b>Turn</b>A conversation event</span></li>
        <li data-kind="dream">{nodeIcon("dream")}<span><b>Dream</b>An offline reflection proposal</span></li>
      </ul>
      <p>“Supplied to answer” means the memory entered context. It does not prove that it caused the answer.</p>
    </section>
  );
}

function nodeIcon(kind: MemoryLineageNode["kind"]): ReactNode {
  switch (kind) {
    case "memory":
      return <BrainCircuit aria-hidden="true" size={14} />;
    case "turn":
      return <MessageSquareText aria-hidden="true" size={14} />;
    case "dream":
      return <MoonStar aria-hidden="true" size={14} />;
  }
}

function nodeKindLabel(kind: MemoryLineageNode["kind"]) {
  switch (kind) {
    case "memory":
      return "Memory";
    case "turn":
      return "Conversation turn";
    case "dream":
      return "Dream review";
  }
}

function edgeLabel(edge: MemoryLineageEdge) {
  if (edge.kind === "supplied_to_answer") return "supplied to answer";
  return edge.label.trim() || defaultEdgeLabel(edge.kind);
}

function defaultEdgeLabel(kind: MemoryLineageEdgeKind) {
  switch (kind) {
    case "created":
      return "created";
    case "derived":
      return "derived into";
    case "superseded_by":
      return "superseded by";
    case "supplied_to_answer":
      return "supplied to answer";
    case "dream_proposed":
      return "proposed during dream";
  }
}

function formatRegion(region: NonNullable<MemoryLineageNode["region"]>) {
  if (region === "hippocampus") return "New memory";
  if (region === "prefrontal") return "Working memory";
  return "Stable knowledge";
}

function formatStatus(status: NonNullable<MemoryLineageNode["status"]>) {
  return status === "superseded" ? "Retired" : "Active";
}

function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function groupIncomingEdges(edges: MemoryLineageEdge[]) {
  const grouped = new Map<string, MemoryLineageEdge[]>();
  for (const edge of edges) {
    const existing = grouped.get(edge.targetId) ?? [];
    existing.push(edge);
    grouped.set(edge.targetId, existing);
  }
  return grouped;
}

function orderNodes(graph: MemoryLineageGraph) {
  const originalIndex = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const indegree = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();

  for (const edge of graph.edges) {
    if (!nodeById.has(edge.sourceId) || !nodeById.has(edge.targetId)) continue;
    indegree.set(edge.targetId, (indegree.get(edge.targetId) ?? 0) + 1);
    outgoing.set(edge.sourceId, [...(outgoing.get(edge.sourceId) ?? []), edge.targetId]);
  }

  const ready = graph.nodes.filter((node) => indegree.get(node.id) === 0).sort(compareNodes(originalIndex));
  const ordered: MemoryLineageNode[] = [];

  while (ready.length > 0) {
    const node = ready.shift()!;
    ordered.push(node);
    for (const targetId of outgoing.get(node.id) ?? []) {
      const nextIndegree = (indegree.get(targetId) ?? 1) - 1;
      indegree.set(targetId, nextIndegree);
      if (nextIndegree === 0) {
        const target = nodeById.get(targetId);
        if (target) {
          ready.push(target);
          ready.sort(compareNodes(originalIndex));
        }
      }
    }
  }

  const orderedIds = new Set(ordered.map((node) => node.id));
  const cyclicOrDetached = graph.nodes
    .filter((node) => !orderedIds.has(node.id))
    .sort(compareNodes(originalIndex));
  return [...ordered, ...cyclicOrDetached];
}

function compareNodes(originalIndex: Map<string, number>) {
  return (left: MemoryLineageNode, right: MemoryLineageNode) => {
    const leftTime = timestampValue(left.timestamp);
    const rightTime = timestampValue(right.timestamp);
    if (leftTime !== rightTime) return leftTime - rightTime;
    return (originalIndex.get(left.id) ?? 0) - (originalIndex.get(right.id) ?? 0);
  };
}

function timestampValue(timestamp?: string) {
  if (!timestamp) return Number.MAX_SAFE_INTEGER;
  const value = Date.parse(timestamp);
  return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
}
