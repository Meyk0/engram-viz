export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

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

export type TelemetryMemoryOwner = {
  /** Provider-neutral owner key when the provider exposes one directly. */
  ownerId?: string;
  userId?: string;
  sessionId?: string;
  agentId?: string;
  /** Provider namespace retained as structured ownership evidence. */
  namespace?: string[];
};

export type TelemetryMemoryRef = {
  id: string;
  content?: JsonValue;
  tier: MemoryTier;
  scope: MemoryScope;
  owner?: TelemetryMemoryOwner;
  provider?: string;
  storeId?: string;
  metadata?: Record<string, JsonValue>;
};

export type TelemetryRetrievalCandidate = {
  memoryId: string;
  /** Snapshot returned by candidate generation, when the provider exposes it. */
  memory?: TelemetryMemoryRef;
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
  owner?: TelemetryMemoryOwner;
  timestamp: string;
  sequence: number;
  operation: MemoryTelemetryOperation;
  actor?: { agentId?: string; agentName?: string };
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
  owner?: TelemetryMemoryOwner;
  scope?: MemoryScope;
  storeId?: string;
  provider?: string;
  actor?: MemoryTelemetryEvent["actor"];
  evidence?: Partial<MemoryTelemetryEvent["evidence"]>;
};

export type AgentTurnEnvelope = {
  schemaVersion: 1;
  turnId: string;
  traceId: string;
  sessionId?: string;
  projectId?: string;
  userId?: string;
  owner?: TelemetryMemoryOwner;
  startedAt: string;
  completedAt: string;
  input: string;
  output?: string;
  status: "completed" | "error";
  provider: { id: string; model?: string };
  telemetryEventIds?: string[];
  error?: { name?: string; message: string };
  metadata?: Record<string, JsonValue>;
};
