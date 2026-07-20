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
      memory_state: "mapped",
      retrieval: "observed",
      selection: "observed",
      active_context: "mapped",
      answer: "observed"
    });
  });

  it("rejects loaded memories that were not selected", () => {
    const run = memoryDecisionRunFromIncident(createSampleMemoryIncidentCase());
    const invalid = structuredClone(run);
    invalid.context.loadedIds = ["sample-memory-oakland"];

    expect(() => memoryDecisionRunV3Schema.parse(invalid)).toThrow(/was not selected or forced/i);
  });

  it.each([
    {
      name: "duplicate after-state IDs",
      mutate: (run: ReturnType<typeof memoryDecisionRunFromIncident>) => {
        run.memoryState.after.push(structuredClone(run.memoryState.after[0]!));
      },
      error: /after-state memory ids must be unique/i
    },
    {
      name: "candidate-memory ID disagreement",
      mutate: (run: ReturnType<typeof memoryDecisionRunFromIncident>) => {
        run.retrieval.candidates[0]!.memory!.id = "another-memory";
      },
      error: /embeds memory/i
    },
    {
      name: "selected flag disagreement",
      mutate: (run: ReturnType<typeof memoryDecisionRunFromIncident>) => {
        run.retrieval.candidates[0]!.selected = false;
      },
      error: /selected flag does not match/i
    },
    {
      name: "loaded flag disagreement",
      mutate: (run: ReturnType<typeof memoryDecisionRunFromIncident>) => {
        run.retrieval.candidates[0]!.loaded = false;
      },
      error: /loaded flag does not match/i
    },
    {
      name: "unknown ordered context ID",
      mutate: (run: ReturnType<typeof memoryDecisionRunFromIncident>) => {
        run.context.loadedIds = ["unknown"];
        run.context.orderedIds = ["unknown"];
        run.context.forcedIds = ["unknown"];
        run.retrieval.candidates[0]!.loaded = false;
      },
      error: /not known to this run/i
    },
    {
      name: "incorrect truncation set",
      mutate: (run: ReturnType<typeof memoryDecisionRunFromIncident>) => {
        run.context.truncatedIds = [...run.retrieval.selectedIds];
      },
      error: /truncatedIds must equal/i
    },
    {
      name: "forced memory already selected",
      mutate: (run: ReturnType<typeof memoryDecisionRunFromIncident>) => {
        run.context.forcedIds = [...run.retrieval.selectedIds];
      },
      error: /already selected/i
    },
    {
      name: "unavailable evidence with populated context",
      mutate: (run: ReturnType<typeof memoryDecisionRunFromIncident>) => {
        run.evidenceCoverage.active_context = "unavailable";
        run.context.evidence = "unavailable";
      },
      error: /unavailable active-context evidence/i
    }
  ])("rejects $name", ({ mutate, error }) => {
    const run = memoryDecisionRunFromIncident(createSampleMemoryIncidentCase());
    mutate(run);

    expect(() => memoryDecisionRunV3Schema.parse(run)).toThrow(error);
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

  it.each([
    {
      name: "duplicate operation IDs",
      operations: [
        { id: "same", type: "policy_rule", rule: "exclude_expired", enabled: true, reason: "One" },
        { id: "same", type: "policy_rule", rule: "exclude_superseded", enabled: true, reason: "Two" }
      ],
      error: /operation ids must be unique/i
    },
    {
      name: "conflicting policy writes",
      operations: [
        { id: "one", type: "policy_rule", rule: "exclude_expired", enabled: true, reason: "One" },
        { id: "two", type: "policy_rule", rule: "exclude_expired", enabled: false, reason: "Two" }
      ],
      error: /conflicting policy rule/i
    },
    {
      name: "invalid retrieval limit",
      operations: [
        { id: "limit", type: "retrieval_parameter", parameter: "limit", value: 1.5, reason: "Invalid" }
      ],
      error: /retrieval limit must be an integer/i
    },
    {
      name: "invalid threshold",
      operations: [
        { id: "threshold", type: "retrieval_parameter", parameter: "score_threshold", value: 1.5, reason: "Invalid" }
      ],
      error: /score threshold must be between/i
    }
  ])("rejects $name", ({ operations, error }) => {
    const run = memoryDecisionRunFromIncident(createSampleMemoryIncidentCase());
    expect(() => memoryInterventionV2Schema.parse({
      format: "engram.memory-intervention",
      version: 2,
      id: "invalid",
      targetRunId: run.id,
      label: "Invalid",
      rationale: "Exercise an adversarial contract.",
      operations,
      createdAt: run.completedAt
    })).toThrow(error);
  });

  it("does not fabricate a memory snapshot when the incident lacks an init event", () => {
    const incident = structuredClone(createSampleMemoryIncidentCase());
    incident.record.events = incident.record.events.filter((event) => event.type !== "init");

    const run = memoryDecisionRunFromIncident(incident);

    expect(run.evidenceCoverage.memory_state).toBe("unavailable");
    expect(run.memoryState).toEqual({ before: [], after: [] });
    expect(run.retrieval.candidates[0]?.memory?.evidence).toBe("observed");
    expect(run.retrieval.candidates[1]?.memory?.evidence).toBe("mapped");
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

  it("rejects impossible replay capability and verification claims", async () => {
    const { createStaleLocationPolicyReplay } = await import("@/lib/reliability/stale-location");
    const result = createStaleLocationPolicyReplay();
    const impossibleCapabilities = structuredClone(result);
    impossibleCapabilities.capabilities.rerunsCandidateGeneration = true;

    expect(() => memoryPolicyReplayResultSchema.parse(impossibleCapabilities))
      .toThrow(/cannot both reuse recorded candidates and rerun candidate generation/i);

    const impossibleVerification = structuredClone(result);
    impossibleVerification.reproduction.reproduced = false;
    impossibleVerification.verification.passed = true;
    impossibleVerification.verification.failures = [];
    expect(() => memoryPolicyReplayResultSchema.parse(impossibleVerification))
      .toThrow(/cannot pass without baseline reproduction/i);
  });
});
