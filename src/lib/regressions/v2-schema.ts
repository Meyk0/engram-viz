import {
  memoryDecisionMemorySchema,
  memoryDecisionStatusSchema,
  memoryPolicyReplayResultSchema
} from "@engramviz/core";
import type { MemoryPolicyReplayResult } from "@engramviz/core";
import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(240);
const phraseSchema = z.string().trim().min(1).max(2_000);

function uniqueArray<T extends z.ZodTypeAny>(item: T, maximum: number) {
  return z.array(item).max(maximum).superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      const key = canonicalValue(value);
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate value.",
          path: [index]
        });
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
    match: z.literal("normalized-phrase-with-negation-guard"),
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

  const assertionCount = assertions.lifecycle.mustSelect.length
    + assertions.lifecycle.mustNotSelect.length
    + assertions.lifecycle.mustLoad.length
    + assertions.lifecycle.mustNotLoad.length
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

const distractorSchema = z.object({
  memory: memoryDecisionMemorySchema,
  score: z.number().finite()
}).strict();

const distractorsPerturbationSchema = z.object({
  type: z.literal("distractors"),
  candidates: z.array(distractorSchema).min(1).max(100)
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

const memoryRegressionVariantV2Schema = z.object({
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
export type MemoryRegressionReplayFidelityV2 = z.infer<typeof memoryRegressionReplayFidelityV2Schema>;
export type MemoryRegressionArtifactV2 = z.infer<typeof memoryRegressionArtifactV2Schema>;
export type MemoryRegressionObservationV2 = z.infer<typeof memoryRegressionObservationV2Schema>;

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
      : deterministic && controlsPolicyStages
        ? "controlled"
        : "partial",
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
  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalValue(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(typeof value === "string" ? normalizeText(value) : value);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}
