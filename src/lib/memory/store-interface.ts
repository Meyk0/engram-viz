import type { EngramMemory } from "@/types";
import { createMemorySession, type MemorySession } from "@/lib/memory/store";

export type MemoryStore = {
  getSession(sessionId: string): Promise<MemorySession>;
  list(sessionId: string): Promise<EngramMemory[]>;
  upsert(sessionId: string, memory: EngramMemory): Promise<void>;
  remove(sessionId: string, ids: string[]): Promise<void>;
};

export class InMemoryMemoryStore implements MemoryStore {
  private readonly sessions = new Map<string, MemorySession>();

  async getSession(sessionId: string): Promise<MemorySession> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const session = createMemorySession(sessionId);
    this.sessions.set(sessionId, session);
    return session;
  }

  async list(sessionId: string): Promise<EngramMemory[]> {
    const session = await this.getSession(sessionId);
    return [...session.memories.values()];
  }

  async upsert(sessionId: string, memory: EngramMemory): Promise<void> {
    const session = await this.getSession(sessionId);
    session.memories.set(memory.id, memory);
  }

  async remove(sessionId: string, ids: string[]): Promise<void> {
    const session = await this.getSession(sessionId);
    ids.forEach((id) => session.memories.delete(id));
  }

  clear() {
    this.sessions.clear();
  }
}
