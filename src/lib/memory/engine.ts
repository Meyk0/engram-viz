import {
  consolidateMemoriesTool,
  storeMemoryTool
} from "@/lib/memory/tools";
import { configuredMemoryRetriever } from "@/lib/memory/retriever-config";
import type { MemoryRetriever } from "@/lib/memory/retrieve";
import { listMemories, markAccessed, markSuperseded, type MemoryInput } from "@/lib/memory/store";
import type { MemoryStore } from "@/lib/memory/store-interface";
import type { BrainRegion, EngramEvent, MemoryDecisionTrace } from "@/types";

export type StoreMemoryInput = MemoryInput & {
  sessionId: string;
};

export type RetrieveMemoryInput = {
  sessionId: string;
  query: string;
  limit?: number;
  retriever?: MemoryRetriever;
  now?: string;
};

export type ConsolidateMemoryInput = {
  sessionId: string;
  ids: string[];
  consolidatedText: string;
  topic?: string;
  entities?: string[];
  confidence?: number;
  decision?: MemoryDecisionTrace;
  now?: string;
};

export class MemoryEngine {
  constructor(
    private readonly store: MemoryStore,
    private readonly retriever: MemoryRetriever = configuredMemoryRetriever()
  ) {}

  async initialize(sessionId: string): Promise<EngramEvent> {
    return {
      type: "init",
      memories: await this.store.list(sessionId)
    };
  }

  async storeMemory(input: StoreMemoryInput): Promise<EngramEvent> {
    const session = await this.store.getSession(input.sessionId);
    return storeMemoryTool(session, input);
  }

  async retrieve(input: RetrieveMemoryInput): Promise<EngramEvent> {
    const session = await this.store.getSession(input.sessionId);
    const retrieval = await (input.retriever ?? this.retriever).retrieve({
      memories: listMemories(session).filter((memory) => memory.status !== "superseded"),
      query: input.query,
      limit: input.limit
    });
    const ids = retrieval.results.map((result) => result.memory.id);
    const accessed = markAccessed(session, ids, input.now);

    return {
      type: "retrieve",
      query: input.query,
      ids,
      accessed,
      retrieval: {
        provider: retrieval.provider,
        reason: retrieval.reason,
        matches: retrieval.results.map((result, index) => ({
          id: result.memory.id,
          rank: index + 1,
          score: result.score,
          ...(result.similarity !== undefined ? { similarity: result.similarity } : {}),
          basis: result.basis ?? (retrieval.provider === "semantic" ? "semantic" : "lexical"),
          selected: true
        }))
      }
    };
  }

  fire(region: BrainRegion, ids: string[]): EngramEvent {
    return { type: "fire", region, ids };
  }

  async consolidate(input: ConsolidateMemoryInput): Promise<EngramEvent | null> {
    if (input.ids.length < 2) return null;

    const session = await this.store.getSession(input.sessionId);
    const event = consolidateMemoriesTool(session, input);
    return event.type === "consolidate" && input.decision ? { ...event, decision: input.decision } : event;
  }

  async supersede(sessionId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const session = await this.store.getSession(sessionId);
    markSuperseded(session, ids);
  }

  async decay(sessionId: string): Promise<EngramEvent | null> {
    const memories = await this.store.list(sessionId);
    const ids = memories
      .filter((memory) => memory.status !== "superseded" && memory.access_count === 0 && memory.importance < 0.4)
      .map((memory) => memory.id);

    return ids.length > 0 ? { type: "decay", ids } : null;
  }
}
