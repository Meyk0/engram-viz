import type { TraceMemoryScope, TraceTopologyProvenance } from "@/lib/traces/types";

export type AgentTopologyNode =
  | {
      id: string;
      kind: "agent";
      label: string;
      provenance: TraceTopologyProvenance;
      stepIds: string[];
    }
  | {
      id: string;
      kind: "store";
      label: string;
      scope: TraceMemoryScope;
      storeId?: string;
      provenance: TraceTopologyProvenance;
      stepIds: string[];
    };

export type AgentTopologyEdge = {
  id: string;
  kind: "handoff" | "memory_read" | "memory_write" | "memory_consolidate";
  from: string;
  to: string;
  label: string;
  provenance: TraceTopologyProvenance;
  stepId: string;
};

export type AgentTopology = {
  version: 1;
  nodes: AgentTopologyNode[];
  edges: AgentTopologyEdge[];
  agentCount: number;
  storeCount: number;
  handoffCount: number;
  unknownScopeCount: number;
  meaningful: boolean;
  caveat: string;
};
