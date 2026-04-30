import type { EngramMemory } from "@/types";

export type ConsolidationCandidate = {
  ids: string[];
  consolidatedText: string;
};

const MIN_TOPIC_MEMORIES = 2;

export function findConsolidationCandidate(memories: EngramMemory[]): ConsolidationCandidate | null {
  const byTopic = new Map<string, EngramMemory[]>();

  memories.forEach((memory) => {
    if (memory.region !== "hippocampus" || !memory.topic) return;
    byTopic.set(memory.topic, [...(byTopic.get(memory.topic) ?? []), memory]);
  });

  const group = [...byTopic.values()]
    .filter((memoriesForTopic) => memoriesForTopic.length >= MIN_TOPIC_MEMORIES)
    .sort((a, b) => b.length - a.length || newestTime(b) - newestTime(a))[0];

  if (!group) return null;

  const selected = group
    .slice()
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .slice(0, 3);
  const topic = selected[0]?.topic ?? "memory";

  return {
    ids: selected.map((memory) => memory.id),
    consolidatedText: summarizeTopic(topic, selected)
  };
}

function summarizeTopic(topic: string, memories: EngramMemory[]) {
  const facts = memories.map((memory) => stripExplicitMemoryCue(memory.text));
  const uniqueFacts = [...new Set(facts)];
  return `User has recurring ${topic} memories: ${uniqueFacts.join("; ")}`;
}

function stripExplicitMemoryCue(text: string) {
  return text
    .replace(/^(remember that|note that|keep in mind that|don't forget that|do not forget that)\s+/i, "")
    .trim();
}

function newestTime(memories: EngramMemory[]) {
  return Math.max(...memories.map((memory) => Date.parse(memory.created_at) || 0));
}
