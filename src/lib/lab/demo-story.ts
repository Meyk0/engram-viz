import { buildIncidentInterventions } from "@/lib/incidents/interventions";
import type { MemoryIncident, MemoryIncidentIntervention } from "@/lib/incidents/types";
import {
  applyMemoryBranch,
  branchContextMemories,
  createMemoryBranch
} from "@/lib/lab/branches";
import { createSampleMemoryIncidentCase } from "@/lib/lab/sample-incident";
import type { MemoryBranch } from "@/lib/lab/types";
import type { BrainRegion, EngramEvent, EngramMemory } from "@/types";

export const PUBLIC_DEMO_STEP_NAMES = ["Store", "Correct", "Fail", "Repair", "Test"] as const;
export const PUBLIC_DEMO_PHASE_NAMES = ["Capture", "Diagnose", "Diagnose", "Replay", "Test"] as const;

export type PublicDemoStepName = (typeof PUBLIC_DEMO_STEP_NAMES)[number];

export type PublicDemoFrame = Readonly<{
  name: PublicDemoStepName;
  eyebrow: string;
  title: string;
  description: string;
  provenance: string;
  evidence: string;
  regionLabel: string;
  memories: EngramMemory[];
  events: EngramEvent[];
  loadedMemoryIds: string[];
  retrievedMemoryIds: string[];
  focusedMemoryIds: string[];
  focusedRegions: BrainRegion[];
}>;

export type PublicDemoStory = Readonly<{
  incident: MemoryIncident;
  intervention: MemoryIncidentIntervention;
  branch: MemoryBranch;
  branchContextMemories: EngramMemory[];
  frames: readonly PublicDemoFrame[];
}>;

export function createPublicDemoStory(): PublicDemoStory {
  const incident = createSampleMemoryIncidentCase();
  const intervention = buildIncidentInterventions(incident).find((candidate) => candidate.recommended);
  if (!intervention) throw new Error("The stale-location fixture has no recommended repair.");

  const branch = createMemoryBranch({
    checkpoint: incident.checkpoint,
    id: `branch-${incident.id}-${intervention.id}`,
    title: intervention.label,
    createdAt: incident.occurredAt,
    mutations: intervention.mutations
  });
  const materialized = applyMemoryBranch(incident.checkpoint, branch);
  const repairedContext = branchContextMemories(incident.record, branch, materialized);
  const staleMemory = incident.record.retrievedMemories[0];
  const currentMemory = repairedContext[0];

  if (!staleMemory || !currentMemory) {
    throw new Error("The stale-location fixture is missing its baseline or corrected memory.");
  }

  const recordedMemories = incident.memories.map(cloneMemory);
  const repairedMemories = materialized.memories.map(cloneMemory);
  const originalEvents = incident.record.events.map(cloneEvent);
  const storeDecision = {
    stage: "memory" as const,
    operation: "store" as const,
    provider: "deterministic" as const,
    confidence: 1,
    reason: "Recorded by the deterministic stale-location fixture."
  };

  const frames: PublicDemoFrame[] = [
    {
      name: "Store",
      eyebrow: "Durable memory",
      title: "Store the original location",
      description: "The agent records San Francisco as a durable fact.",
      provenance: "Recorded fixture event",
      evidence: staleMemory.sourceText ?? staleMemory.text,
      regionLabel: "Hippocampus / durable-store analogy",
      memories: [cloneMemory(staleMemory)],
      events: [
        { type: "init", memories: [cloneMemory(staleMemory)] },
        { type: "store", memory: cloneMemory(staleMemory), decision: storeDecision }
      ],
      loadedMemoryIds: [],
      retrievedMemoryIds: [],
      focusedMemoryIds: [staleMemory.id],
      focusedRegions: ["hippocampus"]
    },
    {
      name: "Correct",
      eyebrow: "New evidence",
      title: "Record the correction, but keep stale state",
      description: "Oakland is stored, but the older San Francisco memory incorrectly remains active.",
      provenance: "Recorded fixture history",
      evidence: currentMemory.sourceText ?? currentMemory.text,
      regionLabel: "Hippocampus / update analogy",
      memories: recordedMemories.map(cloneMemory),
      events: [
        { type: "init", memories: recordedMemories.map(cloneMemory) },
        { type: "store", memory: cloneMemory(currentMemory), decision: storeDecision }
      ],
      loadedMemoryIds: [],
      retrievedMemoryIds: [],
      focusedMemoryIds: [currentMemory.id],
      focusedRegions: ["hippocampus"]
    },
    {
      name: "Fail",
      eyebrow: "Recorded incident",
      title: "The stale location wins retrieval",
      description: "Top-1 retrieval selects the stale fact, so the answer says San Francisco.",
      provenance: "Observed turn evidence",
      evidence: incident.observedAnswer,
      regionLabel: "Prefrontal / active-context analogy",
      memories: recordedMemories.map(cloneMemory),
      events: originalEvents,
      loadedMemoryIds: [staleMemory.id],
      retrievedMemoryIds: [staleMemory.id],
      focusedMemoryIds: [staleMemory.id],
      focusedRegions: ["hippocampus", "prefrontal"]
    },
    {
      name: "Repair",
      eyebrow: "Isolated branch",
      title: "Prefer the current fact",
      description: "An isolated branch supersedes the stale fact without changing the recorded incident.",
      provenance: "Derived branch intervention",
      evidence: intervention.reason,
      regionLabel: "Hippocampus to active-context analogy",
      memories: repairedMemories.map(cloneMemory),
      events: [
        { type: "init", memories: repairedMemories.map(cloneMemory) },
        { type: "load", ids: [currentMemory.id] },
        { type: "fire", ids: [currentMemory.id], region: "prefrontal" }
      ],
      loadedMemoryIds: [currentMemory.id],
      retrievedMemoryIds: [currentMemory.id],
      focusedMemoryIds: [currentMemory.id],
      focusedRegions: ["hippocampus", "prefrontal"]
    },
    {
      name: "Test",
      eyebrow: "Deterministic regression",
      title: "Freeze the repaired behavior",
      description: "The same question now loads Oakland and becomes a portable regression.",
      provenance: "Fixture replay evidence",
      evidence: `Expected answer contains "${incident.expectedAnswer ?? "Oakland"}".`,
      regionLabel: "Prefrontal / active-context analogy",
      memories: repairedMemories.map(cloneMemory),
      events: [
        { type: "init", memories: repairedMemories.map(cloneMemory) },
        {
          type: "retrieve",
          query: incident.question,
          ids: [currentMemory.id],
          accessed: [cloneMemory(currentMemory)],
          retrieval: {
            provider: "semantic",
            reason: "The controlled branch context contains the current location fact.",
            candidateCount: 1,
            eligibleCount: 1,
            selectedCount: 1,
            limit: 1,
            matches: [{
              id: currentMemory.id,
              rank: 1,
              score: 1,
              similarity: 1,
              basis: "guardrail",
              eligible: true,
              selected: true,
              components: { guardrail: 1 }
            }]
          }
        },
        { type: "load", ids: [currentMemory.id] },
        { type: "fire", ids: [currentMemory.id], region: "prefrontal" }
      ],
      loadedMemoryIds: [currentMemory.id],
      retrievedMemoryIds: [currentMemory.id],
      focusedMemoryIds: [currentMemory.id],
      focusedRegions: ["prefrontal"]
    }
  ];

  return { incident, intervention, branch, branchContextMemories: repairedContext, frames };
}

function cloneMemory(memory: EngramMemory): EngramMemory {
  return structuredClone(memory);
}

function cloneEvent(event: EngramEvent): EngramEvent {
  return structuredClone(event);
}
