import type {
  MemoryIncident,
  MemoryIncidentIntervention
} from "@/lib/incidents/types";
import type { EngramMemory } from "@/types";

export function buildIncidentInterventions(
  incident: MemoryIncident
): MemoryIncidentIntervention[] {
  const memoryById = new Map(incident.memories.map((memory) => [memory.id, memory]));
  const selectedIds = new Set(incident.record.retrievedMemories.map((memory) => memory.id));
  const interventions: MemoryIncidentIntervention[] = [];

  if (incident.diagnosis.kind === "update" && incident.diagnosis.memoryIds.length >= 2) {
    const [staleId, currentId] = incident.diagnosis.memoryIds;
    const stale = staleId ? memoryById.get(staleId) : undefined;
    const current = currentId ? memoryById.get(currentId) : undefined;
    if (stale && current) interventions.push(supersedeIntervention(incident, stale, current));
  }

  const expectedMemory = findExpectedMemory(incident);
  if (
    expectedMemory
    && !selectedIds.has(expectedMemory.id)
    && !interventions.some((intervention) => intervention.affectedMemoryIds.includes(expectedMemory.id))
  ) {
    interventions.push({
      id: `${incident.id}-include-${expectedMemory.id}`,
      label: `Include “${shortText(expectedMemory.text)}”`,
      description: "Load the ignored memory into the replay context without changing the recorded incident.",
      reason: "The expected fact existed before the turn but did not reach the model.",
      recommended: incident.diagnosis.kind === "retrieval" || incident.diagnosis.kind === "ranking" || incident.diagnosis.kind === "context",
      affectedMemoryIds: [expectedMemory.id],
      focusedRegions: [expectedMemory.region, "prefrontal"],
      mutations: [{
        id: `${incident.id}-mutation-include-${expectedMemory.id}`,
        type: "include",
        memoryId: expectedMemory.id,
        reason: "Incident replay: include the expected memory"
      }]
    });
  }

  for (const memory of incident.record.retrievedMemories) {
    if (interventions.some((intervention) => intervention.affectedMemoryIds.includes(memory.id))) continue;
    interventions.push({
      id: `${incident.id}-exclude-${memory.id}`,
      label: `Test without “${shortText(memory.text)}”`,
      description: "Remove this memory from a controlled replay to test whether the answer depends on it.",
      reason: "A retrieved memory can be excluded without mutating the recorded state.",
      recommended: false,
      affectedMemoryIds: [memory.id],
      focusedRegions: [memory.region, "prefrontal"],
      mutations: [{
        id: `${incident.id}-mutation-quarantine-${memory.id}`,
        type: "quarantine",
        memoryId: memory.id,
        reason: "Incident replay: exclude a retrieved memory"
      }]
    });
  }

  return interventions.sort((left, right) => Number(right.recommended) - Number(left.recommended));
}

function supersedeIntervention(
  incident: MemoryIncident,
  stale: EngramMemory,
  current: EngramMemory
): MemoryIncidentIntervention {
  return {
    id: `${incident.id}-supersede-${stale.id}`,
    label: "Prefer the current fact",
    description: `Mark “${shortText(stale.text)}” as superseded and load “${shortText(current.text)}” instead.`,
    reason: "The newer memory corrects the same subject and should be eligible for the current answer.",
    recommended: true,
    affectedMemoryIds: [stale.id, current.id],
    focusedRegions: [...new Set([stale.region, current.region, "prefrontal" as const])],
    mutations: [{
      id: `${incident.id}-mutation-supersede-${stale.id}`,
      type: "supersede",
      memoryId: stale.id,
      supersededByMemoryId: current.id,
      reason: "Incident replay: apply the newer correction"
    }]
  };
}

function findExpectedMemory(incident: MemoryIncident): EngramMemory | undefined {
  if (!incident.expectedAnswer) return undefined;
  const expected = normalize(incident.expectedAnswer);
  return incident.memories.find((memory) => normalize(memory.text).includes(expected));
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function shortText(value: string) {
  const normalized = value.trim();
  return normalized.length > 58 ? `${normalized.slice(0, 55)}...` : normalized;
}
