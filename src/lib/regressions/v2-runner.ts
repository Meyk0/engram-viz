import {
  applyMemoryRegressionPerturbationsV2,
  evaluateMemoryRegressionMatrixV2,
  memoryRegressionObservationFromRunV2,
  parseMemoryRegressionArtifactV2,
  type MemoryAnswerAssertion,
  type MemoryInterventionV2,
  type MemoryPolicyReplayResult,
  type MemoryRegressionArtifactV2,
  type MemoryRegressionMatrixReportV2,
  type MemoryRegressionObservationV2,
  type MemoryRegressionPerturbationV2
} from "@engramviz/core";
import type { DeterministicPolicyReplayExecutor } from "@/lib/reliability/policy-replay";
import { fingerprintMemoryDecisionRun } from "@/lib/reliability/fingerprint";
import { runDeterministicPolicyReplay } from "@/lib/reliability/policy-replay";

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
  if (executor.id !== sourceReplay.executor.id || executor.version !== sourceReplay.executor.version) {
    throw new Error(
      `Regression executor ${executor.id}@${executor.version} does not match the source replay executor `
      + `${sourceReplay.executor.id}@${sourceReplay.executor.version}.`
    );
  }

  const replays = artifact.matrix.variants.map((variant) => {
    const source = applyMemoryRegressionPerturbationsV2(
      sourceReplay.source,
      variant.id,
      variant.perturbations
    );
    const intervention: MemoryInterventionV2 = {
      ...structuredClone(sourceReplay.intervention),
      id: `${sourceReplay.intervention.id}-${variant.id}`,
      targetRunId: source.id,
      baselineFingerprint: fingerprintMemoryDecisionRun(source),
      createdAt: source.completedAt
    };
    const replay = runDeterministicPolicyReplay({
      baseline: source,
      intervention,
      answerAssertion: transformAnswerAssertion(
        sourceReplay.verification.assertion,
        variant.perturbations
      )
    }, executor);
    // Only the unperturbed source has captured evidence to reproduce. Matrix
    // variants are synthetic robustness inputs, so their treatment output is
    // evaluated directly rather than misrepresented as a reproduced incident.
    if (variant.id === "source" && !replay.reproduction.reproduced) {
      throw new Error(
        `Regression source could not reproduce the captured baseline: `
        + replay.verification.failures.join(" ")
      );
    }
    return replay;
  });
  const observations = replays.map((replay, index) => memoryRegressionObservationFromRunV2(
    artifact.matrix.variants[index]!.id,
    replay.treatment
  ));
  const report = evaluateMemoryRegressionMatrixV2(artifact, observations);

  return deepFreeze({ artifact, replays, observations, report });
}

export { applyMemoryRegressionPerturbationsV2 } from "@engramviz/core";

function transformAnswerAssertion(
  assertion: MemoryAnswerAssertion | undefined,
  perturbations: readonly MemoryRegressionPerturbationV2[]
): MemoryAnswerAssertion | undefined {
  if (!assertion) return undefined;
  const result = structuredClone(assertion);
  for (const perturbation of perturbations) {
    if (perturbation.type !== "entity_substitution") continue;
    if (result.type === "exact") {
      result.value = replaceText(result.value, perturbation.from, perturbation.to);
      continue;
    }
    result.values = result.values.map((value) => replaceText(value, perturbation.from, perturbation.to));
    result.forbidden = result.forbidden?.map(
      (value) => replaceText(value, perturbation.from, perturbation.to)
    );
  }
  return result;
}

function replaceText(value: string, from: string, to: string) {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(escaped, "gi"), to);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}
