export default async function run({ memories, input }) {
  const active = memories.filter((memory) => memory.status !== "superseded");
  const queryTerms = new Set(input.userMessage.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const ranked = active
    .map((memory) => ({
      memory,
      score: (memory.text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
        .filter((term) => queryTerms.has(term)).length
    }))
    .sort((left, right) => right.score - left.score);
  const selected = ranked.at(0)?.memory;

  return {
    answer: selected ? `Current memory: ${selected.text}` : "No current location memory found.",
    retrievedMemoryIds: selected ? [selected.id] : [],
    loadedMemoryIds: selected ? [selected.id] : []
  };
}
