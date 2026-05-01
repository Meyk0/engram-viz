import { createChatProvider, configuredChatProvider } from "@/lib/chat/providers";
import { MemoryEngine } from "@/lib/memory/engine";
import { findConsolidationCandidate } from "@/lib/memory/consolidationPolicy";
import type { MemoryDecisionPlanner } from "@/lib/memory/decision";
import { configuredMemoryDecisionPlanner } from "@/lib/memory/planner-config";
import { InMemoryMemoryStore } from "@/lib/memory/store-interface";
import type { ChatMessage, StreamChunk } from "@/types";

const memoryStore = new InMemoryMemoryStore();
const memoryEngine = new MemoryEngine(memoryStore);

export type LiveChatInput = {
  sessionId: string;
  message: string;
  history?: ChatMessage[];
  memoryDecisionPlanner?: MemoryDecisionPlanner;
  now?: string;
};

export async function createLiveMemoryStream(input: LiveChatInput): Promise<StreamChunk[]> {
  const history = input.history ?? [];
  const memoryDecisionPlanner = input.memoryDecisionPlanner ?? configuredMemoryDecisionPlanner();
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
    chunks.push({ kind: "event", event: { type: "load", ids: retrievedIds } });
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

  const memoryDecision = memoryDecisionPlanner.decide({
    message: input.message,
    relatedMemoryIds: retrievedIds,
    relatedMemories: retrievedMemories
  });

  const resolvedMemoryDecision = await memoryDecision;

  if (resolvedMemoryDecision.operation === "store") {
    const stored = await memoryEngine.storeMemory({
      sessionId: input.sessionId,
      text: resolvedMemoryDecision.memoryText,
      importance: resolvedMemoryDecision.importance,
      topic: resolvedMemoryDecision.topic,
      now: input.now
    });
    chunks.push({ kind: "event", event: stored });

    const storedRegion = stored.type === "store" ? stored.memory.region : "hippocampus";
    chunks.push({
      kind: "event",
      event: memoryEngine.fire(storedRegion, stored.type === "store" ? [stored.memory.id] : [])
    });

    const consolidationCandidate = findConsolidationCandidate(await memoryStore.list(input.sessionId));
    if (consolidationCandidate) {
      const consolidated = await memoryEngine.consolidate({
        sessionId: input.sessionId,
        ids: consolidationCandidate.ids,
        consolidatedText: consolidationCandidate.consolidatedText,
        now: input.now
      });

      if (consolidated?.type === "consolidate") {
        chunks.push({ kind: "event", event: consolidated });
        chunks.push({
          kind: "event",
          event: memoryEngine.fire(consolidated.added.region, [consolidated.added.id])
        });
      }
    }
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
