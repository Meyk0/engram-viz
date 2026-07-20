import type { MemoryDecisionMemory, MemoryInterventionV2 } from "@engramviz/core";
import { memoryDecisionRunFromIncident } from "@/lib/reliability/from-incident";
import { runDeterministicPolicyReplay } from "@/lib/reliability/policy-replay";
import { createSampleMemoryIncidentCase } from "@/lib/lab/sample-incident";

export function createStaleLocationPolicyReplay() {
  const incident = createSampleMemoryIncidentCase();
  const reconstructed = memoryDecisionRunFromIncident(incident);
  const baseline = {
    ...reconstructed,
    metadata: {
      ...(reconstructed.metadata ?? {}),
      replayExecutor: {
        id: "engram-fixture-location-agent",
        version: "1"
      }
    }
  };
  const intervention: MemoryInterventionV2 = {
    format: "engram.memory-intervention",
    version: 2,
    id: "current-fact-wins",
    targetRunId: baseline.id,
    label: "Prefer the current fact",
    rationale: "Mutually exclusive facts with the same subject should resolve to the newest active correction.",
    operations: [
      {
        id: "enable-current-fact-policy",
        type: "policy_rule",
        rule: "prefer_latest_active_for_subject",
        enabled: true,
        reason: "Resolve conflicting active memories before retrieval ranking."
      },
      {
        id: "exclude-superseded-memories",
        type: "policy_rule",
        rule: "exclude_superseded",
        enabled: true,
        reason: "Superseded memories must not remain eligible for active context."
      }
    ],
    createdAt: incident.occurredAt
  };

  return runDeterministicPolicyReplay(
    {
      baseline,
      intervention,
      answerAssertion: { type: "exact", value: "You live in Oakland." }
    },
    {
      id: "engram-fixture-location-agent",
      version: "1",
      deterministic: true,
      generateAnswer: answerLocationQuestion
    }
  );
}

export function answerLocationQuestion(input: string, memories: MemoryDecisionMemory[]) {
  const location = memories.find((memory) => memory.subject === "current_location")?.value;
  const value = typeof location === "string" ? location : undefined;
  if (!value) return "I do not have a current location in memory.";
  return /where|what city/i.test(input) ? `You live in ${value}.` : `Your current location is ${value}.`;
}
