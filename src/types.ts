export type BrainRegion = "prefrontal" | "hippocampus" | "temporal";
export type MemoryDecisionTraceProvider = "deterministic" | "llm" | "fallback";
export type MemoryRetrievalProvider = "lexical" | "semantic" | "fallback";
export type MemoryRetrievalBasis = "semantic" | "lexical" | "guardrail";
export type MemoryStatus = "active" | "superseded";
export type MemoryRetiredReason = "corrected" | "consolidated" | "dream_merge";

export type MemoryDecisionTrace = {
  stage: "memory" | "consolidation";
  operation: "store" | "ignore" | "consolidate" | "skip";
  provider: MemoryDecisionTraceProvider;
  confidence: number;
  reason: string;
  ids?: string[];
  relatedMemoryIds?: string[];
};

export type MemoryRetrievalTrace = {
  provider: MemoryRetrievalProvider;
  reason?: string;
  candidateCount?: number;
  eligibleCount?: number;
  selectedCount?: number;
  limit?: number;
  matches?: Array<{
    id: string;
    rank: number;
    score: number;
    similarity?: number;
    basis: MemoryRetrievalBasis;
    eligible?: boolean;
    selected: boolean;
    filterReason?: string;
    components?: {
      semantic?: number;
      lexical?: number;
      importance?: number;
      access?: number;
      guardrail?: number;
    };
  }>;
};

export type DreamOperationType = "merge" | "supersede" | "insight";

export type DreamOperation = {
  id: string;
  type: DreamOperationType;
  sourceIds: string[];
  result?: EngramMemory;
  supersedeIds?: string[];
  reason: string;
  confidence: number;
};

export type DreamProposal = {
  id: string;
  provider: MemoryDecisionTraceProvider;
  status: "proposed" | "skipped";
  reason: string;
  operations: DreamOperation[];
  created_at: string;
};

export type EngramMemory = {
  id: string;
  text: string;
  importance: number;
  topic?: string;
  kind?: string;
  entities?: string[];
  confidence?: number;
  sourceText?: string;
  cluster?: string;
  status?: MemoryStatus;
  retiredReason?: MemoryRetiredReason;
  supersedes?: string[];
  sourceMemoryIds?: string[];
  region: BrainRegion;
  created_at: string;
  last_accessed?: string;
  access_count: number;
  embedding?: number[];
  x?: number;
  y?: number;
  z?: number;
};

export type EngramEvent =
  | { type: "plan"; decision: MemoryDecisionTrace }
  | { type: "store"; memory: EngramMemory; decision?: MemoryDecisionTrace }
  | {
      type: "retrieve";
      query: string;
      ids: string[];
      accessed?: EngramMemory[];
      retrieval?: MemoryRetrievalTrace;
    }
  | { type: "fire"; ids: string[]; region: BrainRegion }
  | { type: "consolidate"; removed: string[]; added: EngramMemory; decision?: MemoryDecisionTrace }
  | { type: "load"; ids: string[] }
  | { type: "decay"; ids: string[] }
  | { type: "init"; memories: EngramMemory[] }
  | { type: "dream_start"; proposal: DreamProposal }
  | { type: "dream_review"; proposalId: string; ids: string[] }
  | { type: "dream_merge"; proposalId: string; operation: DreamOperation }
  | { type: "dream_supersede"; proposalId: string; operation: DreamOperation }
  | { type: "dream_insight"; proposalId: string; operation: DreamOperation }
  | { type: "dream_complete"; proposal: DreamProposal }
  | { type: "dream_apply"; proposal: DreamProposal }
  | { type: "dream_dismiss"; proposal: DreamProposal };

export type ChatProvider = "demo" | "openai" | "anthropic";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type StreamChunk =
  | { kind: "text"; delta: string }
  | { kind: "event"; event: EngramEvent }
  | { kind: "turn_record"; record: import("@/lib/evidence/types").TurnRecord }
  | { kind: "done" }
  | { kind: "error"; message: string };
