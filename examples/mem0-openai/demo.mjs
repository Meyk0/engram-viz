import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { instrumentMem0, mem0MemoryRecords } from "@engramviz/adapter-mem0";
import { EngramClient } from "@engramviz/sdk";
import { Memory } from "mem0ai/oss";
import OpenAI from "openai";

const openaiApiKey = required("OPENAI_API_KEY");
const openaiModel = required("OPENAI_MODEL");
const userId = process.env.MEM0_USER_ID ?? "engram-real-example";
const directory = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(directory, ".mem0");
await mkdir(dataDirectory, { recursive: true });

const engram = new EngramClient({
  adapter: "mem0-oss",
  strict: true,
  onError: (error) => console.error("Engram capture error", error)
});
const rawMem0 = new Memory({
  embedder: {
    provider: "openai",
    config: { apiKey: openaiApiKey, model: "text-embedding-3-small" }
  },
  vectorStore: {
    provider: "memory",
    config: { collectionName: `engram-${userId}`, dimension: 1536 }
  },
  llm: {
    provider: "openai",
    config: { apiKey: openaiApiKey, model: process.env.MEM0_LLM_MODEL ?? openaiModel }
  },
  historyDbPath: path.join(dataDirectory, "history.db")
});
const mem0 = instrumentMem0(rawMem0, engram, {
  storeId: userId,
  selectedIds: (records) => records.slice(0, 3).map((record) => record.id),
  onInstrumentationGap: (gap) => console.warn("Mem0 instrumentation gap", gap.reason)
});
const openai = new OpenAI({ apiKey: openaiApiKey });

await remember("I moved to San Francisco a couple of years ago.");
await remember("Actually, I live in Oakland now.");

const question = "What city do I live in now?";
const answer = await engram.withTurn({
  input: question,
  provider: { id: "openai", model: openaiModel },
  metadata: { example: "mem0-openai", userId }
}, async (turn) => {
  const search = await mem0.search(question, { filters: { user_id: userId }, topK: 5 });
  const selected = mem0MemoryRecords(search).slice(0, 3);
  await turn.load(selected.map((memory) => memory.id), {
    level: "observed",
    adapter: "example-prompt-builder",
    sourcePath: "memoryContext"
  });
  const memoryContext = selected.length > 0
    ? selected.map((memory) => `- ${memory.memory ?? memory.id}`).join("\n")
    : "- No matching memory was loaded.";
  const response = await openai.responses.create({
    model: openaiModel,
    store: false,
    instructions: "Answer only from the supplied memory context. Say when the context is insufficient.",
    input: `Memory context:\n${memoryContext}\n\nUser question: ${question}`
  });
  return response.output_text;
});

console.log(`Agent answer: ${answer}`);
console.log("Open http://localhost:3100/?mode=incidents and select the recorded question.");

async function remember(content) {
  return engram.withTurn({
    input: content,
    provider: { id: "mem0", model: process.env.MEM0_LLM_MODEL ?? openaiModel },
    metadata: { example: "mem0-openai", userId }
  }, async () => {
    await mem0.add([{ role: "user", content }], {
      userId,
      metadata: { source: "engram-real-example" }
    });
    return "Memory processing completed.";
  });
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
