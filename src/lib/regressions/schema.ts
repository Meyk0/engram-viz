import { z } from "zod";
import { engramMemorySchema } from "@/lib/events/schema";

const uniqueStrings = (maximum: number, itemMaximum = 240) => z
  .array(z.string().trim().min(1).max(itemMaximum))
  .max(maximum)
  .superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate value "${value}".`,
          path: [index]
        });
      }
      seen.add(value);
    });
  });

const providerIdentitySchema = z.object({
  id: z.string().trim().min(1).max(120),
  model: z.string().trim().min(1).max(240).optional()
}).strict();

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(100_000)
}).strict();

const replayMemoryContextSchema = z.object({
  source: z.enum(["recorded-retrieval", "replay-input", "unknown"]),
  retrievalObserved: z.boolean(),
  retrievedMemoryIds: uniqueStrings(500),
  loadedMemoryIds: uniqueStrings(500)
}).strict();

export const memoryRegressionObservationSchema = z.object({
  evidence: z.enum(["recorded", "replayed"]),
  answer: z.string().max(200_000),
  memoryContext: replayMemoryContextSchema,
  runCount: z.number().int().min(1).max(100),
  provider: providerIdentitySchema.optional(),
  recordId: z.string().trim().min(1).max(240).optional(),
  branchId: z.string().trim().min(1).max(240).optional(),
  occurredAt: z.string().datetime().optional(),
  note: z.string().trim().min(1).max(2_000).optional()
}).strict();

const retrievalAssertionsSchema = z.object({
  mustRetrieve: uniqueStrings(100),
  mustNotRetrieve: uniqueStrings(100),
  maxLoaded: z.number().int().min(0).max(500).optional()
}).strict();

const answerAssertionsSchema = z.object({
  match: z.literal("case-insensitive-substring"),
  contains: uniqueStrings(30, 1_000),
  notContains: uniqueStrings(30, 1_000)
}).strict();

export const memoryRegressionArtifactSchema = z.object({
  kind: z.literal("engram.memory-regression"),
  version: z.literal(1),
  id: z.string().trim().min(1).max(240),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(4_000).optional(),
  createdAt: z.string().datetime(),
  provenance: z.object({
    generator: z.object({
      name: z.literal("engram"),
      contractVersion: z.literal(1)
    }).strict(),
    source: z.object({
      kind: z.literal("checkpoint"),
      checkpointVersion: z.literal(1),
      checkpointId: z.string().trim().min(1).max(240),
      checkpointSource: z.enum(["conversation", "dream", "trace"]),
      sourceId: z.string().trim().min(1).max(240),
      sourceCreatedAt: z.string().datetime(),
      index: z.number().int().min(0)
    }).strict(),
    turn: z.object({
      recordId: z.string().trim().min(1).max(240),
      sessionId: z.string().trim().min(1).max(240),
      provider: providerIdentitySchema
    }).strict().optional(),
    metadata: z.record(
      z.string().trim().min(1).max(120),
      z.string().max(2_000)
    ).optional()
  }).strict(),
  fixture: z.object({
    memories: z.array(engramMemorySchema).max(500),
    input: z.object({
      userMessage: z.string().trim().min(1).max(100_000),
      history: z.array(chatMessageSchema).max(1_000)
    }).strict()
  }).strict(),
  evidence: z.object({
    basis: z.enum(["checkpoint-state", "recorded", "replayed", "recorded-and-replayed"]),
    claim: z.literal("behavioral-observation"),
    causalClaim: z.literal(false),
    caveat: z.string().trim().min(1).max(4_000),
    recorded: memoryRegressionObservationSchema.optional(),
    baseline: memoryRegressionObservationSchema.optional(),
    treatment: memoryRegressionObservationSchema.optional()
  }).strict(),
  assertions: z.object({
    retrieval: retrievalAssertionsSchema,
    answer: answerAssertionsSchema
  }).strict()
}).strict().superRefine((artifact, context) => {
  const fixtureIds = artifact.fixture.memories.map((memory) => memory.id);
  const fixtureIdSet = new Set(fixtureIds);
  if (fixtureIdSet.size !== fixtureIds.length) {
    context.addIssue({
      code: "custom",
      message: "Memory fixture IDs must be unique.",
      path: ["fixture", "memories"]
    });
  }

  const mustRetrieve = new Set(artifact.assertions.retrieval.mustRetrieve);
  artifact.assertions.retrieval.mustNotRetrieve.forEach((id, index) => {
    if (mustRetrieve.has(id)) {
      context.addIssue({
        code: "custom",
        message: `Memory "${id}" cannot be both required and forbidden.`,
        path: ["assertions", "retrieval", "mustNotRetrieve", index]
      });
    }
  });

  [
    ...artifact.assertions.retrieval.mustRetrieve,
    ...artifact.assertions.retrieval.mustNotRetrieve
  ].forEach((id) => {
    if (!fixtureIdSet.has(id)) {
      context.addIssue({
        code: "custom",
        message: `Retrieval assertion references unknown fixture memory "${id}".`,
        path: ["assertions", "retrieval"]
      });
    }
  });

  const maxLoaded = artifact.assertions.retrieval.maxLoaded;
  if (maxLoaded !== undefined && maxLoaded < mustRetrieve.size) {
    context.addIssue({
      code: "custom",
      message: "maxLoaded cannot be smaller than the number of required memories.",
      path: ["assertions", "retrieval", "maxLoaded"]
    });
  }

  const requiredText = new Set(
    artifact.assertions.answer.contains.map((value) => value.toLocaleLowerCase())
  );
  artifact.assertions.answer.notContains.forEach((value, index) => {
    if (requiredText.has(value.toLocaleLowerCase())) {
      context.addIssue({
        code: "custom",
        message: `Answer fragment "${value}" cannot be both required and forbidden.`,
        path: ["assertions", "answer", "notContains", index]
      });
    }
  });

  if (artifact.evidence.recorded && artifact.evidence.recorded.evidence !== "recorded") {
    context.addIssue({
      code: "custom",
      message: "Recorded evidence must be labeled recorded.",
      path: ["evidence", "recorded", "evidence"]
    });
  }
  for (const key of ["baseline", "treatment"] as const) {
    if (artifact.evidence[key] && artifact.evidence[key].evidence !== "replayed") {
      context.addIssue({
        code: "custom",
        message: `${key} evidence must be labeled replayed.`,
        path: ["evidence", key, "evidence"]
      });
    }
  }

  const hasRecorded = Boolean(artifact.evidence.recorded);
  const hasReplay = Boolean(artifact.evidence.baseline || artifact.evidence.treatment);
  const expectedBasis = hasRecorded
    ? hasReplay ? "recorded-and-replayed" : "recorded"
    : hasReplay ? "replayed" : "checkpoint-state";
  if (artifact.evidence.basis !== expectedBasis) {
    context.addIssue({
      code: "custom",
      message: `Evidence basis must be "${expectedBasis}" for the included observations.`,
      path: ["evidence", "basis"]
    });
  }
});
