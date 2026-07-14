import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Bot,
  Boxes,
  CircleHelp,
  Database,
  Network,
  X
} from "lucide-react";
import type { AgentTopology, AgentTopologyEdge, AgentTopologyNode } from "@/lib/topology/types";
import "./agent-topology.css";

type AgentTopologyPanelProps = {
  currentStepId?: string;
  onClose: () => void;
  onSelectStep?: (stepId: string) => void;
  topology: AgentTopology;
};

export function AgentTopologyPanel({
  currentStepId,
  onClose,
  onSelectStep,
  topology
}: AgentTopologyPanelProps) {
  const agents = topology.nodes.filter((node): node is Extract<AgentTopologyNode, { kind: "agent" }> => node.kind === "agent");
  const stores = topology.nodes.filter((node): node is Extract<AgentTopologyNode, { kind: "store" }> => node.kind === "store");

  return (
    <aside className="secondary-panel secondary-panel-right agent-topology-panel" aria-label="Agent memory topology">
      <header className="topology-header">
        <div>
          <div className="topology-eyebrow"><Network size={12} /> Multi-agent topology</div>
          <h2>Who can remember what</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close agent topology"><X size={14} /></button>
      </header>

      <div className="topology-scroll">
        <section className="topology-summary" aria-label="Topology summary">
          <Metric label="Agents" value={topology.agentCount} />
          <Metric label="Stores" value={topology.storeCount} />
          <Metric label="Handoffs" value={topology.handoffCount} />
          <Metric label="Unknown scope" value={topology.unknownScopeCount} warning={topology.unknownScopeCount > 0} />
        </section>

        <section className="topology-map" aria-label="Agent and memory store map">
          <div className="topology-lane">
            <header><Bot size={12} /> Agents</header>
            <div className="topology-node-grid">
              {agents.map((agent) => (
                <article
                  className="topology-agent-node"
                  data-active={Boolean(currentStepId && agent.stepIds.includes(currentStepId))}
                  data-provenance={agent.provenance}
                  key={agent.id}
                >
                  <Bot size={16} />
                  <div><strong>{agent.label}</strong><span>{agent.provenance} identity</span></div>
                </article>
              ))}
            </div>
          </div>

          <div className="topology-spine" aria-hidden="true"><ArrowRight size={17} /></div>

          <div className="topology-lane topology-store-lane">
            <header><Database size={12} /> Memory planes</header>
            <div className="topology-node-grid">
              {stores.map((store) => (
                <article
                  className="topology-store-node"
                  data-active={Boolean(currentStepId && store.stepIds.includes(currentStepId))}
                  data-provenance={store.provenance}
                  data-scope={store.scope}
                  key={store.id}
                >
                  {store.scope === "unknown" ? <CircleHelp size={16} /> : <Database size={16} />}
                  <div><strong>{store.label}</strong><span>{scopeDescription(store.scope)}</span></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="topology-flow-ledger" aria-label="Recorded topology flows">
          <header><Boxes size={12} /><span>Recorded flow ledger</span><b>{topology.edges.length}</b></header>
          {topology.edges.length > 0 ? (
            <ol>
              {topology.edges.map((edge) => (
                <TopologyFlowRow
                  active={edge.stepId === currentStepId}
                  edge={edge}
                  key={edge.id}
                  nodes={topology.nodes}
                  onSelect={onSelectStep ? () => onSelectStep(edge.stepId) : undefined}
                />
              ))}
            </ol>
          ) : (
            <p>No handoff or memory flow has been recorded at this point in the trace.</p>
          )}
        </section>

        <section className="topology-legend" aria-label="Topology evidence legend">
          <span data-provenance="observed"><i />Observed field</span>
          <span data-provenance="mapped"><i />Mapped from span tree</span>
          <span data-provenance="unknown"><i />Not recorded</span>
        </section>
        <p className="topology-caveat">{topology.caveat}</p>
      </div>
    </aside>
  );
}

function Metric({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return <div data-warning={warning}><span>{label}</span><strong>{value}</strong></div>;
}

function TopologyFlowRow({
  active,
  edge,
  nodes,
  onSelect
}: {
  active: boolean;
  edge: AgentTopologyEdge;
  nodes: AgentTopologyNode[];
  onSelect?: () => void;
}) {
  const from = nodes.find((node) => node.id === edge.from)?.label ?? "Unknown source";
  const to = nodes.find((node) => node.id === edge.to)?.label ?? "Unknown target";
  const content = (
    <>
      <span className="topology-flow-icon">{edgeIcon(edge.kind)}</span>
      <span className="topology-flow-route"><strong>{from}</strong><i>{edge.label}</i><strong>{to}</strong></span>
      <span className="topology-flow-provenance" data-provenance={edge.provenance}>{edge.provenance}</span>
    </>
  );
  return (
    <li data-active={active} data-kind={edge.kind}>
      {onSelect ? <button type="button" onClick={onSelect} aria-label={`Go to topology step: ${edge.label}`}>{content}</button> : <div>{content}</div>}
    </li>
  );
}

function edgeIcon(kind: AgentTopologyEdge["kind"]) {
  if (kind === "memory_read") return <ArrowUpFromLine size={13} />;
  if (kind === "memory_write" || kind === "memory_consolidate") return <ArrowDownToLine size={13} />;
  return <ArrowRight size={13} />;
}

function scopeDescription(scope: Extract<AgentTopologyNode, { kind: "store" }>["scope"]) {
  return {
    user: "persists for one user",
    agent: "visible to one agent",
    run: "limited to this run",
    shared: "visible across recorded agents",
    unknown: "scope was not recorded"
  }[scope];
}
