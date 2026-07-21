import { InMemoryStore } from "@langchain/langgraph";
import {
  captureLangGraphReplayCheckpoint,
  instrumentLangGraphStore
} from "@engramviz/adapter-langgraph";
import { EngramClient } from "@engramviz/sdk";
import { createSupportGraph, seedSupportStore, supportMemories, supportNamespace } from "./workflow.mjs";

const engram = new EngramClient({ adapter: "langgraph-support-agent", strict: true });
const rawStore = new InMemoryStore();
const store = instrumentLangGraphStore(rawStore, engram, {
  storeId: "support-customer-memory",
  selectedIds: (records) => records
    .slice()
    .sort((left, right) => Number(right.value.score) - Number(left.value.score))
    .slice(0, 1)
    .map((record) => String(record.value.engramId))
});

await engram.withTurn({
  input: "The customer's replacement should ship to San Francisco.",
  provider: { id: "support-replacement-agent" }
}, async () => {
  await store.put(supportNamespace, supportMemories[0].key, supportMemories[0]);
  return "Saved the shipping city.";
});

await engram.withTurn({
  input: "Correction: the customer now receives packages in Oakland.",
  provider: { id: "support-replacement-agent" }
}, async (turn) => {
  await store.put(supportNamespace, supportMemories[1].key, supportMemories[1]);
  await turn.supersede([supportMemories[0].engramId], "The customer provided a newer shipping city.");
  return "Saved the corrected shipping city.";
});

const graph = createSupportGraph({ store });
const question = "Where should I send the customer's replacement order?";
const config = { configurable: { thread_id: `support-capture-${crypto.randomUUID()}` } };
const seeded = await graph.updateState(config, {
  question,
  excludeSuperseded: false,
  forcedMemoryId: "",
  candidates: [],
  selectedIds: [],
  loadedIds: [],
  answer: ""
}, "entry");

const answer = await engram.withTurn({
  input: question,
  provider: {
    id: "support-replacement-agent",
    model: process.env.OPENAI_API_KEY ? process.env.OPENAI_MODEL : "offline-deterministic"
  }
}, async (turn) => {
  await captureLangGraphReplayCheckpoint(graph, seeded, { asNode: "entry", turn });
  const result = await graph.invoke(null, seeded);
  return result.answer;
});

console.log(`Agent answer: ${answer}`);
console.log("Expected behavior: the current Oakland memory should determine the replacement destination.");
