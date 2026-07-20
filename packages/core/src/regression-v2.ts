import { z } from "zod";
import {
  memoryDecisionMemorySchema,
  memoryDecisionRunV3Schema,
  memoryDecisionStatusSchema,
  memoryPolicyReplayResultSchema
} from "./reliability-schema.js";
import type {
  MemoryDecisionMemory,
  MemoryDecisionRunV3,
  MemoryPolicyReplayResult
} from "./reliability.js";
import type { JsonValue } from "./types.js";

const identifierSchema = z.string().trim().min(1).max(240);
const phraseSchema = z.string().trim().min(1).max(2_000);

function uniqueArray<T extends z.ZodTypeAny>(item: T, maximum: number) {
  return z.array(item).max(maximum).superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      const key = canonicalValue(value);
      if (seen.has(key)) {
        context.addIssue({ code: "custom", message: "Duplicate value.", path: [index] });
      }
      seen.add(key);
    });
  });
}

export const memorySelectorV2Schema = z.object({
  subject: phraseSchema.optional(),
  status: memoryDecisionStatusSchema.optional(),
  valueContains: phraseSchema.optional()
}).strict().refine(
  (selector) => selector.subject !== undefined
    || selector.status !== undefined
    || selector.valueContains !== undefined,
  { message: "A memory selector must define subject, status, or valueContains." }
);

const selectorArraySchema = uniqueArray(memorySelectorV2Schema, 100);

export const memoryRegressionAssertionsV2Schema = z.object({
  lifecycle: z.object({
    mustSelect: selectorArraySchema,
    mustNotSelect: selectorArraySchema,
    mustLoad: selectorArraySchema,
    mustNotLoad: selectorArraySchema
  }).strict(),
  answer: z.object({
    match: z.enum(["normalized-exact", "normalized-phrase-with-negation-guard"]),
    equals: phraseSchema.optional(),
    contains: uniqueArray(phraseSchema, 50),
    notContains: uniqueArray(phraseSchema, 50)
  }).strict()
}).strict().superRefine((assertions, context) => {
  checkOpposingSelectors(
    assertions.lifecycle.mustSelect,
    assertions.lifecycle.mustNotSelect,
    ["lifecycle", "mustNotSelect"],
    context
  );
  checkOpposingSelectors(
    assertions.lifecycle.mustLoad,
    assertions.lifecycle.mustNotLoad,
    ["lifecycle", "mustNotLoad"],
    context
  );

  const required = new Set(assertions.answer.contains.map(normalizeText));
  assertions.answer.notContains.forEach((phrase, index) => {
    if (required.has(normalizeText(phrase))) {
      context.addIssue({
        code: "custom",
        message: `Answer phrase "${phrase}" cannot be both required and forbidden.`,
        path: ["answer", "notContains", index]
      });
    }
  });
  if (assertions.answer.match === "normalized-exact" && !assertions.answer.equals) {
    context.addIssue({
      code: "custom",
      message: "An exact answer assertion must define equals.",
      path: ["answer", "equals"]
    });
  }
  if (assertions.answer.match === "normalized-phrase-with-negation-guard"
    && assertions.answer.equals !== undefined) {
    context.addIssue({
      code: "custom",
      message: "A phrase answer assertion cannot also define equals.",
      path: ["answer", "equals"]
    });
  }

  const assertionCount = assertions.lifecycle.mustSelect.length
    + assertions.lifecycle.mustNotSelect.length
    + assertions.lifecycle.mustLoad.length
    + assertions.lifecycle.mustNotLoad.length
    + (assertions.answer.equals ? 1 : 0)
    + assertions.answer.contains.length
    + assertions.answer.notContains.length;
  if (assertionCount === 0) {
    context.addIssue({
      code: "custom",
      message: "A memory regression must define at least one assertion."
    });
  }
});

const entitySubstitutionSchema = z.object({
  type: z.literal("entity_substitution"),
  target: memorySelectorV2Schema,
  from: phraseSchema,
  to: phraseSchema
}).strict().refine(
  (definition) => normalizeText(definition.from) !== normalizeText(definition.to),
  { message: "Entity substitution values must differ.", path: ["to"] }
);

const scoreMarginSchema = z.object({
  type: z.literal("score_margin"),
  leader: memorySelectorV2Schema,
  challenger: memorySelectorV2Schema,
  margin: z.number().finite().nonnegative()
}).strict().refine(
  (definition) => canonicalValue(definition.leader) !== canonicalValue(definition.challenger),
  { message: "Score-margin selectors must differ.", path: ["challenger"] }
);

const timestampPerturbationSchema = z.object({
  type: z.literal("timestamps"),
  target: memorySelectorV2Schema,
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  validFrom: z.string().datetime().optional(),
  validTo: z.string().datetime().optional()
}).strict().refine(
  (definition) => definition.createdAt !== undefined
    || definition.updatedAt !== undefined
    || definition.validFrom !== undefined
    || definition.validTo !== undefined,
  { message: "A timestamp perturbation must replace at least one timestamp." }
).refine(
  (definition) => !definition.validFrom
    || !definition.validTo
    || Date.parse(definition.validTo) >= Date.parse(definition.validFrom),
  { message: "validTo cannot precede validFrom.", path: ["validTo"] }
);

const distractorsPerturbationSchema = z.object({
  type: z.literal("distractors"),
  candidates: z.array(z.object({
    memory: memoryDecisionMemorySchema,
    score: z.number().finite()
  }).strict()).min(1).max(100)
}).strict().superRefine((definition, context) => {
  const seen = new Set<string>();
  definition.candidates.forEach((candidate, index) => {
    if (seen.has(candidate.memory.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate distractor memory ID "${candidate.memory.id}".`,
        path: ["candidates", index, "memory", "id"]
      });
    }
    seen.add(candidate.memory.id);
  });
});

const queryParaphraseSchema = z.object({
  type: z.literal("query_paraphrase"),
  query: z.string().trim().min(1).max(100_000)
}).strict();

export const memoryRegressionPerturbationV2Schema = z.discriminatedUnion("type", [
  entitySubstitutionSchema,
  scoreMarginSchema,
  timestampPerturbationSchema,
  distractorsPerturbationSchema,
  queryParaphraseSchema
]);

export const memoryRegressionVariantV2Schema = z.object({
  id: identifierSchema,
  label: z.string().trim().min(1).max(240),
  perturbations: z.array(memoryRegressionPerturbationV2Schema).max(20)
}).strict();

export const memoryRegressionReplayFidelityV2Schema = z.object({
  basis: z.literal("declared-replay-capabilities"),
  level: z.enum(["exact", "controlled", "partial"]),
  deterministic: z.boolean(),
  candidateSet: z.enum(["regenerated", "recorded", "unknown"]),
  answerGeneration: z.enum(["rerun", "recorded-output"]),
  repeatedRuns: z.boolean(),
  evidenceCoverage: z.object({
    memory_state: z.enum(["observed", "mapped", "derived", "simulated", "unavailable"]),
    retrieval: z.enum(["observed", "mapped", "derived", "simulated", "unavailable"]),
    selection: z.enum(["observed", "mapped", "derived", "simulated", "unavailable"]),
    active_context: z.enum(["observed", "mapped", "derived", "simulated", "unavailable"]),
    answer: z.enum(["observed", "mapped", "derived", "simulated", "unavailable"])
  }).strict(),
  caveats: z.array(z.string().trim().min(1).max(4_000)).min(1).max(20)
}).strict();

export const memoryRegressionArtifactV2Schema = z.object({
  format: z.literal("engram.memory-regression"),
  version: z.literal(2),
  id: identifierSchema,
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(4_000).optional(),
  createdAt: z.string().datetime(),
  sourceReplay: z.object({
    result: memoryPolicyReplayResultSchema,
    fidelity: memoryRegressionReplayFidelityV2Schema
  }).strict(),
  assertions: memoryRegressionAssertionsV2Schema,
  matrix: z.object({
    aggregation: z.literal("all-variants"),
    variants: z.array(memoryRegressionVariantV2Schema).min(1).max(101)
  }).strict()
}).strict().superRefine((artifact, context) => {
  const expectedFidelity = deriveMemoryRegressionReplayFidelityV2(
    artifact.sourceReplay.result as MemoryPolicyReplayResult
  );
  if (canonicalValue(artifact.sourceReplay.fidelity) !== canonicalValue(expectedFidelity)) {
    context.addIssue({
      code: "custom",
      message: "Source replay fidelity must match the replay's declared capabilities and evidence.",
      path: ["sourceReplay", "fidelity"]
    });
  }

  const seen = new Set<string>();
  artifact.matrix.variants.forEach((variant, index) => {
    if (seen.has(variant.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate matrix variant ID "${variant.id}".`,
        path: ["matrix", "variants", index, "id"]
      });
    }
    seen.add(variant.id);
    if (index === 0 && (variant.id !== "source" || variant.perturbations.length !== 0)) {
      context.addIssue({
        code: "custom",
        message: "The first matrix variant must be the unperturbed source variant.",
        path: ["matrix", "variants", index]
      });
    }
    if (index > 0 && variant.perturbations.length === 0) {
      context.addIssue({
        code: "custom",
        message: "A non-source matrix variant must define a perturbation.",
        path: ["matrix", "variants", index, "perturbations"]
      });
    }
  });
});

export const memoryRegressionObservationV2Schema = z.object({
  variantId: identifierSchema,
  memories: z.array(memoryDecisionMemorySchema).max(10_000),
  selectedMemoryIds: uniqueArray(identifierSchema, 10_000),
  loadedMemoryIds: uniqueArray(identifierSchema, 10_000),
  forcedMemoryIds: uniqueArray(identifierSchema, 10_000).default([]),
  answer: z.string().max(200_000)
}).strict().superRefine((observation, context) => {
  const memoryIds = new Set<string>();
  observation.memories.forEach((memory, index) => {
    if (memoryIds.has(memory.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate observed memory ID "${memory.id}".`,
        path: ["memories", index, "id"]
      });
    }
    memoryIds.add(memory.id);
  });

  const selected = new Set(observation.selectedMemoryIds);
  observation.selectedMemoryIds.forEach((id, index) => {
    if (!memoryIds.has(id)) {
      context.addIssue({
        code: "custom",
        message: `Selected memory "${id}" is absent from the observation.`,
        path: ["selectedMemoryIds", index]
      });
    }
  });
  const forced = new Set(observation.forcedMemoryIds);
  observation.loadedMemoryIds.forEach((id, index) => {
    if (!memoryIds.has(id)) {
      context.addIssue({
        code: "custom",
        message: `Loaded memory "${id}" is absent from the observation.`,
        path: ["loadedMemoryIds", index]
      });
    }
    if (!selected.has(id) && !forced.has(id)) {
      context.addIssue({
        code: "custom",
        message: `Loaded memory "${id}" was neither selected nor forced.`,
        path: ["loadedMemoryIds", index]
      });
    }
  });
  observation.forcedMemoryIds.forEach((id, index) => {
    if (!observation.loadedMemoryIds.includes(id)) {
      context.addIssue({
        code: "custom",
        message: `Forced memory "${id}" is not loaded.`,
        path: ["forcedMemoryIds", index]
      });
    }
  });
});

export const memoryRegressionMatrixObservationsV2Schema = z.array(
  memoryRegressionObservationV2Schema
).max(101).superRefine((observations, context) => {
  const seen = new Set<string>();
  observations.forEach((observation, index) => {
    if (seen.has(observation.variantId)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate observation for variant "${observation.variantId}".`,
        path: [index, "variantId"]
      });
    }
    seen.add(observation.variantId);
  });
});

export type MemorySelectorV2 = z.infer<typeof memorySelectorV2Schema>;
export type MemoryRegressionAssertionsV2 = z.infer<typeof memoryRegressionAssertionsV2Schema>;
export type MemoryRegressionPerturbationV2 = z.infer<typeof memoryRegressionPerturbationV2Schema>;
export type MemoryRegressionVariantV2 = z.infer<typeof memoryRegressionVariantV2Schema>;
export type MemoryRegressionReplayFidelityV2 = z.infer<typeof memoryRegressionReplayFidelityV2Schema>;
export type MemoryRegressionArtifactV2 = z.infer<typeof memoryRegressionArtifactV2Schema>;
export type MemoryRegressionObservationV2 = z.infer<typeof memoryRegressionObservationV2Schema>;

export type MemoryRegressionFindingV2 = Readonly<{
  id: string;
  category: "lifecycle" | "answer";
  assertion: "mustSelect" | "mustNotSelect" | "mustLoad" | "mustNotLoad" | "equals" | "contains" | "notContains";
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
  summary: Readonly<{ total: number; passed: number; failed: number }>;
}>;

export type MemoryRegressionMatrixReportV2 = Readonly<{
  artifact: Readonly<{ id: string; title: string; version: 2 }>;
  pass: boolean;
  status: "passed" | "failed";
  variants: readonly MemoryRegressionVariantReportV2[];
  summary: Readonly<{
    variants: Readonly<{ total: number; passed: number; failed: number; missing: number }>;
    findings: Readonly<{ total: number; passed: number; failed: number }>;
  }>;
}>;

type ObservedMemoryV2 = MemoryRegressionObservationV2["memories"][number];

export function deriveMemoryRegressionReplayFidelityV2(
  replay: MemoryPolicyReplayResult
): MemoryRegressionReplayFidelityV2 {
  const capabilities = replay.capabilities;
  const deterministic = capabilities.deterministic && replay.executor.deterministic;
  const rerunsAllStages = capabilities.rerunsCandidateGeneration
    && capabilities.rerunsEligibility
    && capabilities.rerunsRanking
    && capabilities.rerunsSelection
    && capabilities.rerunsContextAssembly
    && capabilities.rerunsGeneration;
  const controlsPolicyStages = capabilities.rerunsEligibility
    && capabilities.rerunsRanking
    && capabilities.rerunsSelection
    && capabilities.rerunsContextAssembly
    && (capabilities.rerunsCandidateGeneration || capabilities.reusesRecordedCandidates);

  return {
    basis: "declared-replay-capabilities",
    level: deterministic && rerunsAllStages
      ? "exact"
      : deterministic && controlsPolicyStages ? "controlled" : "partial",
    deterministic,
    candidateSet: capabilities.rerunsCandidateGeneration
      ? "regenerated"
      : capabilities.reusesRecordedCandidates ? "recorded" : "unknown",
    answerGeneration: capabilities.rerunsGeneration ? "rerun" : "recorded-output",
    repeatedRuns: capabilities.supportsRepeatedRuns,
    evidenceCoverage: structuredClone(replay.treatment.evidenceCoverage),
    caveats: [replay.caveat]
  };
}

export function parseMemoryRegressionArtifactV2(input: unknown): MemoryRegressionArtifactV2 {
  return deepFreeze(memoryRegressionArtifactV2Schema.parse(input));
}

export function parseMemoryRegressionObservationV2(input: unknown): MemoryRegressionObservationV2 {
  return deepFreeze(memoryRegressionObservationV2Schema.parse(input));
}

export function parseMemoryRegressionMatrixObservationsV2(
  input: unknown
): readonly MemoryRegressionObservationV2[] {
  return deepFreeze(memoryRegressionMatrixObservationsV2Schema.parse(input));
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

export function applyMemoryRegressionPerturbationsV2(
  sourceInput: MemoryDecisionRunV3,
  variantId: string,
  perturbations: readonly MemoryRegressionPerturbationV2[]
): MemoryDecisionRunV3 {
  const source = structuredClone(memoryDecisionRunV3Schema.parse(sourceInput)) as MemoryDecisionRunV3;
  source.id = `${source.id}-regression-${variantId}`;
  source.metadata = {
    ...(source.metadata ?? {}),
    regressionVariantId: variantId,
    perturbationCount: perturbations.length
  };

  for (const perturbation of perturbations) {
    const before = canonicalValue(source);
    if (perturbation.type === "query_paraphrase") {
      source.input = perturbation.query;
      source.retrieval.query = perturbation.query;
    } else if (perturbation.type === "distractors") {
      perturbation.candidates.forEach((candidate) => {
        addRegressionDistractor(source, candidate.memory as MemoryDecisionMemory, candidate.score);
      });
    } else if (perturbation.type === "score_margin") {
      applyRegressionScoreMargin(
        source,
        perturbation.leader,
        perturbation.challenger,
        perturbation.margin
      );
    } else {
      const matchedIds = mutateRegressionMemories(source, perturbation.target, (memory) => {
        if (perturbation.type === "entity_substitution") {
          memory.content = replaceRegressionJsonText(memory.content, perturbation.from, perturbation.to);
          if (memory.value !== undefined) {
            memory.value = replaceRegressionJsonText(memory.value, perturbation.from, perturbation.to);
          }
          if (memory.subject) {
            memory.subject = replaceRegressionText(memory.subject, perturbation.from, perturbation.to);
          }
        } else {
          if (perturbation.createdAt) memory.createdAt = perturbation.createdAt;
          if (perturbation.updatedAt) memory.updatedAt = perturbation.updatedAt;
          if (perturbation.validFrom) memory.validFrom = perturbation.validFrom;
          if (perturbation.validTo) memory.validTo = perturbation.validTo;
        }
        memory.evidence = "simulated";
      });
      if (matchedIds.size !== 1) {
        throw new Error(
          `Regression ${perturbation.type} selector must match exactly one memory; matched ${matchedIds.size}.`
        );
      }
    }
    if (canonicalValue(source) === before) {
      throw new Error(`Regression ${perturbation.type} perturbation did not change the replay input.`);
    }
  }

  source.retrieval.candidates.forEach((candidate, index) => {
    candidate.rank = index + 1;
    candidate.selected = source.retrieval.selectedIds.includes(candidate.memoryId);
    candidate.loaded = source.context.loadedIds.includes(candidate.memoryId);
    candidate.evidence = "simulated";
  });

  return deepFreeze(memoryDecisionRunV3Schema.parse(source) as MemoryDecisionRunV3);
}

export function evaluateMemoryRegressionMatrixV2(
  artifactInput: unknown,
  observationsInput: unknown
): MemoryRegressionMatrixReportV2 {
  const artifact = parseMemoryRegressionArtifactV2(artifactInput);
  const observations = parseMemoryRegressionMatrixObservationsV2(observationsInput);
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
    return evaluateVariant(artifact, observation, variant.label, variant.perturbations);
  });
  const allFindings = variantReports.flatMap((variant) => variant.findings);
  const missing = variantReports.filter((variant) => variant.status === "missing").length;
  const passedVariants = variantReports.filter((variant) => variant.pass).length;
  const pass = passedVariants === variantReports.length;

  return deepFreeze({
    artifact: { id: artifact.id, title: artifact.title, version: 2 },
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

function evaluateVariant(
  artifact: MemoryRegressionArtifactV2,
  observation: MemoryRegressionObservationV2,
  label: string,
  perturbations: readonly MemoryRegressionPerturbationV2[]
): MemoryRegressionVariantReportV2 {
  const findings: MemoryRegressionFindingV2[] = [];
  const memoryById = new Map(observation.memories.map((memory) => [memory.id, memory]));
  const selected = observation.selectedMemoryIds.map((id) => memoryById.get(id)!);
  const loaded = observation.loadedMemoryIds.map((id) => memoryById.get(id)!);
  const assertions = transformAssertions(artifact.assertions, perturbations);
  const lifecycle = assertions.lifecycle;

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

  if (assertions.answer.match === "normalized-exact" && assertions.answer.equals) {
    const pass = normalizeAnswer(observation.answer) === normalizeAnswer(assertions.answer.equals);
    findings.push({
      id: "answer.equals:0",
      category: "answer",
      assertion: "equals",
      pass,
      expected: assertions.answer.equals,
      observed: observation.answer,
      message: pass
        ? "Answer exactly matches the normalized expected answer."
        : "Answer does not exactly match the normalized expected answer."
    });
  }

  assertions.answer.contains.forEach((phrase, index) => {
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
  assertions.answer.notContains.forEach((phrase, index) => {
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
    summary: { total: findings.length, passed, failed: findings.length - passed }
  };
}

function transformAssertions(
  assertions: MemoryRegressionArtifactV2["assertions"],
  perturbations: readonly MemoryRegressionPerturbationV2[]
) {
  const result = structuredClone(assertions);
  for (const perturbation of perturbations) {
    if (perturbation.type !== "entity_substitution") continue;
    for (const selectors of Object.values(result.lifecycle)) {
      for (const selector of selectors) {
        if (selector.subject) {
          selector.subject = replaceText(selector.subject, perturbation.from, perturbation.to);
        }
        if (selector.valueContains) {
          selector.valueContains = replaceText(selector.valueContains, perturbation.from, perturbation.to);
        }
      }
    }
    result.answer.contains = result.answer.contains.map(
      (phrase) => replaceText(phrase, perturbation.from, perturbation.to)
    );
    result.answer.notContains = result.answer.notContains.map(
      (phrase) => replaceText(phrase, perturbation.from, perturbation.to)
    );
    if (result.answer.equals) {
      result.answer.equals = replaceText(result.answer.equals, perturbation.from, perturbation.to);
    }
  }
  return result;
}

function replaceText(value: string, from: string, to: string) {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(escaped, "gi"), to);
}

function lifecycleFinding(
  assertion: "mustSelect" | "mustNotSelect" | "mustLoad" | "mustNotLoad",
  selector: MemorySelectorV2,
  memories: readonly ObservedMemoryV2[],
  index: number
): MemoryRegressionFindingV2 {
  const matches = memories.filter((memory) => matchesSelector(memory, selector));
  const requiresMatch = assertion === "mustSelect" || assertion === "mustLoad";
  const pass = requiresMatch ? matches.length === 1 : matches.length === 0;
  const action = assertion === "mustSelect" || assertion === "mustNotSelect" ? "selected" : "loaded";
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
    const value = typeof memory.value === "string" ? memory.value : JSON.stringify(memory.value);
    if (!containsPhrase(value, selector.valueContains)) return false;
  }
  return true;
}

function mutateRegressionMemories(
  run: MemoryDecisionRunV3,
  selector: MemorySelectorV2,
  mutate: (memory: MemoryDecisionMemory) => void
) {
  const matchedIds = new Set<string>();
  const collections = [
    run.memoryState.before,
    run.memoryState.after,
    run.retrieval.candidates.flatMap((candidate) => candidate.memory ? [candidate.memory] : [])
  ];
  for (const collection of collections) {
    for (const memory of collection) {
      if (!matchesSelector(memory, selector)) continue;
      matchedIds.add(memory.id);
      mutate(memory);
    }
  }
  return matchedIds;
}

function addRegressionDistractor(
  run: MemoryDecisionRunV3,
  memoryInput: MemoryDecisionMemory,
  score: number
) {
  const memory = { ...structuredClone(memoryInput), evidence: "simulated" as const };
  if (run.memoryState.before.some((candidate) => candidate.id === memory.id)
    || run.memoryState.after.some((candidate) => candidate.id === memory.id)
    || run.retrieval.candidates.some((candidate) => candidate.memoryId === memory.id)) {
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

function applyRegressionScoreMargin(
  run: MemoryDecisionRunV3,
  leaderSelector: MemorySelectorV2,
  challengerSelector: MemorySelectorV2,
  margin: number
) {
  const leader = findRegressionCandidate(run, leaderSelector);
  const challenger = findRegressionCandidate(run, challengerSelector);
  if (!leader || !challenger) {
    throw new Error("Regression score-margin selectors did not match two candidates.");
  }
  const anchor = Math.max(leader.score ?? 0, challenger.score ?? 0);
  leader.score = anchor;
  challenger.score = anchor - margin;
  leader.evidence = "simulated";
  challenger.evidence = "simulated";
}

function findRegressionCandidate(run: MemoryDecisionRunV3, selector: MemorySelectorV2) {
  const memoryById = new Map(run.memoryState.before.map((memory) => [memory.id, memory]));
  const matches = run.retrieval.candidates.filter((candidate) => {
    const memory = candidate.memory ?? memoryById.get(candidate.memoryId);
    return Boolean(memory && matchesSelector(memory, selector));
  });
  if (matches.length !== 1) {
    throw new Error(`Regression score selector must match exactly one candidate; matched ${matches.length}.`);
  }
  return matches[0];
}

function replaceRegressionJsonText(value: JsonValue, from: string, to: string): JsonValue {
  if (typeof value === "string") return replaceRegressionText(value, from, to);
  if (Array.isArray(value)) {
    return value.map((item) => replaceRegressionJsonText(item, from, to));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(
      ([key, item]) => [key, replaceRegressionJsonText(item, from, to)]
    ));
  }
  return value;
}

function replaceRegressionText(value: string, from: string, to: string) {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(escaped, "gi"), to);
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

function normalizeAnswer(value: string) {
  return tokens(value).join(" ");
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

function checkOpposingSelectors(
  required: readonly MemorySelectorV2[],
  forbidden: readonly MemorySelectorV2[],
  path: (string | number)[],
  context: z.RefinementCtx
) {
  const requiredKeys = new Set(required.map(canonicalValue));
  forbidden.forEach((selector, index) => {
    if (requiredKeys.has(canonicalValue(selector))) {
      context.addIssue({
        code: "custom",
        message: "The same selector cannot be both required and forbidden.",
        path: [...path, index]
      });
    }
  });
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function canonicalValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalValue(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(typeof value === "string" ? normalizeText(value) : value);
}

const NEGATION_WORDS = new Set([
  "not", "no", "never", "neither", "nor", "without", "cannot", "can't", "isn't",
  "aren't", "wasn't", "weren't", "don't", "doesn't", "didn't", "won't", "wouldn't",
  "shouldn't", "couldn't", "hasn't", "haven't", "hadn't"
]);

const AUXILIARY_WORDS = new Set([
  "is", "are", "was", "were", "do", "does", "did", "can", "could", "will", "would",
  "should", "has", "have", "had"
]);

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}
