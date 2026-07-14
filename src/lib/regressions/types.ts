import type { z } from "zod";
import type {
  memoryRegressionArtifactSchema,
  memoryRegressionObservationSchema
} from "@/lib/regressions/schema";

export type MemoryRegressionArtifact = z.infer<typeof memoryRegressionArtifactSchema>;
export type MemoryRegressionObservation = z.infer<typeof memoryRegressionObservationSchema>;

export type MemoryRegressionReplayResult = {
  answer: string;
  retrievedMemoryIds?: readonly string[];
  loadedMemoryIds?: readonly string[];
  retrievalObserved?: boolean;
  runCount?: number;
  provider?: {
    id: string;
    model?: string;
  };
  recordId?: string;
  branchId?: string;
  occurredAt?: string;
  note?: string;
};

export type MemoryRegressionAssertionsInput = {
  retrieval?: {
    mustRetrieve?: readonly string[];
    mustNotRetrieve?: readonly string[];
    maxLoaded?: number;
  };
  answer?: {
    contains?: readonly string[];
    notContains?: readonly string[];
  };
};

