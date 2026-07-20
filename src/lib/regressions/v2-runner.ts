import type {
  JsonValue,
  MemoryDecisionMemory,
  MemoryDecisionRunV3,
  MemoryInterventionV2,
  MemoryPolicyReplayResult
} from "@engramviz/core";
import type { DeterministicPolicyReplayExecutor } from "@/lib/reliability/policy-replay";
import { runDeterministicPolicyReplay } from "@/lib/reliability/policy-replay";
import {
  evaluateMemoryRegressionMatrixV2,
  memoryRegressionObservationFromRunV2,
  type MemoryRegressionMatrixReportV2
} from "@/lib/regressions/v2-evaluator";
import {
  parseMemoryRegressionArtifactV2,
  type MemoryRegressionArtifactV2,
  type MemoryRegressionObservationV2,
  type MemoryRegressionPerturbationV2,
  type MemorySelectorV2
} from "@/lib/regressions/v2-schema";

export type MemoryRegressionMatrixRunV2 = Readonly<{
  artifact: MemoryRegressionArtifactV2;
  replays: readonly MemoryPolicyReplayResult[];
  observations: readonly MemoryRegressionObservationV2[];
  report: MemoryRegressionMatrixReportV2;
}>;

export function runMemoryRegressionMatrixV2(
  artifactInput: unknown,
  executor: DeterministicPolicyReplayExecutor
): MemoryRegressionMatrixRunV2 {
  const artifact = parseMemoryRegressionArtifactV2(artifactInput);
  const sourceReplay = artifact.sourceReplay.result as MemoryPolicyReplayResult;
  const replays = artifact.matrix.variants.map((variant) => {
    const source = applyPerturbations(
      sourceReplay.source,
      variant.id,
      variant.perturbations
    );
    const intervention: MemoryInterventionV2 = {
      ...structuredClone(sourceReplay.intervention),
      id: `${sourceReplay.intervention.id}-${variant.id}`,
      targetRunId: source.id,
      baselineFingerprint: undefined,
      preconditions: undefined,
      createdAt: source.completedAt
    };
    return runDeterministicPolicyReplay({
      baseline: source,
      intervention,
      answerAssertion: sourceReplay.verification.assertion
    }, executor);
  });
  const observations = replays.map((replay, index) => memoryRegressionObservationFromRunV2(
    artifact.matrix.variants[index]!.id,
    replay.treatment
  ));
  const report = evaluateMemoryRegressionMatrixV2(artifact, observations);

  return deepFreeze({ artifact, replays, observations, report });
}

export function applyMemoryRegressionPerturbationsV2(
  sourceInput: MemoryDecisionRunV3,
  variantId: string,
  perturbations: readonly MemoryRegressionPerturbationV2[]
): MemoryDecisionRunV3 {
  return applyPerturbations(sourceInput, variantId, perturbations);
}

function applyPerturbations(
  sourceInput: MemoryDecisionRunV3,
  variantId: string,
  perturbations: readonly MemoryRegressionPerturbationV2[]
) {
  const source = structuredClone(sourceInput);
  source.id = `${source.id}-regression-${variantId}`;
  source.metadata = {
    ...(source.metadata ?? {}),
    regressionVariantId: variantId,
    perturbationCount: perturbations.length
  };

  for (const perturbation of perturbations) {
    if (perturbation.type === "query_paraphrase") {
      source.input = perturbation.query;
      source.retrieval.query = perturbation.query;
      continue;
    }
    if (perturbation.type === "distractors") {
      for (const distractor of perturbation.candidates) {
        addDistractor(source, distractor.memory as MemoryDecisionMemory, distractor.score);
      }
      continue;
    }
    if (perturbation.type === "score_margin") {
      applyScoreMargin(source, perturbation.leader, perturbation.challenger, perturbation.margin);
      continue;
    }

    mutateMatchingMemories(source, perturbation.target, (memory) => {
      if (perturbation.type === "entity_substitution") {
        memory.content = replaceJsonText(memory.content, perturbation.from, perturbation.to);
        if (memory.value !== undefined) memory.value = replaceJsonText(memory.value, perturbation.from, perturbation.to);
        if (memory.subject) memory.subject = replaceText(memory.subject, perturbation.from, perturbation.to);
      } else {
        if (perturbation.createdAt) memory.createdAt = perturbation.createdAt;
        if (perturbation.updatedAt) memory.updatedAt = perturbation.updatedAt;
        if (perturbation.validFrom) memory.validFrom = perturbation.validFrom;
        if (perturbation.validTo) memory.validTo = perturbation.validTo;
      }
      memory.evidence = "simulated";
    });
  }

  source.retrieval.candidates.forEach((candidate, index) => {
    candidate.rank = index + 1;
    candidate.selected = source.retrieval.selectedIds.includes(candidate.memoryId);
    candidate.loaded = source.context.loadedIds.includes(candidate.memoryId);
    candidate.evidence = "simulated";
  });
  return source;
}

function mutateMatchingMemories(
  run: MemoryDecisionRunV3,
  selector: MemorySelectorV2,
  mutate: (memory: MemoryDecisionMemory) => void
) {
  const seen = new Set<string>();
  const collections = [
    run.memoryState.before,
    run.memoryState.after,
    run.retrieval.candidates.flatMap((candidate) => candidate.memory ? [candidate.memory] : [])
  ];
  for (const collection of collections) {
    for (const memory of collection) {
      if (!matchesSelector(memory, selector)) continue;
      const key = `${collection === run.memoryState.before ? "before" : collection === run.memoryState.after ? "after" : "candidate"}:${memory.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      mutate(memory);
    }
  }
}

function addDistractor(run: MemoryDecisionRunV3, memoryInput: MemoryDecisionMemory, score: number) {
  const memory = { ...structuredClone(memoryInput), evidence: "simulated" as const };
  if (run.memoryState.before.some((candidate) => candidate.id === memory.id)) {
    throw new Error(`Regression distractor duplicates memory ${memory.id}.`);
  }
  run.memoryState.before.push(structuredClone(memory));
  run.memoryState.after.push(structuredClone(memory));
  run.retrieval.candidates.push({
    memoryId: memory.id,
    memory: structuredClone(memory),
    rank: run.retrieval.candidates.length + 1,
    score,
    eligible: true,
    selected: false,
    loaded: false,
    evidence: "simulated"
  });
}

function applyScoreMargin(
  run: MemoryDecisionRunV3,
  leaderSelector: MemorySelectorV2,
  challengerSelector: MemorySelectorV2,
  margin: number
) {
  const leader = findCandidate(run, leaderSelector);
  const challenger = findCandidate(run, challengerSelector);
  if (!leader || !challenger) throw new Error("Regression score-margin selectors did not match two candidates.");
  const anchor = Math.max(leader.score ?? 0, challenger.score ?? 0);
  leader.score = anchor;
  challenger.score = anchor - margin;
  leader.evidence = "simulated";
  challenger.evidence = "simulated";
}

function findCandidate(run: MemoryDecisionRunV3, selector: MemorySelectorV2) {
  const memoryById = new Map(run.memoryState.before.map((memory) => [memory.id, memory]));
  return run.retrieval.candidates.find((candidate) => {
    const memory = candidate.memory ?? memoryById.get(candidate.memoryId);
    return Boolean(memory && matchesSelector(memory, selector));
  });
}

function matchesSelector(memory: MemoryDecisionMemory, selector: MemorySelectorV2) {
  if (selector.subject && normalizeSubject(memory.subject ?? "") !== normalizeSubject(selector.subject)) return false;
  if (selector.status && memory.status !== selector.status) return false;
  if (selector.valueContains) {
    const value = memory.value === undefined
      ? ""
      : typeof memory.value === "string" ? memory.value : JSON.stringify(memory.value);
    if (!normalize(value).includes(normalize(selector.valueContains))) return false;
  }
  return true;
}

function replaceJsonText(value: JsonValue, from: string, to: string): JsonValue {
  if (typeof value === "string") return replaceText(value, from, to);
  if (Array.isArray(value)) return value.map((item) => replaceJsonText(item, from, to));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceJsonText(item, from, to)]));
  }
  return value;
}

function replaceText(value: string, from: string, to: string) {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(escaped, "gi"), to);
}

function normalizeSubject(value: string) {
  return normalize(value).replace(/\s+/g, "_");
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}
