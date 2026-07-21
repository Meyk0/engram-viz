import { InMemoryStore } from "@langchain/langgraph";
import {
  captureLangGraphReplayCheckpoint,
  instrumentLangGraphStore,
  langGraphMemoryId,
  langGraphReplayMetadata
} from "@engramviz/adapter-langgraph";
import { EngramClient } from "@engramviz/sdk";
import { createLocationGraph, memories, namespace } from "./workflow.mjs";

const engram = new EngramClient({ adapter: "langgraph" });
const rawStore = new InMemoryStore();
const store = instrumentLangGraphStore(rawStore, engram, {
  storeId: "langgraph-location-demo",
  selectedIds: (records) => [...records]
    .sort((left, right) => Number(right.value.score) - Number(left.value.score))
    .slice(0, 1)
    .map((record) => langGraphMemoryId(record.namespace, record.key))
});

await engram.withTurn({
  input: "I moved to San Francisco.",
  provider: { id: "langgraph-location-agent", model: "1.0.0" }
}, async () => {
  await store.put(namespace, memories[0].key, memories[0]);
  return "I will remember San Francisco.";
});

await engram.withTurn({
  input: "Actually, I live in Oakland now.",
  provider: { id: "langgraph-location-agent", model: "1.0.0" }
}, async (turn) => {
  await store.put(namespace, memories[1].key, memories[1]);
  await turn.supersede(
    [langGraphMemoryId(namespace, memories[0].key)],
    "The user corrected their current city."
  );
  return "I will remember the correction.";
});

const graph = createLocationGraph({ store });
const config = { configurable: { thread_id: "captured-stale-location" } };
const seeded = await graph.updateState(config, {
  question: "What city do I live in now?",
  excludeSuperseded: false,
  forcedMemoryId: "",
  candidates: [],
  selectedIds: [],
  loadedIds: [],
  answer: ""
}, "entry");
const checkpoint = await captureLangGraphReplayCheckpoint(graph, seeded, { asNode: "entry" });

const output = await engram.withTurn({
  input: "What city do I live in now?",
  provider: { id: "langgraph-location-agent", model: "1.0.0" },
  metadata: langGraphReplayMetadata(checkpoint)
}, async () => {
  const result = await graph.invoke(null, seeded);
  return result.answer;
});

console.log(`Captured bad answer: ${output}`);
console.log("Open Engram Studio -> Incidents, expect Oakland, then run the real agent replay.");
