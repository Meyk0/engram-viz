import { countMemoryPairs, scanMemoryIntegrity } from "@/lib/integrity/scan";
import type { DreamBenchmark, MemorySetMetrics } from "@/lib/integrity/types";
import type { DreamProposal, EngramMemory } from "@/types";

export function benchmarkDreamProposal(
  beforeMemories: readonly EngramMemory[],
  proposal: DreamProposal
): DreamBenchmark {
  const before = beforeMemories
    .filter((memory) => memory.status !== "superseded")
    .map((memory) => structuredClone(memory));
  const projectedMemories = projectDreamMemories(before, proposal);
  const beforeMetrics = measureMemorySet(before);
  const afterMetrics = measureMemorySet(projectedMemories);
  const retention = estimateInformationRetention(before, projectedMemories);
  const delta = metricDelta(beforeMetrics, afterMetrics);
  const observations = buildObservations(beforeMetrics, afterMetrics, retention);
  const improvement =
    (beforeMetrics.duplicatePairs - afterMetrics.duplicatePairs) * 2 +
    (beforeMetrics.conflictPairs - afterMetrics.conflictPairs) * 3 +
    (beforeMetrics.integrityFindings - afterMetrics.integrityFindings) * 2 +
    (afterMetrics.temporalMemories - beforeMetrics.temporalMemories);
  const regression = afterMetrics.conflictPairs > beforeMetrics.conflictPairs || retention < 0.55;

  return deepFreeze({
    version: 1,
    verdict: regression ? "regressed" : improvement > 0 ? "improved" : "neutral",
    before: beforeMetrics,
    after: afterMetrics,
    delta,
    estimatedInformationRetention: retention,
    projectedMemories,
    observations,
    caveat: "This benchmark projects the proposed operations locally. Token footprint and information retention are deterministic estimates, not model-quality measurements."
  });
}

export function projectDreamMemories(
  memories: readonly EngramMemory[],
  proposal: DreamProposal
): EngramMemory[] {
  const byId = new Map(memories.map((memory) => [memory.id, structuredClone(memory)]));
  if (proposal.status !== "proposed") return [...byId.values()];

  proposal.operations.forEach((operation) => {
    const retiredIds = operation.type === "merge"
      ? operation.sourceIds
      : operation.type === "supersede"
        ? operation.supersedeIds ?? operation.sourceIds
        : operation.supersedeIds ?? [];
    retiredIds.forEach((id) => byId.delete(id));
    if (operation.result) byId.set(operation.result.id, structuredClone(operation.result));
  });

  return [...byId.values()].filter((memory) => memory.status !== "superseded");
}

export function measureMemorySet(memories: readonly EngramMemory[]): MemorySetMetrics {
  const active = memories.filter((memory) => memory.status !== "superseded");
  const pairs = countMemoryPairs(active);
  const integrity = scanMemoryIntegrity({ memories: active, now: new Date(0) });
  return {
    activeMemories: active.length,
    hippocampusMemories: active.filter((memory) => memory.region === "hippocampus").length,
    temporalMemories: active.filter((memory) => memory.region === "temporal").length,
    duplicatePairs: pairs.duplicatePairs,
    conflictPairs: pairs.conflictPairs,
    integrityFindings: integrity.findings.filter((finding) => finding.severity !== "info").length,
    estimatedContextTokens: Math.ceil(active.reduce((sum, memory) => sum + memory.text.length, 0) / 4)
  };
}

function estimateInformationRetention(before: EngramMemory[], after: EngramMemory[]) {
  const beforeWords = contentWords(before.map((memory) => memory.text).join(" "));
  if (beforeWords.size === 0) return 1;
  const afterWords = contentWords(after.map((memory) => memory.text).join(" "));
  const retained = [...beforeWords].filter((word) => afterWords.has(word)).length;
  return round(retained / beforeWords.size);
}

function buildObservations(before: MemorySetMetrics, after: MemorySetMetrics, retention: number) {
  const observations: string[] = [];
  if (after.duplicatePairs < before.duplicatePairs) {
    observations.push(`Removes ${before.duplicatePairs - after.duplicatePairs} duplicate ${plural(before.duplicatePairs - after.duplicatePairs, "pair")}.`);
  }
  if (after.conflictPairs < before.conflictPairs) {
    observations.push(`Resolves ${before.conflictPairs - after.conflictPairs} active ${plural(before.conflictPairs - after.conflictPairs, "conflict")}.`);
  }
  if (after.estimatedContextTokens < before.estimatedContextTokens) {
    observations.push(`Reduces estimated full-memory context by ${before.estimatedContextTokens - after.estimatedContextTokens} tokens.`);
  }
  if (after.temporalMemories > before.temporalMemories) {
    observations.push(`Adds ${after.temporalMemories - before.temporalMemories} stable semantic ${plural(after.temporalMemories - before.temporalMemories, "memory")}.`);
  }
  observations.push(`Estimated source information retained: ${Math.round(retention * 100)}%.`);
  return observations;
}

function metricDelta(before: MemorySetMetrics, after: MemorySetMetrics): MemorySetMetrics {
  return {
    activeMemories: after.activeMemories - before.activeMemories,
    hippocampusMemories: after.hippocampusMemories - before.hippocampusMemories,
    temporalMemories: after.temporalMemories - before.temporalMemories,
    duplicatePairs: after.duplicatePairs - before.duplicatePairs,
    conflictPairs: after.conflictPairs - before.conflictPairs,
    integrityFindings: after.integrityFindings - before.integrityFindings,
    estimatedContextTokens: after.estimatedContextTokens - before.estimatedContextTokens
  };
}

function contentWords(value: string) {
  const stop = new Set(["user", "the", "and", "that", "this", "has", "with", "likes", "loves", "prefers", "their", "memory"]);
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stop.has(word))
  );
}

function plural(count: number, word: string) {
  return count === 1 ? word : `${word}s`;
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
