import { describe, expect, it } from "vitest";
import { answerLocationQuestion, createStaleLocationPolicyReplay } from "@/lib/reliability/stale-location";
import { compileMemoryRegressionV2 } from "@/lib/regressions/v2-compiler";
import { runMemoryRegressionMatrixV2 } from "@/lib/regressions/v2-runner";

const executor = {
  id: "regression-location-agent",
  version: "1",
  deterministic: true as const,
  generateAnswer: answerLocationQuestion
};

describe("memory regression v2 matrix runner", () => {
  it("reruns source, paraphrase, entity, score, and distractor variants", () => {
    const replay = createStaleLocationPolicyReplay();
    const artifact = compileMemoryRegressionV2({
      replay,
      id: "location-robustness",
      title: "Current location remains authoritative",
      variants: [
        {
          id: "paraphrase",
          label: "Paraphrased question",
          perturbations: [{ type: "query_paraphrase", query: "Where is my current home?" }]
        },
        {
          id: "entity-substitution",
          label: "Different cities",
          perturbations: [{
            type: "entity_substitution",
            target: { subject: "current_location", status: "active", valueContains: "Oakland" },
            from: "Oakland",
            to: "Lisbon"
          }]
        },
        {
          id: "near-tie",
          label: "Near score tie",
          perturbations: [{
            type: "score_margin",
            leader: { subject: "current_location", valueContains: "Oakland" },
            challenger: { subject: "current_location", valueContains: "San Francisco" },
            margin: 0.001
          }]
        },
        {
          id: "distractor",
          label: "Unrelated distractor",
          perturbations: [{
            type: "distractors",
            candidates: [{
              memory: {
                id: "distractor-coffee",
                content: "User enjoys light-roast coffee.",
                subject: "coffee_preference",
                value: "light roast",
                status: "active",
                tier: "semantic",
                scope: "user",
                createdAt: replay.source.completedAt,
                evidence: "simulated"
              },
              score: 0.1
            }]
          }]
        }
      ]
    });

    const run = runMemoryRegressionMatrixV2(artifact, executor);

    expect(run.report.pass).toBe(true);
    expect(run.report.summary.variants).toEqual({ total: 5, passed: 5, failed: 0, missing: 0 });
    expect(run.replays[1]?.treatment.input).toBe("Where is my current home?");
    expect(run.replays[2]?.treatment.answer.content).toBe("You live in Lisbon.");
    expect(run.observations[4]?.memories.map((memory) => memory.id)).toContain("distractor-coffee");
  });

  it("surfaces a failing robustness variant instead of hiding it", () => {
    const replay = createStaleLocationPolicyReplay();
    const artifact = compileMemoryRegressionV2({
      replay,
      id: "broken-location-policy",
      title: "Current location failure is visible",
      variants: [{
        id: "high-score-distractor",
        perturbations: [{
          type: "distractors",
          candidates: [{
            memory: {
              id: "wrong-location",
              content: "User lives in Berkeley.",
              subject: "current_location",
              value: "Berkeley",
              status: "active",
              tier: "semantic",
              scope: "user",
              createdAt: "2030-01-01T00:00:00.000Z",
              evidence: "simulated"
            },
            score: 2
          }]
        }]
      }]
    });

    const run = runMemoryRegressionMatrixV2(artifact, executor);

    expect(run.report.pass).toBe(false);
    expect(run.report.variants.find((variant) => variant.id === "high-score-distractor")?.status).toBe("failed");
  });
});
