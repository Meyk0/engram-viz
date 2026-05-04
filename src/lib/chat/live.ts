import { createChatProvider, configuredChatProvider } from "@/lib/chat/providers";
import { MemoryEngine } from "@/lib/memory/engine";
import type { MemoryConsolidationPlanner } from "@/lib/memory/consolidationPolicy";
import type { ConsolidationDecision } from "@/lib/memory/consolidationPolicy";
import type { MemoryDecisionPlanner } from "@/lib/memory/decision";
import {
  configuredMemoryConsolidationPlanner,
  configuredTurnMemoryPlanner
} from "@/lib/memory/planner-config";
import { configuredMemoryRetriever } from "@/lib/memory/retriever-config";
import type { MemoryRetriever } from "@/lib/memory/retrieve";
import { InMemoryMemoryStore } from "@/lib/memory/store-interface";
import type { PlannedMemory, TurnMemoryPlan, TurnMemoryPlanner } from "@/lib/memory/turn-planner";
import type { ChatMessage, EngramMemory, MemoryDecisionTrace, StreamChunk } from "@/types";

const memoryStore = new InMemoryMemoryStore();
const memoryEngine = new MemoryEngine(memoryStore);

export type LiveChatInput = {
  clientMemories?: EngramMemory[];
  sessionId: string;
  message: string;
  history?: ChatMessage[];
  memoryConsolidationPlanner?: MemoryConsolidationPlanner;
  memoryDecisionPlanner?: MemoryDecisionPlanner;
  memoryRetriever?: MemoryRetriever;
  turnMemoryPlanner?: TurnMemoryPlanner;
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
  const turnMemoryPlanner =
    input.turnMemoryPlanner ??
    (input.memoryDecisionPlanner
      ? new LegacyDecisionTurnMemoryPlanner(input.memoryDecisionPlanner)
      : configuredTurnMemoryPlanner());
  const memoryRetriever = input.memoryRetriever ?? configuredMemoryRetriever();

  await hydrateSessionFromClient(input.sessionId, input.clientMemories);

  yield { kind: "event", event: await memoryEngine.initialize(input.sessionId) };

  const turnPlan = await turnMemoryPlanner.decide({
    message: input.message,
    history,
    memories: await memoryStore.list(input.sessionId)
  });

  const retrieve = turnPlan.shouldRetrieve
    ? await memoryEngine.retrieve({
        sessionId: input.sessionId,
        query: turnPlan.retrieveQuery ?? input.message,
        limit: 3,
        retriever: memoryRetriever,
        now: input.now
      })
    : undefined;

  if (retrieve) {
    yield { kind: "event", event: retrieve };
  }

  const retrievedIds = retrieve?.type === "retrieve" ? retrieve.ids : [];
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

  const storedIds: string[] = [];
  for (const plannedMemory of turnPlan.memories) {
    const supersedes = unique([
      ...(plannedMemory.supersedes ?? []),
      ...(turnPlan.supersedeMemoryIds ?? [])
    ]);
    await memoryEngine.supersede(input.sessionId, supersedes);

    const stored = await memoryEngine.storeMemory({
      sessionId: input.sessionId,
      text: plannedMemory.text,
      importance: plannedMemory.importance,
      topic: plannedMemory.topic,
      kind: plannedMemory.kind,
      entities: plannedMemory.entities,
      confidence: plannedMemory.confidence,
      sourceText: plannedMemory.sourceText,
      cluster: plannedMemory.cluster,
      supersedes,
      status: "active",
      now: input.now
    });
    const memoryDecision = plannedMemoryDecisionTrace(turnPlan, plannedMemory, retrievedIds);
    const storeEvent =
      stored.type === "store"
        ? { ...stored, decision: memoryDecision }
        : stored;
    yield { kind: "event", event: storeEvent };

    if (storeEvent.type === "store") storedIds.push(storeEvent.memory.id);

    const storedRegion = storeEvent.type === "store" ? storeEvent.memory.region : "hippocampus";
    yield {
      kind: "event",
      event: memoryEngine.fire(storedRegion, storeEvent.type === "store" ? [storeEvent.memory.id] : [])
    };
  }

  if (storedIds.length > 0) {
    const consolidationDecision = await memoryConsolidationPlanner.decide({
      memories: await memoryStore.list(input.sessionId),
      recentMemoryIds: storedIds
    });

    if (consolidationDecision.operation === "consolidate") {
      const consolidated = await memoryEngine.consolidate({
        sessionId: input.sessionId,
        ids: consolidationDecision.ids,
        consolidatedText: consolidationDecision.consolidatedText,
        topic: consolidationDecision.topic,
        entities: consolidationDecision.entities,
        confidence: consolidationDecision.confidence,
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
      event: { type: "plan", decision: turnPlanDecisionTrace(turnPlan, retrievedIds) }
    };
  }

  const decay = await memoryEngine.decay(input.sessionId);
  if (decay) {
    yield { kind: "event", event: decay };
  }

  yield { kind: "done" };
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

async function hydrateSessionFromClient(sessionId: string, clientMemories: EngramMemory[] = []) {
  if (clientMemories.length === 0) return;

  const existing = await memoryStore.list(sessionId);
  if (existing.length > 0) return;

  await Promise.all(clientMemories.map((memory) => memoryStore.upsert(sessionId, memory)));
}

function plannedMemoryDecisionTrace(
  plan: TurnMemoryPlan,
  memory: PlannedMemory,
  relatedMemoryIds: string[]
): MemoryDecisionTrace {
  return {
    stage: "memory",
    operation: "store",
    provider: plan.provider,
    confidence: Math.min(plan.confidence, memory.confidence),
    reason: memory.kind === "other" ? plan.reason : memory.kind === "correction" ? "correction" : memory.kind.replace("_", "-"),
    relatedMemoryIds
  };
}

function turnPlanDecisionTrace(plan: TurnMemoryPlan, relatedMemoryIds: string[]): MemoryDecisionTrace {
  return {
    stage: "memory",
    operation: "ignore",
    provider: plan.provider,
    confidence: plan.confidence,
    reason: friendlyPlanReason(plan),
    relatedMemoryIds
  };
}

function friendlyPlanReason(plan: TurnMemoryPlan) {
  if (plan.provider !== "deterministic") return plan.reason;
  if (plan.shouldRetrieve && plan.intent === "memory_question") return "memory-question";
  if (plan.intent === "command") return "command";
  if (plan.intent === "general_chat") return "not-durable";
  return plan.reason;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

class LegacyDecisionTurnMemoryPlanner implements TurnMemoryPlanner {
  readonly provider = "deterministic" as const;

  constructor(private readonly planner: MemoryDecisionPlanner) {}

  async decide(input: { message: string; history?: ChatMessage[]; memories?: EngramMemory[] }): Promise<TurnMemoryPlan> {
    const decision = await this.planner.decide({ message: input.message });

    if (decision.operation === "store") {
      return {
        provider: decision.provider,
        confidence: decision.confidence,
        reason: decision.reason,
        intent: "durable_statement",
        shouldRetrieve: false,
        retrieveQuery: null,
        memories: [
          {
            text: decision.memoryText,
            kind: decision.reason === "project-fact" ? "project_fact" : "other",
            topic: decision.topic,
            importance: decision.importance,
            confidence: decision.confidence,
            entities: [],
            sourceText: input.message,
            supersedes: []
          }
        ],
        supersedeMemoryIds: []
      };
    }

    return {
      provider: decision.provider,
      confidence: decision.confidence,
      reason: decision.reason,
      intent: "general_chat",
      shouldRetrieve: false,
      retrieveQuery: null,
      memories: [],
      supersedeMemoryIds: []
    };
  }
}
