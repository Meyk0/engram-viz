import { createChatProvider, configuredChatProvider } from "@/lib/chat/providers";
import { MemoryEngine } from "@/lib/memory/engine";
import { evaluateMemoryCandidate } from "@/lib/memory/rules";
import { InMemoryMemoryStore } from "@/lib/memory/store-interface";
import type { ChatMessage, EngramEvent, StreamChunk } from "@/types";

const memoryStore = new InMemoryMemoryStore();
const memoryEngine = new MemoryEngine(memoryStore);

export type LiveChatInput = {
  sessionId: string;
  message: string;
  history?: ChatMessage[];
  now?: string;
};

export async function createLiveMemoryStream(input: LiveChatInput): Promise<StreamChunk[]> {
  const history = input.history ?? [];
  const chunks: StreamChunk[] = [];

  chunks.push({ kind: "event", event: await memoryEngine.initialize(input.sessionId) });

  const retrieve = await memoryEngine.retrieve({
    sessionId: input.sessionId,
    query: input.message,
    limit: 3,
    now: input.now
  });
  chunks.push({ kind: "event", event: retrieve });

  const retrievedIds = retrieve.type === "retrieve" ? retrieve.ids : [];
  if (retrievedIds.length > 0) {
    chunks.push({ kind: "event", event: memoryEngine.fire("prefrontal", retrievedIds) });
  }

  const retrievedMemories = (await memoryStore.list(input.sessionId)).filter((memory) =>
    retrievedIds.includes(memory.id)
  );

  const provider = createChatProvider(configuredChatProvider());
  for await (const chunk of provider.streamTurn({
    message: input.message,
    history,
    retrievedMemories
  })) {
    if (chunk.kind === "done") continue;
    chunks.push(chunk);
  }

  const candidate = evaluateMemoryCandidate(input.message);
  if (candidate.shouldStore) {
    const stored = await memoryEngine.storeMemory({
      sessionId: input.sessionId,
      text: candidate.text,
      importance: candidate.importance,
      topic: candidate.topic,
      now: input.now
    });
    chunks.push({ kind: "event", event: stored });

    const storedRegion = stored.type === "store" ? stored.memory.region : "hippocampus";
    chunks.push({
      kind: "event",
      event: memoryEngine.fire(storedRegion, stored.type === "store" ? [stored.memory.id] : [])
    });
  }

  const decay = await memoryEngine.decay(input.sessionId);
  if (decay) {
    chunks.push({ kind: "event", event: decay });
  }

  if (chunks.at(-1)?.kind !== "done") {
    chunks.push({ kind: "done" });
  }

  return chunks;
}

export function resetLiveMemoryStore() {
  memoryStore.clear();
}
