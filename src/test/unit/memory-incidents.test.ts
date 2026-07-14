import { describe, expect, it } from "vitest";
import { memoryBranchReplayRequestSchema } from "@/lib/events/schema";
import { buildIncidentInterventions } from "@/lib/incidents/interventions";
import { applyMemoryBranch, branchContextMemories, createMemoryBranch } from "@/lib/lab/branches";
import { createSampleMemoryIncidentCase } from "@/lib/lab/sample-incident";

describe("memory incidents", () => {
  it("reconstructs a memory-specific causal chain from recorded evidence", () => {
    const incident = createSampleMemoryIncidentCase();

    expect(incident.kind).toBe("engram.memory-incident");
    expect(incident.diagnosis).toMatchObject({
      kind: "update",
      stage: "memory_state",
      origin: "derived"
    });
    expect(incident.stages.map((stage) => stage.kind)).toEqual([
      "memory_state",
      "retrieval",
      "active_context",
      "answer"
    ]);
    expect(incident.stages.find((stage) => stage.kind === "memory_state")?.status).toBe("failed");
    expect(incident.evidence.map((evidence) => evidence.origin)).toContain("observed");
    expect(incident.evidence.map((evidence) => evidence.origin)).toContain("derived");
  });

  it("proposes one diagnosis-specific fix before optional experiments", () => {
    const incident = createSampleMemoryIncidentCase();
    const interventions = buildIncidentInterventions(incident);

    expect(interventions[0]).toMatchObject({
      label: "Prefer the current fact",
      recommended: true
    });
    expect(interventions[0]?.mutations).toEqual([
      expect.objectContaining({
        type: "supersede",
        memoryId: "sample-memory-san-francisco",
        supersededByMemoryId: "sample-memory-oakland"
      })
    ]);
  });

  it("materializes a supersession as an immutable replay branch", () => {
    const incident = createSampleMemoryIncidentCase();
    const intervention = buildIncidentInterventions(incident)[0]!;
    const branch = createMemoryBranch({
      checkpoint: incident.checkpoint,
      id: "branch-current-location",
      createdAt: incident.occurredAt,
      mutations: intervention.mutations
    });
    const materialized = applyMemoryBranch(incident.checkpoint, branch);
    const context = branchContextMemories(incident.record, branch, materialized);

    expect(incident.checkpoint.loadedMemoryIds).toEqual(["sample-memory-san-francisco"]);
    expect(materialized.diff.supersededMemoryIds).toEqual(["sample-memory-san-francisco"]);
    expect(materialized.diff.includedMemoryIds).toEqual(["sample-memory-oakland"]);
    expect(context.map((memory) => memory.id)).toEqual(["sample-memory-oakland"]);
    expect(memoryBranchReplayRequestSchema.safeParse({
      record: incident.record,
      branch,
      branchContextMemories: context
    }).success).toBe(true);
    expect(incident.record.retrievedMemories.map((memory) => memory.id)).toEqual([
      "sample-memory-san-francisco"
    ]);
  });
});
