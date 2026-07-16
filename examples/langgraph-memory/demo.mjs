import { Annotation, END, InMemoryStore, START, StateGraph } from "@langchain/langgraph";
import {
  instrumentLangGraphStore,
  langGraphMemoryIds
} from "@engramviz/adapter-langgraph";
import { EngramClient, getActiveEngramTurn } from "@engramviz/sdk";

const engram = new EngramClient({ adapter: "langgraph" });
const store = instrumentLangGraphStore(new InMemoryStore(), engram, {
  storeId: "langgraph-demo"
});
const namespace = ["users", "demo-user", "memories"];

const State = Annotation.Root({
  input: Annotation(),
  output: Annotation()
});

const graph = new StateGraph(State)
  .addNode("memory", async (state, runtime) => {
    if (state.input.toLowerCase().includes("live in")) {
      await runtime.store.put(namespace, "current-city", {
        data: "User lives in Oakland."
      });
      return { output: "I will remember that you live in Oakland." };
    }

    const memories = await runtime.store.search(namespace, { limit: 3 });
    await getActiveEngramTurn()?.load(langGraphMemoryIds(memories), {
      level: "observed",
      adapter: "langgraph-example",
      sourcePath: "memory node prompt construction",
      note: "Only these Store results were copied into model context."
    });
    const city = memories[0]?.value.data ?? "No location memory found.";
    return { output: String(city) };
  })
  .addEdge(START, "memory")
  .addEdge("memory", END)
  .compile({ store });

for (const input of ["I live in Oakland.", "Where do I live?"]) {
  const output = await engram.withTurn({
    input,
    provider: { id: "langgraph", model: "deterministic-example" }
  }, async () => {
    const result = await graph.invoke({ input, output: "" });
    return result.output;
  });
  console.log(`${input} -> ${output}`);
}
