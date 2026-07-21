import type { TurnRecord } from "@/lib/evidence/types";
import type {
  MemoryBranch,
  MemoryBranchMutation,
  MemoryBranchReplayResult,
  MemoryCheckpoint
} from "@/lib/lab/types";
import type { MemoryRegressionArtifact } from "@/lib/regressions";
import type { BrainRegion, EngramMemory } from "@/types";
import type { JsonValue } from "@engramviz/core";

export type IncidentEvidenceOrigin =
  | "observed"
  | "mapped"
  | "derived"
  | "inferred"
  | "simulated"
  | "unavailable";

export type MemoryIncidentEvidenceOrigins = Partial<
  Record<MemoryIncidentStageKind, "observed" | "mapped" | "unavailable">
>;

export type MemoryIncidentStageKind =
  | "memory_state"
  | "retrieval"
  | "active_context"
  | "answer";

export type MemoryIncidentStageStatus = "passed" | "warning" | "failed" | "unknown";

export type MemoryFailureKind =
  | "storage"
  | "update"
  | "retrieval"
  | "ranking"
  | "context"
  | "consolidation"
  | "generation"
  | "unknown";

export type MemoryIncidentEvidence = {
  id: string;
  origin: IncidentEvidenceOrigin;
  stage: MemoryIncidentStageKind;
  label: string;
  detail: string;
  memoryIds: string[];
  sourceEventTypes: string[];
  confidence?: number;
};

export type MemoryIncidentStage = {
  id: string;
  kind: MemoryIncidentStageKind;
  label: string;
  status: MemoryIncidentStageStatus;
  summary: string;
  memoryIds: string[];
  evidenceIds: string[];
};

export type MemoryIncidentDiagnosis = {
  kind: MemoryFailureKind;
  label: string;
  summary: string;
  confidence: number;
  origin: "derived" | "inferred";
  stage: MemoryIncidentStageKind;
  memoryIds: string[];
  evidenceIds: string[];
};

export type MemoryIncident = {
  kind: "engram.memory-incident";
  version: 1;
  id: string;
  title: string;
  status: "open" | "resolved" | "needs_review";
  occurredAt: string;
  question: string;
  observedAnswer: string;
  expectedAnswer?: string;
  checkpoint: MemoryCheckpoint;
  record: TurnRecord;
  memories: EngramMemory[];
  stages: MemoryIncidentStage[];
  evidence: MemoryIncidentEvidence[];
  diagnosis: MemoryIncidentDiagnosis;
  replayMetadata?: Record<string, JsonValue>;
};

export type MemoryIncidentIntervention = {
  id: string;
  label: string;
  description: string;
  reason: string;
  recommended: boolean;
  affectedMemoryIds: string[];
  focusedRegions: BrainRegion[];
  mutations: MemoryBranchMutation[];
};

export type MemoryInfluenceResult = {
  memoryId: string;
  evidence: "simulated";
  changed: boolean;
  normalizedTextDistance: number;
  baselineAnswer: string;
  counterfactualAnswer: string;
  caveat: string;
};

export type MemoryIncidentResolution = {
  incident: MemoryIncident;
  intervention: MemoryIncidentIntervention;
  branch: MemoryBranch;
  replay: MemoryBranchReplayResult;
  regression?: MemoryRegressionArtifact;
};
