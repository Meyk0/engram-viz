import { z } from "zod";
import {
  memoryAnswerAssertionSchema,
  memoryDecisionRunV3Schema,
  memoryInterventionV2Schema,
  memoryPolicyReplayResultSchema
} from "./reliability-schema.js";
import type {
  MemoryExecutorManifest,
  MemoryExecutorReplayRequest,
  MemoryPolicyReplayRequest,
  MemoryPolicyReplayResult
} from "./reliability.js";

const identifierSchema = z.string().trim().min(1).max(240);

export const memoryReplaySideEffectModeSchema = z.enum(["blocked", "recorded", "execute"]);

export const memoryReplayCapabilitiesSchema = z.object({
  levels: z.array(z.enum(["context", "policy", "provider", "agent", "robustness"])).min(1),
  deterministic: z.boolean(),
  reusesRecordedCandidates: z.boolean(),
  rerunsCandidateGeneration: z.boolean(),
  rerunsEligibility: z.boolean(),
  rerunsRanking: z.boolean(),
  rerunsSelection: z.boolean(),
  rerunsContextAssembly: z.boolean(),
  rerunsGeneration: z.boolean(),
  supportsPolicyInterventions: z.boolean(),
  supportsStateInterventions: z.boolean(),
  supportsRepeatedRuns: z.boolean()
}).strict().superRefine((capabilities, context) => {
  if (new Set(capabilities.levels).size !== capabilities.levels.length) {
    context.addIssue({ code: "custom", message: "Replay capability levels must be unique.", path: ["levels"] });
  }
  if (capabilities.reusesRecordedCandidates && capabilities.rerunsCandidateGeneration) {
    context.addIssue({
      code: "custom",
      message: "An executor cannot reuse recorded candidates and rerun candidate generation.",
      path: ["rerunsCandidateGeneration"]
    });
  }
});

export const memoryExecutorManifestSchema = z.object({
  format: z.literal("engram.memory-executor"),
  version: z.literal(1),
  id: identifierSchema,
  name: z.string().trim().min(1).max(240),
  executorVersion: identifierSchema,
  framework: z.object({
    id: identifierSchema,
    version: identifierSchema.optional()
  }).strict(),
  capabilities: memoryReplayCapabilitiesSchema,
  sideEffects: z.object({
    defaultMode: memoryReplaySideEffectModeSchema,
    supportedModes: z.array(memoryReplaySideEffectModeSchema).min(1).max(3)
  }).strict()
}).strict().superRefine((manifest, context) => {
  if (new Set(manifest.sideEffects.supportedModes).size !== manifest.sideEffects.supportedModes.length) {
    context.addIssue({ code: "custom", message: "Supported side-effect modes must be unique.", path: ["sideEffects", "supportedModes"] });
  }
  if (!manifest.sideEffects.supportedModes.includes(manifest.sideEffects.defaultMode)) {
    context.addIssue({ code: "custom", message: "The default side-effect mode must be supported.", path: ["sideEffects", "defaultMode"] });
  }
});

export const memoryPolicyReplayRequestSchema = z.object({
  baseline: memoryDecisionRunV3Schema,
  intervention: memoryInterventionV2Schema,
  answerAssertion: memoryAnswerAssertionSchema.optional(),
  expectedAnswerFragments: z.array(z.string().trim().min(1).max(4_000)).max(100).optional()
}).strict().superRefine((request, context) => {
  if (request.intervention.targetRunId !== request.baseline.id) {
    context.addIssue({ code: "custom", message: "The intervention must target the baseline run.", path: ["intervention", "targetRunId"] });
  }
});

export const memoryExecutorReplayRequestSchema = z.object({
  format: z.literal("engram.memory-executor-replay"),
  version: z.literal(1),
  request: memoryPolicyReplayRequestSchema,
  sideEffectMode: memoryReplaySideEffectModeSchema
}).strict();

export function parseMemoryExecutorManifest(input: unknown): MemoryExecutorManifest {
  return memoryExecutorManifestSchema.parse(input) as MemoryExecutorManifest;
}

export function parseMemoryPolicyReplayRequest(input: unknown): MemoryPolicyReplayRequest {
  return memoryPolicyReplayRequestSchema.parse(input) as MemoryPolicyReplayRequest;
}

export function parseMemoryExecutorReplayRequest(input: unknown): MemoryExecutorReplayRequest {
  return memoryExecutorReplayRequestSchema.parse(input) as MemoryExecutorReplayRequest;
}

export function parseMemoryExecutorReplayResult(input: unknown): MemoryPolicyReplayResult {
  return memoryPolicyReplayResultSchema.parse(input) as MemoryPolicyReplayResult;
}
