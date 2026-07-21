import { Annotation, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { getActiveEngramTurn } from "@engramviz/sdk";

export const supportNamespace = ["customers", "synthetic-user", "shipping"];
export const supportMemories = [
  {
    key: "address-old",
    engramId: "langgraph:customers/synthetic-user/shipping/address-old",
    data: "The customer's shipping city is San Francisco.",
    subject: "shipping_city",
    value: "San Francisco",
    status: "superseded",
    score: 0.97
  },
  {
    key: "address-current",
    engramId: "langgraph:customers/synthetic-user/shipping/address-current",
    data: "The customer's current shipping city is Oakland.",
    subject: "shipping_city",
    value: "Oakland",
    status: "active",
    score: 0.91
  }
];

export function createSupportGraph({ store, generate = generateSupportAnswer }) {
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
      if (!runtime.store) throw new Error("The support graph requires a LangGraph Store.");
      const records = await runtime.store.search(supportNamespace, { limit: 10 });
      const candidates = records
        .map((item) => ({
          id: String(item.value.engramId),
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
        adapter: "langgraph-support-example",
        sourcePath: "supportGraph.retrieve -> prompt context"
      });
      return { candidates, selectedIds, loadedIds: selectedIds };
    })
    .addNode("generate", async (state) => {
      const memory = state.candidates.find((candidate) => candidate.id === state.selectedIds[0]);
      return { answer: await generate(state.question, memory?.text) };
    })
    .addEdge(START, "entry")
    .addEdge("entry", "retrieve")
    .addEdge("retrieve", "generate")
    .addEdge("generate", END)
    .compile({ store, checkpointer: new MemorySaver() });
}

export async function seedSupportStore(store, memories = supportMemories) {
  for (const memory of memories) await store.put(supportNamespace, memory.key, memory);
}

export async function generateSupportAnswer(question, memory) {
  if (!memory) return "I cannot confirm a shipping city from memory.";
  if (process.env.ENGRAM_EXAMPLE_OFFLINE === "true" || !process.env.OPENAI_API_KEY) {
    return memory.includes("Oakland")
      ? "Send the replacement to the customer's current address in Oakland."
      : "Send the replacement to the address in San Francisco.";
  }
  const model = process.env.OPENAI_MODEL;
  if (!model) throw new Error("OPENAI_MODEL is required when OPENAI_API_KEY is set.");
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model,
    store: false,
    instructions: "You are a support agent. Answer only from the supplied customer memory. Be concise.",
    input: `Customer memory:\n${memory}\n\nSupport question: ${question}`
  });
  return response.output_text;
}
