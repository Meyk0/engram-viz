import { EngramClient } from "@engramviz/sdk";
import { instrumentMem0, mem0MemoryIds } from "@engramviz/adapter-mem0";

class StaleLocationFixture {
  async add(messages) {
    const text = messages.at(-1)?.content ?? "";
    if (text.includes("Oakland")) {
      return { results: [{
        id: "memory-oakland",
        memory: "User lives in Oakland now.",
        event: "ADD",
        created_at: "2026-07-14T10:10:00.000Z",
        metadata: { topic: "current_location" }
      }] };
    }
    return { results: [{
      id: "memory-san-francisco",
      memory: "User moved to San Francisco.",
      event: "ADD",
      created_at: "2026-07-14T10:00:00.000Z",
      metadata: { topic: "current_location" }
    }] };
  }

  async search() {
    return { results: [
      { id: "memory-san-francisco", memory: "User moved to San Francisco.", score: 0.91 },
      { id: "memory-oakland", memory: "User lives in Oakland now.", score: 0.88 }
    ] };
  }
}

const engram = new EngramClient({ adapter: "mem0" });
const rawMem0 = new StaleLocationFixture();
const mem0 = instrumentMem0(rawMem0, engram, {
  selectedIds: (records) => [records[0].id]
});

await engram.withTurn({ input: "I moved to San Francisco.", provider: { id: "fixture-agent" } }, async () => {
  await mem0.add([{ role: "user", content: "I moved to San Francisco." }]);
  return "I will remember that.";
});

await engram.withTurn({ input: "Actually, I live in Oakland now.", provider: { id: "fixture-agent" } }, async () => {
  await mem0.add([{ role: "user", content: "Actually, I live in Oakland now." }]);
  return "I will remember the correction.";
});

await engram.withTurn({ input: "What city do I live in now?", provider: { id: "fixture-agent" } }, async (turn) => {
  const result = await mem0.search("What city do I live in now?");
  const selectedIds = mem0MemoryIds(result).slice(0, 1);
  await turn.load(selectedIds);
  return "You live in San Francisco.";
});

console.log("Captured the stale-location incident. Open Engram Studio → Incidents.");
