import { createChatProvider, configuredChatProvider } from "@/lib/chat/providers";
import { MemoryEngine } from "@/lib/memory/engine";
import type { MemoryConsolidationPlanner } from "@/lib/memory/consolidationPolicy";
import type { ConsolidationDecision } from "@/lib/memory/consolidationPolicy";
import type { MemoryDecisionPlanner } from "@/lib/memory/decision";
import type { MemoryDecision } from "@/lib/memory/decision";
import {
  configuredMemoryConsolidationPlanner,
  configuredMemoryDecisionPlanner
} from "@/lib/memory/planner-config";
import { configuredMemoryRetriever } from "@/lib/memory/retriever-config";
import type { MemoryRetriever } from "@/lib/memory/retrieve";
import { InMemoryMemoryStore } from "@/lib/memory/store-interface";
import type { ChatMessage, MemoryDecisionTrace, StreamChunk } from "@/types";

const memoryStore = new InMemoryMemoryStore();
const memoryEngine = new MemoryEngine(memoryStore);

export type LiveChatInput = {
  sessionId: string;
  message: string;
  history?: ChatMessage[];
  memoryConsolidationPlanner?: MemoryConsolidationPlanner;
  memoryDecisionPlanner?: MemoryDecisionPlanner;
  memoryRetriever?: MemoryRetriever;
  now?: string;
};

export async function createLiveMemoryStream(input: LiveChatInput): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];

  for await (const chunk of streamLiveMemoryChunks(input)) {
    chunks.push(chunk);
  }

  return chunks;
}

export async function* streamLiveMemoryChunks(input: LiveChatInput): AsyncIterable<StreamChunk> {
  const history = input.history ?? [];
  const memoryConsolidationPlanner =
    input.memoryConsolidationPlanner ?? configuredMemoryConsolidationPlanner();
  const memoryDecisionPlanner = input.memoryDecisionPlanner ?? configuredMemoryDecisionPlanner();
  const memoryRetriever = input.memoryRetriever ?? configuredMemoryRetriever();

  yield { kind: "event", event: await memoryEngine.initialize(input.sessionId) };

  const retrieve = await memoryEngine.retrieve({
    sessionId: input.sessionId,
    query: input.message,
    limit: 3,
    retriever: memoryRetriever,
    now: input.now
  });
  yield { kind: "event", event: retrieve };

  const retrievedIds = retrieve.type === "retrieve" ? retrieve.ids : [];
  if (retrievedIds.length > 0) {
    yield { kind: "event", event: { type: "load", ids: retrievedIds } };
    yield { kind: "event", event: memoryEngine.fire("prefrontal", retrievedIds) };
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
    yield chunk;
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
    const storeEvent =
      stored.type === "store"
        ? { ...stored, decision: memoryDecisionTrace(resolvedMemoryDecision) }
        : stored;
    yield { kind: "event", event: storeEvent };

    const storedRegion = storeEvent.type === "store" ? storeEvent.memory.region : "hippocampus";
    yield {
      kind: "event",
      event: memoryEngine.fire(storedRegion, storeEvent.type === "store" ? [storeEvent.memory.id] : [])
    };

    const consolidationDecision = await memoryConsolidationPlanner.decide({
      memories: await memoryStore.list(input.sessionId)
    });

    if (consolidationDecision.operation === "consolidate") {
      const consolidated = await memoryEngine.consolidate({
        sessionId: input.sessionId,
        ids: consolidationDecision.ids,
        consolidatedText: consolidationDecision.consolidatedText,
        decision: consolidationDecisionTrace(consolidationDecision),
        now: input.now
      });

      if (consolidated?.type === "consolidate") {
        yield { kind: "event", event: consolidated };
        yield {
          kind: "event",
          event: memoryEngine.fire(consolidated.added.region, [consolidated.added.id])
        };
      }
    }
  } else {
    yield {
      kind: "event",
      event: { type: "plan", decision: memoryDecisionTrace(resolvedMemoryDecision) }
    };
  }

  const decay = await memoryEngine.decay(input.sessionId);
  if (decay) {
    yield { kind: "event", event: decay };
  }

  yield { kind: "done" };
}

function memoryDecisionTrace(decision: MemoryDecision): MemoryDecisionTrace {
  return {
    stage: "memory",
    operation: decision.operation,
    provider: decision.provider,
    confidence: decision.confidence,
    reason: decision.reason,
    relatedMemoryIds: decision.relatedMemoryIds
  };
}

function consolidationDecisionTrace(decision: ConsolidationDecision): MemoryDecisionTrace {
  return {
    stage: "consolidation",
    operation: decision.operation,
    provider: decision.provider,
    confidence: decision.confidence,
    reason: decision.reason,
    ids: decision.operation === "consolidate" ? decision.ids : undefined
  };
}

export function resetLiveMemoryStore() {
  memoryStore.clear();
}
