import {
  memoryPolicyReplayResultSchema,
  type MemoryDecisionMemory,
  type MemoryDecisionStatus,
  type MemoryPolicyReplayResult
} from "@engramviz/core";
import {
  deriveMemoryRegressionReplayFidelityV2,
  parseMemoryRegressionArtifactV2,
  type MemoryRegressionArtifactV2,
  type MemoryRegressionPerturbationV2,
  type MemorySelectorV2
} from "@/lib/regressions/v2-schema";

export type MemoryRegressionAssertionsInputV2 = Readonly<{
  lifecycle?: Readonly<{
    mustSelect?: readonly Readonly<MemorySelectorV2>[];
    mustNotSelect?: readonly Readonly<MemorySelectorV2>[];
    mustLoad?: readonly Readonly<MemorySelectorV2>[];
    mustNotLoad?: readonly Readonly<MemorySelectorV2>[];
  }>;
  answer?: Readonly<{
    contains?: readonly string[];
    notContains?: readonly string[];
  }>;
}>;

export type MemoryRegressionVariantInputV2 = Readonly<{
  id: string;
  label?: string;
  perturbations: readonly Readonly<MemoryRegressionPerturbationV2>[];
}>;

export type CompileMemoryRegressionV2Input = Readonly<{
  replay: MemoryPolicyReplayResult;
  id: string;
  title: string;
  description?: string;
  createdAt?: string;
  assertions?: MemoryRegressionAssertionsInputV2;
  variants?: readonly MemoryRegressionVariantInputV2[];
}>;

export function compileMemoryRegressionV2(
  input: CompileMemoryRegressionV2Input
): MemoryRegressionArtifactV2 {
  const replay = memoryPolicyReplayResultSchema.parse(input.replay) as MemoryPolicyReplayResult;
  const defaults = deriveAssertions(replay);
  const defaultAnswer = deriveAnswerAssertions(replay);
  const lifecycle = input.assertions?.lifecycle;
  const answer = input.assertions?.answer;

  return parseMemoryRegressionArtifactV2({
    format: "engram.memory-regression",
    version: 2,
    id: input.id,
    title: input.title,
    ...(input.description?.trim() ? { description: input.description } : {}),
    createdAt: input.createdAt ?? replay.treatment.completedAt,
    sourceReplay: {
      result: replay,
      fidelity: deriveMemoryRegressionReplayFidelityV2(replay)
    },
    assertions: {
      lifecycle: {
        mustSelect: cloneSelectors(lifecycle?.mustSelect ?? defaults.mustSelect),
        mustNotSelect: cloneSelectors(lifecycle?.mustNotSelect ?? defaults.mustNotSelect),
        mustLoad: cloneSelectors(lifecycle?.mustLoad ?? defaults.mustLoad),
        mustNotLoad: cloneSelectors(lifecycle?.mustNotLoad ?? defaults.mustNotLoad)
      },
      answer: {
        match: answer ? "normalized-phrase-with-negation-guard" : defaultAnswer.match,
        ...(answer || !defaultAnswer.equals ? {} : { equals: defaultAnswer.equals }),
        contains: normalizePhrases(answer?.contains ?? defaultAnswer.contains),
        notContains: normalizePhrases(answer?.notContains ?? defaultAnswer.notContains)
      }
    },
    matrix: {
      aggregation: "all-variants",
      variants: [
        { id: "source", label: "Source replay", perturbations: [] },
        ...(input.variants ?? []).map((variant) => ({
          id: variant.id,
          label: variant.label?.trim() || variant.id,
          perturbations: structuredClone(variant.perturbations)
        }))
      ]
    }
  });
}

function deriveAnswerAssertions(replay: MemoryPolicyReplayResult) {
  const assertion = replay.verification.assertion;
  if (assertion?.type === "exact") {
    return {
      match: "normalized-exact" as const,
      equals: assertion.value,
      contains: [],
      notContains: []
    };
  }
  if (assertion?.type === "contains_all") {
    return {
      match: "normalized-phrase-with-negation-guard" as const,
      contains: assertion.values,
      notContains: assertion.forbidden ?? []
    };
  }
  return {
    match: "normalized-phrase-with-negation-guard" as const,
    contains: replay.verification.expectedAnswerFragments,
    notContains: []
  };
}

function deriveAssertions(replay: MemoryPolicyReplayResult) {
  const selected = replay.treatment.retrieval.selectedIds;
  const loaded = replay.treatment.context.loadedIds;
  const baselineSelected = replay.baseline.retrieval.selectedIds;
  const baselineLoaded = replay.baseline.context.loadedIds;

  return {
    mustSelect: selectorsForIds(replay, selected),
    mustNotSelect: selectorsForIds(
      replay,
      baselineSelected.filter((id) => !selected.includes(id))
    ),
    mustLoad: selectorsForIds(replay, loaded),
    mustNotLoad: selectorsForIds(
      replay,
      baselineLoaded.filter((id) => !loaded.includes(id))
    )
  };
}

function selectorsForIds(
  replay: MemoryPolicyReplayResult,
  ids: readonly string[]
): MemorySelectorV2[] {
  const memories = memoryIndex(replay);
  const seen = new Set<string>();
  return ids.flatMap((id) => {
    const memory = memories.get(id);
    if (!memory) return [];
    const selector = selectorFor(memory);
    const matches = [...memories.values()].filter((candidate) => matchesSelector(candidate, selector));
    if (matches.length !== 1) {
      throw new Error(
        `Memory ${id} cannot be represented by a unique semantic selector; matched ${matches.length} memories.`
      );
    }
    const key = selectorKey(selector);
    if (seen.has(key)) return [];
    seen.add(key);
    return [selector];
  });
}

function memoryIndex(replay: MemoryPolicyReplayResult) {
  const result = new Map<string, MemoryDecisionMemory>();
  const add = (memory: MemoryDecisionMemory) => {
    if (!result.has(memory.id)) result.set(memory.id, memory);
  };

  replay.treatment.memoryState.after.forEach(add);
  replay.treatment.memoryState.before.forEach(add);
  replay.treatment.retrieval.candidates.forEach((candidate) => {
    if (candidate.memory) add(candidate.memory);
  });
  replay.baseline.memoryState.after.forEach(add);
  replay.baseline.memoryState.before.forEach(add);
  replay.baseline.retrieval.candidates.forEach((candidate) => {
    if (candidate.memory) add(candidate.memory);
  });
  return result;
}

function selectorFor(memory: MemoryDecisionMemory): MemorySelectorV2 {
  const valueContains = searchableValue(memory.value);
  return {
    ...(memory.subject ? { subject: memory.subject } : {}),
    status: memory.status as MemoryDecisionStatus,
    ...(valueContains ? { valueContains } : {})
  };
}

function matchesSelector(memory: MemoryDecisionMemory, selector: MemorySelectorV2) {
  if (selector.subject !== undefined
    && normalizeSelectorText(memory.subject ?? "") !== normalizeSelectorText(selector.subject)) {
    return false;
  }
  if (selector.status !== undefined && memory.status !== selector.status) return false;
  if (selector.valueContains !== undefined) {
    if (memory.value === undefined) return false;
    const value = typeof memory.value === "string" ? memory.value : JSON.stringify(memory.value);
    if (!normalizeSelectorText(value).includes(normalizeSelectorText(selector.valueContains))) return false;
  }
  return true;
}

function searchableValue(value: MemoryDecisionMemory["value"]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  return JSON.stringify(value);
}

function cloneSelectors(values: readonly Readonly<MemorySelectorV2>[]): MemorySelectorV2[] {
  return values.map((selector) => structuredClone(selector));
}

function normalizePhrases(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const phrase = value.trim();
    const key = phrase.toLowerCase();
    if (!phrase || seen.has(key)) return [];
    seen.add(key);
    return [phrase];
  });
}

function selectorKey(selector: MemorySelectorV2) {
  return JSON.stringify([
    selector.subject?.trim().toLowerCase() ?? null,
    selector.status ?? null,
    selector.valueContains?.trim().toLowerCase() ?? null
  ]);
}

function normalizeSelectorText(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
