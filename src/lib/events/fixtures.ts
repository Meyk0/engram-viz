import type { EngramEvent, EngramMemory, StreamChunk } from "@/types";

const baseTime = "2026-04-29T17:00:00.000Z";

export const fixtureMemories: EngramMemory[] = [
  {
    id: "mem-user-designer",
    text: "User is a designer exploring AI memory interfaces",
    importance: 0.82,
    topic: "user-profile",
    region: "hippocampus",
    created_at: baseTime,
    access_count: 0,
    x: -0.25,
    y: -0.1,
    z: 0.18
  },
  {
    id: "mem-engram-goal",
    text: "Engram should teach LLM memory through a glowing brain",
    importance: 0.9,
    topic: "project-goal",
    region: "temporal",
    created_at: baseTime,
    access_count: 3,
    x: 0.42,
    y: 0.05,
    z: -0.2
  }
];

export const fixtureEvents: EngramEvent[] = [
  { type: "init", memories: fixtureMemories },
  { type: "store", memory: fixtureMemories[0] },
  { type: "retrieve", query: "what should engram remember about this user?", ids: ["mem-user-designer"] },
  { type: "fire", region: "prefrontal", ids: ["mem-user-designer"] },
  {
    type: "consolidate",
    removed: ["mem-user-designer"],
    added: {
      id: "mem-user-product-context",
      text: "User cares about visual clarity and credible AI memory metaphors",
      importance: 0.88,
      topic: "product-direction",
      region: "temporal",
      created_at: "2026-04-29T17:01:00.000Z",
      access_count: 1,
      x: 0.62,
      y: 0.04,
      z: -0.28
    }
  },
  { type: "decay", ids: ["mem-user-designer"] }
];

export const fixtureStream: StreamChunk[] = [
  { kind: "event", event: fixtureEvents[0] },
  { kind: "text", delta: "I can remember that you care about credible, visual explanations of AI memory. " },
  { kind: "event", event: fixtureEvents[1] },
  { kind: "event", event: fixtureEvents[2] },
  { kind: "text", delta: "I will use those memories to make the brain light up as the conversation evolves." },
  { kind: "event", event: fixtureEvents[3] },
  { kind: "event", event: fixtureEvents[4] },
  { kind: "event", event: fixtureEvents[5] },
  { kind: "done" }
];
