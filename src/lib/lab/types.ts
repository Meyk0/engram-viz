import type { TurnRecord } from "@/lib/evidence/types";
import type { NormalizedTraceStep } from "@/lib/traces/types";
import type {
  EngramEvent,
  EngramMemory,
  MemoryRetrievalTrace
} from "@/types";

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
  unchangedMemoryIds: string[];
};

export type MaterializedMemoryBranch = {
  checkpoint: MemoryCheckpoint;
  branch: MemoryBranch;
  memories: EngramMemory[];
  loadedMemoryIds: string[];
  diff: MemoryBranchDiff;
};

