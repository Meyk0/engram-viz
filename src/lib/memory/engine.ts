import {
  consolidateMemoriesTool,
  retrieveMemoryTool,
  storeMemoryTool
} from "@/lib/memory/tools";
import type { MemoryStore } from "@/lib/memory/store-interface";
import type { BrainRegion, EngramEvent } from "@/types";

export type StoreMemoryInput = {
  sessionId: string;
  text: string;
  importance?: number;
  topic?: string;
  now?: string;
};

export type RetrieveMemoryInput = {
  sessionId: string;
  query: string;
  limit?: number;
  now?: string;
};

export type ConsolidateMemoryInput = {
  sessionId: string;
  ids: string[];
  consolidatedText: string;
  now?: string;
};

export class MemoryEngine {
  constructor(private readonly store: MemoryStore) {}

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
    return retrieveMemoryTool(session, input);
  }

  fire(region: BrainRegion, ids: string[]): EngramEvent {
    return { type: "fire", region, ids };
  }

  async consolidate(input: ConsolidateMemoryInput): Promise<EngramEvent | null> {
    if (input.ids.length < 2) return null;

    const session = await this.store.getSession(input.sessionId);
    return consolidateMemoriesTool(session, input);
  }

  async decay(sessionId: string): Promise<EngramEvent | null> {
    const memories = await this.store.list(sessionId);
    const ids = memories
      .filter((memory) => memory.access_count === 0 && memory.importance < 0.4)
      .map((memory) => memory.id);

    return ids.length > 0 ? { type: "decay", ids } : null;
  }
}
