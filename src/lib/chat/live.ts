import { createChatProvider, configuredChatProvider } from "@/lib/chat/providers";
import type { ChatProviderClient } from "@/lib/chat/providers/types";
import { createImmutableTurnRecord } from "@/lib/evidence/turn-record";
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
import { InMemoryMemoryStore, type MemoryStore } from "@/lib/memory/store-interface";
import type { PlannedMemory, TurnMemoryPlan, TurnMemoryPlanner } from "@/lib/memory/turn-planner";
import type {
  ChatMessage,
  EngramEvent,
  EngramMemory,
  MemoryDecisionTrace,
  MemoryRetrievalTrace,
  StreamChunk
} from "@/types";

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
  chatProvider?: ChatProviderClient;
  memoryStore?: MemoryStore;
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
  const startedAt = input.now ?? new Date().toISOString();
  const events: EngramEvent[] = [];
  let originalAnswer = "";
  const store = input.memoryStore ?? memoryStore;
  const engine = input.memoryStore ? new MemoryEngine(store) : memoryEngine;
  const iterator = orchestrateLiveMemoryChunks(input, store, engine)[Symbol.asyncIterator]();
  let result: OrchestrationResult;

  while (true) {
    const step = await iterator.next();
    if (step.done) {
      result = step.value;
      break;
    }

    const chunk = step.value;
    if (chunk.kind === "event") events.push(structuredClone(chunk.event));
    if (chunk.kind === "text") originalAnswer += chunk.delta;
    yield chunk;
  }

  yield {
    kind: "turn_record",
    record: createImmutableTurnRecord({
      sessionId: input.sessionId,
      startedAt,
      completedAt: input.now ?? new Date().toISOString(),
      userMessage: input.message,
      history: structuredClone(input.history ?? []),
      retrievedMemories: result.retrievedMemories,
      retrieval: result.retrieval,
      events,
      originalAnswer,
      provider: result.provider
    })
  };
  yield { kind: "done" };
}

type OrchestrationResult = {
  provider: ChatProviderClient;
  retrievedMemories: EngramMemory[];
  retrieval?: MemoryRetrievalTrace;
};

async function* orchestrateLiveMemoryChunks(
  input: LiveChatInput,
  store: MemoryStore,
  engine: MemoryEngine
): AsyncGenerator<StreamChunk, OrchestrationResult> {
  const history = input.history ?? [];
  const memoryConsolidationPlanner =
    input.memoryConsolidationPlanner ?? configuredMemoryConsolidationPlanner();
  const turnMemoryPlanner =
    input.turnMemoryPlanner ??
    (input.memoryDecisionPlanner
      ? new LegacyDecisionTurnMemoryPlanner(input.memoryDecisionPlanner)
      : configuredTurnMemoryPlanner());
  const memoryRetriever = input.memoryRetriever ?? configuredMemoryRetriever();

  await hydrateSessionFromClient(store, input.sessionId, input.clientMemories);

  yield { kind: "event", event: await engine.initialize(input.sessionId) };

  const turnPlan = await turnMemoryPlanner.decide({
    message: input.message,
    history,
    memories: await store.list(input.sessionId)
  });
  let planEmitted = false;
  const storedIds: string[] = [];

  if (!turnPlan.shouldRetrieve && turnPlan.memories.length === 0) {
    yield {
      kind: "event",
      event: { type: "plan", decision: turnPlanDecisionTrace(turnPlan, []) }
    };
    planEmitted = true;
  }

  const retrieve = turnPlan.shouldRetrieve
    ? await engine.retrieve({
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
    yield { kind: "event", event: engine.fire("prefrontal", retrievedIds) };
  }

  const retrievedMemories = (await store.list(input.sessionId)).filter((memory) =>
    retrievedIds.includes(memory.id)
  );
  const storeBeforeResponse = !turnPlan.shouldRetrieve && turnPlan.memories.length > 0;

  if (storeBeforeResponse) {
    for (const chunk of await storePlannedMemories({
      sessionId: input.sessionId,
      engine,
      now: input.now,
      plan: turnPlan,
      relatedMemoryIds: retrievedIds
    })) {
      if (chunk.kind === "event" && chunk.event.type === "store") storedIds.push(chunk.event.memory.id);
      yield chunk;
    }
  }

  const storedMemories = storedIds.length > 0
    ? (await store.list(input.sessionId)).filter((memory) => storedIds.includes(memory.id))
    : [];

  const provider = input.chatProvider ?? createChatProvider(configuredChatProvider());
  for await (const chunk of provider.streamTurn({
    message: input.message,
    history,
    retrievedMemories,
    storedMemories,
    turnIntent: turnPlan.intent
  })) {
    if (chunk.kind === "done") continue;
    yield chunk;
  }

  if (!storeBeforeResponse) {
    for (const chunk of await storePlannedMemories({
      sessionId: input.sessionId,
      engine,
      now: input.now,
      plan: turnPlan,
      relatedMemoryIds: retrievedIds
    })) {
      if (chunk.kind === "event" && chunk.event.type === "store") storedIds.push(chunk.event.memory.id);
      yield chunk;
    }
  }

  if (storedIds.length > 0) {
    const consolidationDecision = await memoryConsolidationPlanner.decide({
      memories: await store.list(input.sessionId),
      recentMemoryIds: storedIds
    });

    if (consolidationDecision.operation === "consolidate") {
      const consolidated = await engine.consolidate({
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
          event: engine.fire(consolidated.added.region, [consolidated.added.id])
        };
      }
    }
  } else if (!planEmitted) {
    yield {
      kind: "event",
      event: { type: "plan", decision: turnPlanDecisionTrace(turnPlan, retrievedIds) }
    };
  }

  const decay = await engine.decay(input.sessionId);
  if (decay) {
    yield { kind: "event", event: decay };
  }

  return {
    provider,
    retrievedMemories: structuredClone(retrievedMemories),
    ...(retrieve?.type === "retrieve" && retrieve.retrieval
      ? { retrieval: structuredClone(retrieve.retrieval) }
      : {})
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

async function hydrateSessionFromClient(
  store: MemoryStore,
  sessionId: string,
  clientMemories: EngramMemory[] = []
) {
  if (clientMemories.length === 0) return;

  const existing = await store.list(sessionId);
  if (existing.length > 0) return;

  await Promise.all(clientMemories.map((memory) => store.upsert(sessionId, memory)));
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
    operation: plan.memories.length > 0 ? "store" : "ignore",
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

async function storePlannedMemories({
  engine,
  sessionId,
  now,
  plan,
  relatedMemoryIds
}: {
  engine: MemoryEngine;
  sessionId: string;
  now?: string;
  plan: TurnMemoryPlan;
  relatedMemoryIds: string[];
}): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];

  for (const plannedMemory of plan.memories) {
    const supersedes = unique([
      ...(plannedMemory.supersedes ?? []),
      ...(plan.supersedeMemoryIds ?? [])
    ]);
    await engine.supersede(sessionId, supersedes);

    const stored = await engine.storeMemory({
      sessionId,
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
      now
    });
    const memoryDecision = plannedMemoryDecisionTrace(plan, plannedMemory, relatedMemoryIds);
    const storeEvent =
      stored.type === "store"
        ? { ...stored, decision: memoryDecision }
        : stored;
    chunks.push({ kind: "event", event: storeEvent });

    const storedRegion = storeEvent.type === "store" ? storeEvent.memory.region : "hippocampus";
    chunks.push({
      kind: "event",
      event: engine.fire(storedRegion, storeEvent.type === "store" ? [storeEvent.memory.id] : [])
    });
  }

  return chunks;
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
