export type BrainRegion = "prefrontal" | "hippocampus" | "temporal";
export type MemoryDecisionTraceProvider = "deterministic" | "llm" | "fallback";
export type MemoryRetrievalProvider = "lexical" | "semantic" | "fallback";
export type MemoryStatus = "active" | "superseded";

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
  | { type: "retrieve"; query: string; ids: string[]; retrieval?: MemoryRetrievalTrace }
  | { type: "fire"; ids: string[]; region: BrainRegion }
  | { type: "consolidate"; removed: string[]; added: EngramMemory; decision?: MemoryDecisionTrace }
  | { type: "load"; ids: string[] }
  | { type: "decay"; ids: string[] }
  | { type: "init"; memories: EngramMemory[] };

export type ChatProvider = "demo" | "openai" | "anthropic";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type StreamChunk =
  | { kind: "text"; delta: string }
  | { kind: "event"; event: EngramEvent }
  | { kind: "done" }
  | { kind: "error"; message: string };
