import type { EngramMemory } from "@/types";

export type MemoryIntegrityRule =
  | "secret_exposure"
  | "instruction_injection"
  | "active_conflict"
  | "duplicate_memory"
  | "stale_context"
  | "low_confidence"
  | "missing_provenance";

export type MemoryIntegritySeverity = "critical" | "high" | "medium" | "info";

export type MemoryIntegrityEvidence = {
  memoryId: string;
  excerpt: string;
  field: "text" | "sourceText" | "status" | "confidence";
};

export type MemoryIntegrityFinding = {
  id: string;
  rule: MemoryIntegrityRule;
  severity: MemoryIntegritySeverity;
  title: string;
  summary: string;
  recommendation: string;
  memoryIds: string[];
  evidence: MemoryIntegrityEvidence[];
  provenance: "observed";
};

export type MemoryIntegrityReport = {
  version: 1;
  scannedAt: string;
  status: "clear" | "review" | "attention";
  riskPoints: number;
  scannedMemoryCount: number;
  activeMemoryCount: number;
  affectedMemoryCount: number;
  findings: MemoryIntegrityFinding[];
  caveat: string;
};

export type MemorySetMetrics = {
  activeMemories: number;
  hippocampusMemories: number;
  temporalMemories: number;
  duplicatePairs: number;
  conflictPairs: number;
  integrityFindings: number;
  estimatedContextTokens: number;
};

export type DreamBenchmark = {
  version: 1;
  verdict: "improved" | "neutral" | "regressed";
  before: MemorySetMetrics;
  after: MemorySetMetrics;
  delta: MemorySetMetrics;
  estimatedInformationRetention: number;
  projectedMemories: EngramMemory[];
  observations: string[];
  caveat: string;
};
