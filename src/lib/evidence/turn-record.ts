import type { ChatProviderClient } from "@/lib/chat/providers/types";
import type { TurnRecord } from "@/lib/evidence/types";
import type { ChatMessage, EngramEvent, EngramMemory, MemoryRetrievalTrace } from "@/types";

export function createImmutableTurnRecord(input: {
  id?: string;
  sessionId: string;
  startedAt: string;
  completedAt: string;
  userMessage: string;
  history: ChatMessage[];
  retrievedMemories: EngramMemory[];
  retrieval?: MemoryRetrievalTrace;
  events: EngramEvent[];
  originalAnswer: string;
  provider: ChatProviderClient;
}): TurnRecord {
  const record: TurnRecord = {
    version: 1,
    id: input.id ?? `turn-${crypto.randomUUID()}`,
    sessionId: input.sessionId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    userMessage: input.userMessage,
    history: input.history,
    retrievedMemories: input.retrievedMemories,
    ...(input.retrieval ? { retrieval: input.retrieval } : {}),
    events: input.events,
    originalAnswer: input.originalAnswer,
    provider: {
      id: input.provider.id,
      ...(input.provider.model ? { model: input.provider.model } : {})
    }
  };

  return deepFreeze(structuredClone(record));
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
