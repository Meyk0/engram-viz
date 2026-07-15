import { describe, expect, it } from "vitest";
import { buildIncidentInterventions } from "@/lib/incidents/interventions";
import { buildSourceRemediationRecipe } from "@/lib/incidents/remediation";
import type { MemoryIncident } from "@/lib/incidents/types";
import { createSampleMemoryIncidentCase } from "@/lib/lab/sample-incident";

describe("source remediation recipes", () => {
  it("turns a passing Mem0 supersede branch into a manual source recipe", () => {
    const sample = structuredClone(createSampleMemoryIncidentCase()) as MemoryIncident;
    sample.memories = sample.memories.map((memory) => ({ ...memory, provider: "mem0" }));
    const intervention = buildIncidentInterventions(sample)[0]!;
    const recipe = buildSourceRemediationRecipe(sample, intervention);

    expect(recipe.provider).toBe("Mem0");
    expect(recipe.code).toContain("await memory.delete");
    expect(recipe.code).toContain("sample-memory-san-francisco");
    expect(recipe.warning).toMatch(/does not execute/i);
  });

  it("returns a provider-neutral recipe when no adapter identity was captured", () => {
    const sample = createSampleMemoryIncidentCase();
    const recipe = buildSourceRemediationRecipe(sample, buildIncidentInterventions(sample)[0]!);
    expect(recipe.provider).toBe("your memory provider");
    expect(recipe.warning).toMatch(/never mutates/i);
  });
});
