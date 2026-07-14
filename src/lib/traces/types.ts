import type { EngramEvent } from "@/types";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type TraceStepKind =
  | "agent"
  | "model"
  | "tool"
  | "handoff"
  | "guardrail"
  | "message"
  | "custom"
  | "error";

export type TraceStepStatus = "in_progress" | "completed" | "error" | "unknown";

export type TraceTopologyProvenance = "observed" | "mapped" | "unknown";
export type TraceMemoryScope = "user" | "agent" | "run" | "shared" | "unknown";

export type TraceAgentRef = {
  id: string;
  name: string;
  provenance: Exclude<TraceTopologyProvenance, "unknown">;
  sourcePath: string;
  note: string;
};

export type TraceMemoryScopeRef = {
  scope: TraceMemoryScope;
  storeId?: string;
  provenance: TraceTopologyProvenance;
  sourcePath: string;
  note: string;
};

export type TraceHandoffRef = {
  from?: TraceAgentRef;
  to?: TraceAgentRef;
  provenance: TraceTopologyProvenance;
  sourcePath: string;
  note: string;
};

export type TraceTopologyContext = {
  agent?: TraceAgentRef;
  memory?: TraceMemoryScopeRef;
  handoff?: TraceHandoffRef;
};

export type TraceMemoryMapping =
  | {
      provenance: "observed" | "mapped";
      event: EngramEvent;
      sourcePath: string;
      note: string;
    }
  | {
      provenance: "inferred";
      event: null;
      sourcePath: string;
      note: string;
    };

export type NormalizedTraceStep = {
  id: string;
  parentId?: string;
  index: number;
  kind: TraceStepKind;
  name: string;
  status: TraceStepStatus;
  startedAt?: string;
  endedAt?: string;
  input?: JsonValue;
  output?: JsonValue;
  memoryMappings: TraceMemoryMapping[];
  topology?: TraceTopologyContext;
};

export type NormalizedTrace = {
  schemaVersion: 1;
  trace: {
    id: string;
    name: string;
    source: {
      provider: string;
      format: string;
      sdkVersion?: string;
    };
    groupId?: string;
    startedAt?: string;
    endedAt?: string;
    metadata?: Record<string, JsonValue>;
  };
  steps: NormalizedTraceStep[];
};

export type TraceImportResult = {
  trace: NormalizedTrace;
  warnings: string[];
};

export type EngramTraceBundle = {
  format: "engram.trace";
  version: 1;
  exportedAt: string;
  trace: NormalizedTrace;
  redactions: {
    count: number;
    policy: "engram-safe-export-v1";
  };
};

export type LiveTraceSnapshot = {
  channelId: string;
  receivedAt: string;
  itemCount: number;
  trace: NormalizedTrace;
  warnings: string[];
};

export function traceStepEvents(step: NormalizedTraceStep): EngramEvent[] {
  return step.memoryMappings.flatMap((mapping) =>
    mapping.event ? [mapping.event] : []
  );
}

export function traceEventsThrough(trace: NormalizedTrace, stepIndex: number): EngramEvent[] {
  return trace.steps
    .slice(0, Math.max(0, stepIndex + 1))
    .flatMap(traceStepEvents);
}

export function traceMemoryOperationCount(trace: NormalizedTrace) {
  return trace.steps.reduce((total, step) => total + traceStepEvents(step).length, 0);
}
