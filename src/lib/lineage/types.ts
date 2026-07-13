import type { BrainRegion, EngramMemory, EngramEvent } from "@/types";
import type { TurnRecord } from "@/lib/evidence/types";

export type MemoryLineageNodeKind = "memory" | "turn" | "dream";

export type MemoryLineageEdgeKind =
  | "created"
  | "derived"
  | "superseded_by"
  | "supplied_to_answer"
  | "dream_proposed";

export type MemoryLineageNode = {
  id: string;
  kind: MemoryLineageNodeKind;
  label: string;
  detail?: string;
  timestamp?: string;
  memoryId?: string;
  region?: BrainRegion;
  status?: EngramMemory["status"];
};

export type MemoryLineageEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  kind: MemoryLineageEdgeKind;
  label: string;
};

export type MemoryLineageGraph = {
  focusMemoryId: string;
  nodes: MemoryLineageNode[];
  edges: MemoryLineageEdge[];
  relatedMemoryIds: string[];
};

export type BuildMemoryLineageInput = {
  focusMemoryId: string;
  memories: EngramMemory[];
  turnRecords: TurnRecord[];
  events: EngramEvent[];
};
