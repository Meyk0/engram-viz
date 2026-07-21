import type { JsonValue, MemoryScope, MemoryTier } from "./types.js";

export type MemoryDecisionEvidenceLevel =
  | "observed"
  | "mapped"
  | "derived"
  | "simulated"
  | "unavailable";

export type MemoryDecisionStageKind =
  | "memory_state"
  | "retrieval"
  | "selection"
  | "active_context"
  | "answer";

export type MemoryDecisionStatus =
  | "active"
  | "superseded"
  | "quarantined"
  | "expired"
  | "deleted"
  | "unknown";

export type MemoryDecisionMemory = {
  id: string;
  content: JsonValue;
  subject?: string;
  value?: JsonValue;
  status: MemoryDecisionStatus;
  tier: MemoryTier;
  scope: MemoryScope;
  provider?: string;
  storeId?: string;
  createdAt?: string;
  updatedAt?: string;
  validFrom?: string;
  validTo?: string;
  supersedes?: string[];
  supersededBy?: string;
  owner?: {
    type: "user" | "agent" | "tenant" | "session" | "shared";
    id: string;
  };
  namespace?: string;
  metadata?: Record<string, JsonValue>;
  evidence: MemoryDecisionEvidenceLevel;
};

export type MemoryDecisionCandidate = {
  memoryId: string;
  memory?: MemoryDecisionMemory;
  rank?: number;
  score?: number;
  scoreComponents?: Record<string, number>;
  eligible: boolean;
  selected: boolean;
  loaded: boolean;
  filterReason?: string;
  evidence: MemoryDecisionEvidenceLevel;
};

export type MemoryPolicySnapshot = {
  id: string;
  version?: string;
  fingerprint?: string;
  configuration?: Record<string, JsonValue>;
  corpus?: {
    id?: string;
    version?: string;
    fingerprint?: string;
  };
  evidence: MemoryDecisionEvidenceLevel;
};

export type MemoryDecisionRunV3 = {
  format: "engram.memory-decision-run";
  version: 3;
  id: string;
  traceId: string;
  turnId: string;
  sessionId?: string;
  projectId?: string;
  userId?: string;
  startedAt: string;
  completedAt: string;
  input: string;
  memoryState: {
    before: MemoryDecisionMemory[];
    after: MemoryDecisionMemory[];
  };
  retrieval: {
    query: string;
    limit?: number;
    candidates: MemoryDecisionCandidate[];
    selectedIds: string[];
    policy: MemoryPolicySnapshot;
  };
  context: {
    loadedIds: string[];
    orderedIds: string[];
    truncatedIds: string[];
    forcedIds: string[];
    tokenCount?: number;
    tokenBudget?: number;
    evidence: MemoryDecisionEvidenceLevel;
  };
  answer: {
    content: string;
    provider: { id: string; model?: string };
    evidence: MemoryDecisionEvidenceLevel;
  };
  evidenceCoverage: Record<MemoryDecisionStageKind, MemoryDecisionEvidenceLevel>;
  metadata?: Record<string, JsonValue>;
};

export type MemoryPolicyRule =
  | "prefer_latest_active_for_subject"
  | "exclude_superseded"
  | "exclude_expired"
  | "deduplicate_subjects";

export type MemoryInterventionOperationV2 =
  | {
      id: string;
      type: "memory_status";
      memoryId: string;
      status: MemoryDecisionStatus;
      supersededByMemoryId?: string;
      reason: string;
    }
  | {
      id: string;
      type: "memory_upsert";
      memory: MemoryDecisionMemory;
      reason: string;
    }
  | {
      id: string;
      type: "memory_replace";
      memoryId: string;
      replacement: MemoryDecisionMemory;
      reason: string;
    }
  | {
      id: string;
      type: "memory_restore";
      memoryId: string;
      reason: string;
    }
  | {
      id: string;
      type: "policy_rule";
      rule: MemoryPolicyRule;
      enabled: boolean;
      reason: string;
    }
  | {
      id: string;
      type: "retrieval_parameter";
      parameter: "limit" | "score_threshold" | "recency_weight";
      value: number;
      reason: string;
    }
  | {
      id: string;
      type: "context_override";
      action: "include" | "exclude";
      memoryId: string;
      reason: string;
    };

export type MemoryInterventionV2 = {
  format: "engram.memory-intervention";
  version: 2;
  id: string;
  targetRunId: string;
  baselineFingerprint?: string;
  preconditions?: {
    policyFingerprint?: string;
    memories?: Array<{
      memoryId: string;
      status?: MemoryDecisionStatus;
      content?: JsonValue;
    }>;
  };
  label: string;
  rationale: string;
  operations: MemoryInterventionOperationV2[];
  createdAt: string;
};

export type MemoryAnswerAssertion =
  | {
      type: "exact";
      value: string;
      caseSensitive?: boolean;
    }
  | {
      type: "contains_all";
      values: string[];
      forbidden?: string[];
      caseSensitive?: boolean;
    };

export type MemoryReplayExecutionLevel =
  | "context"
  | "policy"
  | "provider"
  | "agent"
  | "robustness";

export type MemoryReplayCapabilities = {
  levels: MemoryReplayExecutionLevel[];
  deterministic: boolean;
  reusesRecordedCandidates: boolean;
  rerunsCandidateGeneration: boolean;
  rerunsEligibility: boolean;
  rerunsRanking: boolean;
  rerunsSelection: boolean;
  rerunsContextAssembly: boolean;
  rerunsGeneration: boolean;
  supportsPolicyInterventions: boolean;
  supportsStateInterventions: boolean;
  supportsRepeatedRuns: boolean;
};

export type MemoryDecisionStageDiff = {
  stage: MemoryDecisionStageKind;
  comparable: boolean;
  changed: boolean;
  summary: string;
  baselineMemoryIds: string[];
  treatmentMemoryIds: string[];
};

export type MemoryDecisionDiff = {
  format: "engram.memory-decision-diff";
  version: 1;
  baselineRunId: string;
  treatmentRunId: string;
  status: "found" | "none" | "indeterminate";
  stages: MemoryDecisionStageDiff[];
  earliestDivergence?: MemoryDecisionStageKind;
  firstIncomparableStage?: MemoryDecisionStageKind;
  answerChanged: boolean;
};

export type MemoryPolicyReplayRequest = {
  baseline: MemoryDecisionRunV3;
  intervention: MemoryInterventionV2;
  answerAssertion?: MemoryAnswerAssertion;
  /** @deprecated Prefer answerAssertion for new integrations. */
  expectedAnswerFragments?: string[];
};

export type MemoryReplaySideEffectMode = "blocked" | "recorded" | "execute";

export type MemoryExecutorManifest = {
  format: "engram.memory-executor";
  version: 1;
  id: string;
  name: string;
  executorVersion: string;
  framework: {
    id: string;
    version?: string;
  };
  capabilities: MemoryReplayCapabilities;
  sideEffects: {
    defaultMode: MemoryReplaySideEffectMode;
    supportedModes: MemoryReplaySideEffectMode[];
  };
};

export type MemoryExecutorReplayRequest = {
  format: "engram.memory-executor-replay";
  version: 1;
  request: MemoryPolicyReplayRequest;
  sideEffectMode: MemoryReplaySideEffectMode;
};

export type MemoryReplayExecutor = {
  manifest: MemoryExecutorManifest;
  replay: (
    request: MemoryPolicyReplayRequest,
    options?: { sideEffectMode?: MemoryReplaySideEffectMode; signal?: AbortSignal }
  ) => Promise<MemoryPolicyReplayResult>;
};

export type MemoryPolicyReplayResult = {
  format: "engram.memory-policy-replay";
  version: 1;
  level: MemoryReplayExecutionLevel;
  executor: {
    id: string;
    version: string;
    deterministic: boolean;
  };
  capabilities: MemoryReplayCapabilities;
  intervention: MemoryInterventionV2;
  source: MemoryDecisionRunV3;
  baseline: MemoryDecisionRunV3;
  treatment: MemoryDecisionRunV3;
  diff: MemoryDecisionDiff;
  reproduction: {
    reproduced: boolean;
    observedAnswer: string;
    replayedAnswer: string;
  };
  verification: {
    passed: boolean;
    assertion?: MemoryAnswerAssertion;
    failures: string[];
    expectedAnswerFragments: string[];
    matchedAnswerFragments: string[];
  };
  caveat: string;
};
