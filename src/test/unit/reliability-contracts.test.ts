import {
  memoryDecisionRunV3Schema,
  memoryInterventionV2Schema,
  memoryPolicyReplayResultSchema
} from "@engramviz/core";
import { describe, expect, it } from "vitest";
import { memoryDecisionRunFromIncident } from "@/lib/reliability/from-incident";
import { createSampleMemoryIncidentCase } from "@/lib/lab/sample-incident";

describe("memory reliability contracts", () => {
  it("validates a complete v3 decision run reconstructed from an incident", () => {
    const run = memoryDecisionRunFromIncident(createSampleMemoryIncidentCase());

    expect(memoryDecisionRunV3Schema.parse(run)).toEqual(run);
    expect(run.retrieval.candidates).toHaveLength(2);
    expect(run.retrieval.candidates[0]?.memory?.content).toContain("San Francisco");
    expect(run.evidenceCoverage).toMatchObject({
      memory_state: "observed",
      retrieval: "observed",
      selection: "observed",
      active_context: "observed",
      answer: "observed"
    });
  });

  it("rejects loaded memories that were not selected", () => {
    const run = memoryDecisionRunFromIncident(createSampleMemoryIncidentCase());
    const invalid = structuredClone(run);
    invalid.context.loadedIds = ["sample-memory-oakland"];

    expect(() => memoryDecisionRunV3Schema.parse(invalid)).toThrow(/was not selected/i);
  });

  it("requires interventions to contain at least one explicit operation", () => {
    const run = memoryDecisionRunFromIncident(createSampleMemoryIncidentCase());
    expect(() => memoryInterventionV2Schema.parse({
      format: "engram.memory-intervention",
      version: 2,
      id: "empty",
      targetRunId: run.id,
      label: "Empty",
      rationale: "No operation",
      operations: [],
      createdAt: run.completedAt
    })).toThrow();
  });

  it("keeps policy replay result evidence machine-readable", async () => {
    const { createStaleLocationPolicyReplay } = await import("@/lib/reliability/stale-location");
    const result = createStaleLocationPolicyReplay();

    expect(memoryPolicyReplayResultSchema.parse(result)).toEqual(result);
    expect(result.capabilities).toMatchObject({
      reusesRecordedCandidates: true,
      rerunsCandidateGeneration: false,
      rerunsEligibility: true,
      rerunsRanking: true,
      rerunsSelection: true,
      rerunsContextAssembly: true,
      rerunsGeneration: true
    });
  });
});
