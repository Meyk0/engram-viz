import type { JsonValue } from "@/lib/traces/types";

export type MemoryTelemetryOperation =
  | "store"
  | "retrieve"
  | "load"
  | "update"
  | "supersede"
  | "delete"
  | "summarize"
  | "expire";

export type MemoryTier = "working" | "episodic" | "semantic" | "procedural" | "unknown";
export type MemoryScope = "user" | "agent" | "run" | "shared" | "unknown";
export type MemoryTelemetryEvidenceLevel = "observed" | "mapped";

export type TelemetryMemoryRef = {
  id: string;
  content?: JsonValue;
  tier: MemoryTier;
  scope: MemoryScope;
  provider?: string;
  storeId?: string;
  metadata?: Record<string, JsonValue>;
};

export type TelemetryRetrievalCandidate = {
  memoryId: string;
  rank?: number;
  score?: number;
  eligible?: boolean;
  selected?: boolean;
  filterReason?: string;
};

export type MemoryTelemetryEvent = {
  schemaVersion: 2;
  eventId: string;
  traceId: string;
  spanId?: string;
  parentSpanId?: string;
  sessionId?: string;
  projectId?: string;
  userId?: string;
  timestamp: string;
  sequence: number;
  operation: MemoryTelemetryOperation;
  actor?: {
    agentId?: string;
    agentName?: string;
  };
  memory?: TelemetryMemoryRef;
  memoryIds?: string[];
  retrieval?: {
    query?: string;
    limit?: number;
    candidates?: TelemetryRetrievalCandidate[];
    selectedIds?: string[];
    loadedIds?: string[];
  };
  mutation?: {
    sourceMemoryIds?: string[];
    targetMemoryIds?: string[];
    reason?: string;
  };
  evidence: {
    level: MemoryTelemetryEvidenceLevel;
    adapter: string;
    sourcePath?: string;
    note?: string;
  };
};

export type MemoryTelemetryContext = {
  traceId: string;
  sequence: number;
  timestamp: string;
  eventId?: string;
  spanId?: string;
  parentSpanId?: string;
  sessionId?: string;
  projectId?: string;
  userId?: string;
  scope?: MemoryScope;
  storeId?: string;
  provider?: string;
  actor?: MemoryTelemetryEvent["actor"];
  evidence?: Partial<MemoryTelemetryEvent["evidence"]>;
};
