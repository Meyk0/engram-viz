import {
  memoryDecisionRunV3Schema,
  type MemoryDecisionMemory,
  type MemoryDecisionRunV3
} from "@engramviz/core";
import {
  memoryRegressionMatrixObservationsV2Schema,
  parseMemoryRegressionArtifactV2,
  parseMemoryRegressionObservationV2,
  type MemoryRegressionArtifactV2,
  type MemoryRegressionObservationV2,
  type MemorySelectorV2
} from "@/lib/regressions/v2-schema";

export type MemoryRegressionFindingV2 = Readonly<{
  id: string;
  category: "lifecycle" | "answer";
  assertion:
    | "mustSelect"
    | "mustNotSelect"
    | "mustLoad"
    | "mustNotLoad"
    | "contains"
    | "notContains";
  pass: boolean;
  expected: Readonly<MemorySelectorV2> | string;
  observed: readonly string[] | string;
  message: string;
}>;

export type MemoryRegressionVariantReportV2 = Readonly<{
  id: string;
  label: string;
  status: "passed" | "failed" | "missing";
  pass: boolean;
  findings: readonly MemoryRegressionFindingV2[];
  summary: Readonly<{
    total: number;
    passed: number;
    failed: number;
  }>;
}>;

export type MemoryRegressionMatrixReportV2 = Readonly<{
  artifact: Readonly<{
    id: string;
    title: string;
    version: 2;
  }>;
  pass: boolean;
  status: "passed" | "failed";
  variants: readonly MemoryRegressionVariantReportV2[];
  summary: Readonly<{
    variants: Readonly<{
      total: number;
      passed: number;
      failed: number;
      missing: number;
    }>;
    findings: Readonly<{
      total: number;
      passed: number;
      failed: number;
    }>;
  }>;
}>;

type ObservedMemoryV2 = MemoryRegressionObservationV2["memories"][number];

export function evaluateMemoryRegressionMatrixV2(
  artifactInput: unknown,
  observationsInput: unknown
): MemoryRegressionMatrixReportV2 {
  const artifact = parseMemoryRegressionArtifactV2(artifactInput);
  const observations = memoryRegressionMatrixObservationsV2Schema.parse(observationsInput);
  const variants = new Set(artifact.matrix.variants.map((variant) => variant.id));

  for (const observation of observations) {
    if (!variants.has(observation.variantId)) {
      throw new TypeError(`Observation references unknown matrix variant "${observation.variantId}".`);
    }
  }

  const observationByVariant = new Map(
    observations.map((observation) => [observation.variantId, observation])
  );
  const variantReports = artifact.matrix.variants.map((variant) => {
    const observation = observationByVariant.get(variant.id);
    if (!observation) return missingVariant(variant.id, variant.label);
    return evaluateVariant(artifact, observation, variant.label);
  });
  const allFindings = variantReports.flatMap((variant) => variant.findings);
  const missing = variantReports.filter((variant) => variant.status === "missing").length;
  const passedVariants = variantReports.filter((variant) => variant.pass).length;
  const pass = passedVariants === variantReports.length;

  return deepFreeze({
    artifact: {
      id: artifact.id,
      title: artifact.title,
      version: 2
    },
    pass,
    status: pass ? "passed" : "failed",
    variants: variantReports,
    summary: {
      variants: {
        total: variantReports.length,
        passed: passedVariants,
        failed: variantReports.length - passedVariants,
        missing
      },
      findings: {
        total: allFindings.length,
        passed: allFindings.filter((finding) => finding.pass).length,
        failed: allFindings.filter((finding) => !finding.pass).length
      }
    }
  });
}

export function memoryRegressionObservationFromRunV2(
  variantId: string,
  runInput: MemoryDecisionRunV3
): MemoryRegressionObservationV2 {
  const run = memoryDecisionRunV3Schema.parse(runInput) as MemoryDecisionRunV3;
  const memories = new Map<string, MemoryDecisionMemory>();
  run.memoryState.after.forEach((memory) => memories.set(memory.id, memory));
  run.retrieval.candidates.forEach((candidate) => {
    if (candidate.memory && !memories.has(candidate.memory.id)) {
      memories.set(candidate.memory.id, candidate.memory);
    }
  });

  return parseMemoryRegressionObservationV2({
    variantId,
    memories: [...memories.values()],
    selectedMemoryIds: run.retrieval.selectedIds,
    loadedMemoryIds: run.context.loadedIds,
    forcedMemoryIds: run.context.forcedIds,
    answer: run.answer.content
  });
}

function evaluateVariant(
  artifact: MemoryRegressionArtifactV2,
  observation: MemoryRegressionObservationV2,
  label: string
): MemoryRegressionVariantReportV2 {
  const findings: MemoryRegressionFindingV2[] = [];
  const memoryById = new Map(observation.memories.map((memory) => [memory.id, memory]));
  const selected = observation.selectedMemoryIds.map((id) => memoryById.get(id)!);
  const loaded = observation.loadedMemoryIds.map((id) => memoryById.get(id)!);
  const lifecycle = artifact.assertions.lifecycle;

  lifecycle.mustSelect.forEach((selector, index) => {
    findings.push(lifecycleFinding("mustSelect", selector, selected, index));
  });
  lifecycle.mustNotSelect.forEach((selector, index) => {
    findings.push(lifecycleFinding("mustNotSelect", selector, selected, index));
  });
  lifecycle.mustLoad.forEach((selector, index) => {
    findings.push(lifecycleFinding("mustLoad", selector, loaded, index));
  });
  lifecycle.mustNotLoad.forEach((selector, index) => {
    findings.push(lifecycleFinding("mustNotLoad", selector, loaded, index));
  });

  artifact.assertions.answer.contains.forEach((phrase, index) => {
    const pass = containsAffirmedPhrase(observation.answer, phrase);
    findings.push({
      id: `answer.contains:${index}`,
      category: "answer",
      assertion: "contains",
      pass,
      expected: phrase,
      observed: observation.answer,
      message: pass
        ? `Answer contains an affirmed match for "${phrase}".`
        : `Answer does not contain an affirmed match for "${phrase}".`
    });
  });
  artifact.assertions.answer.notContains.forEach((phrase, index) => {
    const pass = !containsPhrase(observation.answer, phrase);
    findings.push({
      id: `answer.notContains:${index}`,
      category: "answer",
      assertion: "notContains",
      pass,
      expected: phrase,
      observed: observation.answer,
      message: pass
        ? `Answer omits forbidden text "${phrase}".`
        : `Answer contains forbidden text "${phrase}".`
    });
  });

  const passed = findings.filter((finding) => finding.pass).length;
  const pass = passed === findings.length;
  return {
    id: observation.variantId,
    label,
    status: pass ? "passed" : "failed",
    pass,
    findings,
    summary: {
      total: findings.length,
      passed,
      failed: findings.length - passed
    }
  };
}

function lifecycleFinding(
  assertion: "mustSelect" | "mustNotSelect" | "mustLoad" | "mustNotLoad",
  selector: MemorySelectorV2,
  memories: readonly ObservedMemoryV2[],
  index: number
): MemoryRegressionFindingV2 {
  const matches = memories.filter((memory) => matchesSelector(memory, selector));
  const requiresMatch = assertion === "mustSelect" || assertion === "mustLoad";
  const pass = requiresMatch ? matches.length > 0 : matches.length === 0;
  const action = assertion === "mustSelect" || assertion === "mustNotSelect"
    ? "selected"
    : "loaded";
  return {
    id: `lifecycle.${assertion}:${index}`,
    category: "lifecycle",
    assertion,
    pass,
    expected: structuredClone(selector),
    observed: matches.map((memory) => memory.id),
    message: pass
      ? `Semantic memory selector was ${requiresMatch ? "matched" : "absent"} among ${action} memories.`
      : `Semantic memory selector was ${requiresMatch ? "absent from" : "matched among"} ${action} memories.`
  };
}

function matchesSelector(memory: ObservedMemoryV2, selector: MemorySelectorV2) {
  if (selector.subject !== undefined
    && normalizeSubject(memory.subject ?? "") !== normalizeSubject(selector.subject)) {
    return false;
  }
  if (selector.status !== undefined && memory.status !== selector.status) return false;
  if (selector.valueContains !== undefined) {
    if (memory.value === undefined) return false;
    const value = typeof memory.value === "string"
      ? memory.value
      : JSON.stringify(memory.value);
    if (!containsPhrase(value, selector.valueContains)) return false;
  }
  return true;
}

function containsAffirmedPhrase(answer: string, expected: string) {
  const expectedTokens = tokens(expected);
  if (expectedTokens.length === 0) return false;

  for (const clause of answer.split(/[.!?;\n]+/u)) {
    const clauseTokens = tokens(clause);
    for (let index = 0; index <= clauseTokens.length - expectedTokens.length; index += 1) {
      if (!sequenceAt(clauseTokens, expectedTokens, index)) continue;
      if (!isNegated(clauseTokens, index, expectedTokens.length)) return true;
    }
  }
  return false;
}

function containsPhrase(value: string, expected: string) {
  const valueTokens = tokens(value);
  const expectedTokens = tokens(expected);
  if (expectedTokens.length === 0) return false;
  return valueTokens.some((_, index) => sequenceAt(valueTokens, expectedTokens, index));
}

function isNegated(clause: readonly string[], start: number, length: number) {
  const boundaryWords = new Set(["but", "however", "instead", "rather", "yet"]);
  const left = clause.slice(Math.max(0, start - 7), start);
  const lastBoundary = left.reduce(
    (latest, token, index) => boundaryWords.has(token) ? index : latest,
    -1
  );
  const relevantLeft = left.slice(lastBoundary + 1);
  const leftNegated = relevantLeft.some((token, index) => {
    if (!NEGATION_WORDS.has(token)) return false;
    return relevantLeft[index + 1] !== "only";
  });
  if (leftNegated) return true;

  const right = clause.slice(start + length, start + length + 4);
  if (right.length === 0) return false;
  if (NEGATION_WORDS.has(right[0]!)) return true;
  return AUXILIARY_WORDS.has(right[0]!) && NEGATION_WORDS.has(right[1] ?? "");
}

function sequenceAt(values: readonly string[], expected: readonly string[], start: number) {
  if (start + expected.length > values.length) return false;
  return expected.every((token, index) => values[start + index] === token);
}

function tokens(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/[’]/gu, "'")
    .toLowerCase()
    .match(/[a-z0-9]+(?:'[a-z0-9]+)?/gu) ?? [];
}

function normalizeSubject(value: string) {
  return tokens(value).join("_");
}

function missingVariant(id: string, label: string): MemoryRegressionVariantReportV2 {
  return {
    id,
    label,
    status: "missing",
    pass: false,
    findings: [],
    summary: { total: 0, passed: 0, failed: 0 }
  };
}

const NEGATION_WORDS = new Set([
  "not",
  "no",
  "never",
  "neither",
  "nor",
  "without",
  "cannot",
  "can't",
  "isn't",
  "aren't",
  "wasn't",
  "weren't",
  "don't",
  "doesn't",
  "didn't",
  "won't",
  "wouldn't",
  "shouldn't",
  "couldn't",
  "hasn't",
  "haven't",
  "hadn't"
]);

const AUXILIARY_WORDS = new Set([
  "is",
  "are",
  "was",
  "were",
  "do",
  "does",
  "did",
  "can",
  "could",
  "will",
  "would",
  "should",
  "has",
  "have",
  "had"
]);

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}
