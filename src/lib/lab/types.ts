import type { TurnRecord } from "@/lib/evidence/types";
import type { NormalizedTraceStep } from "@/lib/traces/types";
import type {
  EngramEvent,
  EngramMemory,
  MemoryRetrievalTrace
} from "@/types";
import type {
  MemoryPolicyReplayResult,
  MemoryReplayCapabilities
} from "@engramviz/core";

export type EngramProductMode = "learn" | "observe" | "investigate";

export type MemoryCheckpointSource = "conversation" | "dream" | "trace";

export type MemoryCheckpoint = {
  version: 1;
  id: string;
  index: number;
  label: string;
  source: MemoryCheckpointSource;
  sourceId: string;
  createdAt: string;
  events: EngramEvent[];
  memories: EngramMemory[];
  loadedMemoryIds: string[];
  query?: string;
  answer?: string;
  retrieval?: MemoryRetrievalTrace;
  turnRecord?: TurnRecord;
  traceStep?: NormalizedTraceStep;
};

export type MemoryBranchMutation =
  | {
      id: string;
      type: "quarantine";
      memoryId: string;
      reason: string;
    }
  | {
      id: string;
      type: "replace";
      memoryId: string;
      replacement: EngramMemory;
      reason: string;
    }
  | {
      id: string;
      type: "restore";
      memoryId: string;
      reason: string;
    }
  | {
      id: string;
      type: "include";
      memoryId: string;
      reason: string;
    }
  | {
      id: string;
      type: "supersede";
      memoryId: string;
      supersededByMemoryId: string;
      reason: string;
    };

export type MemoryBranch = {
  version: 1;
  id: string;
  checkpointId: string;
  title: string;
  createdAt: string;
  mutations: MemoryBranchMutation[];
};

export type MemoryBranchDiff = {
  quarantinedMemoryIds: string[];
  replacedMemoryIds: string[];
  addedMemoryIds: string[];
  includedMemoryIds: string[];
  supersededMemoryIds: string[];
  unchangedMemoryIds: string[];
};

export type MaterializedMemoryBranch = {
  checkpoint: MemoryCheckpoint;
  branch: MemoryBranch;
  memories: EngramMemory[];
  loadedMemoryIds: string[];
  diff: MemoryBranchDiff;
};

export type MemoryBranchReplayRequest = {
  record: TurnRecord;
  branch: MemoryBranch;
  branchContextMemories: EngramMemory[];
};

export type MemoryBranchReplayResult = {
  version: 1;
  evidence: "replayed";
  mode: "context-only-counterfactual";
  recordId: string;
  branchId: string;
  baselineMemoryIds: string[];
  branchMemoryIds: string[];
  baselineAnswer: string;
  branchAnswer: string;
  changed: boolean;
  comparison: {
    outcome: "changed" | "stable";
    normalizedTextDistance: number;
    answerLengthDelta: number;
    baselineRuns: 1;
    counterfactualRuns: 1;
  };
  capabilities: MemoryReplayCapabilities;
  reproduction: {
    method: "normalized-exact";
    reproduced: boolean;
    observedAnswer: string;
    replayedAnswer: string;
  };
  caveat: string;
  provider: TurnRecord["provider"];
};

export type MemoryIncidentReplayEvidence =
  | {
      kind: "context-only";
      result: MemoryBranchReplayResult;
    }
  | {
      kind: "policy";
      result: MemoryPolicyReplayResult;
    };
