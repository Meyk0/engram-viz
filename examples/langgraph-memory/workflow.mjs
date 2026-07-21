import { Annotation, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { getActiveEngramTurn } from "@engramviz/sdk";
import { langGraphMemoryId } from "@engramviz/adapter-langgraph";

export const namespace = ["users", "demo-user", "memories"];
export const memories = [
  {
    key: "city-san-francisco",
    data: "User lives in San Francisco.",
    subject: "current_city",
    status: "superseded",
    score: 0.97
  },
  {
    key: "city-oakland",
    data: "User lives in Oakland.",
    subject: "current_city",
    status: "active",
    score: 0.91
  }
];

export function createLocationGraph({ store, onNode = () => undefined }) {
  const State = Annotation.Root({
    question: Annotation(),
    excludeSuperseded: Annotation(),
    forcedMemoryId: Annotation(),
    candidates: Annotation(),
    selectedIds: Annotation(),
    loadedIds: Annotation(),
    answer: Annotation()
  });

  return new StateGraph(State)
    .addNode("entry", (state) => state)
    .addNode("retrieve", async (state, runtime) => {
      onNode("retrieve");
      if (!runtime.store) throw new Error("The location graph requires a LangGraph Store.");
      const results = await runtime.store.search(namespace, { limit: 10 });
      const candidates = results
        .map((item) => ({
          id: langGraphMemoryId(item.namespace, item.key),
          key: item.key,
          text: String(item.value.data),
          status: String(item.value.status),
          score: Number(item.value.score)
        }))
        .filter((memory) => !state.excludeSuperseded || memory.status !== "superseded")
        .sort((left, right) => right.score - left.score);
      const forced = state.forcedMemoryId
        ? candidates.find((memory) => memory.id === state.forcedMemoryId)
        : undefined;
      const selectedIds = forced ? [forced.id] : candidates[0] ? [candidates[0].id] : [];
      await getActiveEngramTurn()?.load(selectedIds, {
        level: "observed",
        adapter: "langgraph-example",
        sourcePath: "location graph prompt construction",
        note: "Only the selected Store result was copied into active context."
      });
      return { candidates, selectedIds, loadedIds: selectedIds };
    })
    .addNode("generate", (state) => {
      onNode("generate");
      const selected = state.candidates.find((memory) => memory.id === state.selectedIds[0]);
      return { answer: selected ? selected.text : "I do not know where you live." };
    })
    .addEdge(START, "entry")
    .addEdge("entry", "retrieve")
    .addEdge("retrieve", "generate")
    .addEdge("generate", END)
    .compile({ store, checkpointer: new MemorySaver() });
}

export async function seedLocationStore(store) {
  for (const memory of memories) {
    await store.put(namespace, memory.key, memory);
  }
}
