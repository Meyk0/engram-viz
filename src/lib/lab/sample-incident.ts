import type { TurnRecord } from "@/lib/evidence/types";
import type { MemoryTimelineEntry } from "@/lib/timeline";
import type { EngramEvent, EngramMemory } from "@/types";

const OCCURRED_AT = "2026-07-14T18:00:00.000Z";
export const SAMPLE_INCIDENT_TIMELINE_ID = "sample-incident-current-city";

const sanFranciscoMemory: EngramMemory = {
  id: "sample-memory-san-francisco",
  text: "User moved to San Francisco in 2022.",
  importance: 0.88,
  topic: "current location",
  kind: "location",
  entities: ["San Francisco"],
  confidence: 0.9,
  sourceText: "I moved to San Francisco in 2022.",
  status: "active",
  region: "hippocampus",
  created_at: "2026-07-14T17:40:00.000Z",
  last_accessed: OCCURRED_AT,
  access_count: 4
};

const oaklandMemory: EngramMemory = {
  id: "sample-memory-oakland",
  text: "User lives in Oakland now.",
  importance: 0.82,
  topic: "current location",
  kind: "location",
  entities: ["Oakland"],
  confidence: 0.96,
  sourceText: "Actually, I live in Oakland now.",
  status: "active",
  region: "hippocampus",
  created_at: "2026-07-14T17:55:00.000Z",
  access_count: 0
};

const incidentEvents: EngramEvent[] = [
  { type: "init", memories: [sanFranciscoMemory, oaklandMemory] },
  {
    type: "retrieve",
    query: "What city do I live in now?",
    ids: [sanFranciscoMemory.id],
    accessed: [{ ...sanFranciscoMemory }],
    retrieval: {
      provider: "semantic",
      reason: "The older location ranked slightly higher because repeated access outweighed recency.",
      candidateCount: 2,
      eligibleCount: 2,
      selectedCount: 1,
      limit: 1,
      matches: [
        {
          id: sanFranciscoMemory.id,
          rank: 1,
          score: 0.84,
          similarity: 0.9,
          basis: "semantic",
          eligible: true,
          selected: true,
          components: { semantic: 0.9, importance: 0.88, access: 1 }
        },
        {
          id: oaklandMemory.id,
          rank: 2,
          score: 0.82,
          similarity: 0.93,
          basis: "semantic",
          eligible: true,
          selected: false,
          filterReason: "Outside the top-1 retrieval limit.",
          components: { semantic: 0.93, importance: 0.82, access: 0 }
        }
      ]
    }
  },
  { type: "load", ids: [sanFranciscoMemory.id] },
  { type: "fire", ids: [sanFranciscoMemory.id], region: "prefrontal" }
];

export function createSampleMemoryIncident(): {
  entry: MemoryTimelineEntry;
  record: TurnRecord;
} {
  const events = structuredClone(incidentEvents);
  const entry: MemoryTimelineEntry = {
    id: SAMPLE_INCIDENT_TIMELINE_ID,
    kind: "conversation",
    status: "completed",
    userText: "What city do I live in now?",
    assistantText: "You live in San Francisco.",
    events,
    startedAt: OCCURRED_AT,
    completedAt: "2026-07-14T18:00:01.000Z"
  };

  return {
    entry,
    record: {
      version: 1,
      id: "sample-turn-current-city",
      sessionId: "sample-memory-incident",
      startedAt: OCCURRED_AT,
      completedAt: "2026-07-14T18:00:01.000Z",
      userMessage: entry.userText ?? "",
      history: [
        { role: "user", content: "I moved to San Francisco in 2022." },
        { role: "assistant", content: "Thanks, I will remember that." },
        { role: "user", content: "Actually, I live in Oakland now." },
        { role: "assistant", content: "Understood." }
      ],
      retrievedMemories: [{ ...sanFranciscoMemory }],
      retrieval: structuredClone(
        events.find((event): event is Extract<EngramEvent, { type: "retrieve" }> => event.type === "retrieve")
          ?.retrieval
      ),
      events: structuredClone(events),
      originalAnswer: entry.assistantText ?? "",
      provider: { id: "demo" }
    }
  };
}
