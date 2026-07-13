import type {
  ChatMessage,
  ChatProvider,
  EngramEvent,
  EngramMemory,
  MemoryRetrievalTrace
} from "@/types";

export type TurnRecord = {
  version: 1;
  id: string;
  sessionId: string;
  startedAt: string;
  completedAt: string;
  userMessage: string;
  history: ChatMessage[];
  retrievedMemories: EngramMemory[];
  retrieval?: MemoryRetrievalTrace;
  events: EngramEvent[];
  originalAnswer: string;
  provider: {
    id: Exclude<ChatProvider, "anthropic">;
    model?: string;
  };
};

export type CausalAblationRequest = {
  record: TurnRecord;
  excludedMemoryIds: string[];
};

export type CausalAblationResult = {
  version: 2;
  recordId: string;
  excludedMemoryIds: string[];
  originalAnswer: string;
  baselineAnswer: string;
  counterfactualAnswer: string;
  changed: boolean;
  comparison: {
    outcome: "changed" | "stable";
    normalizedTextDistance: number;
    answerLengthDelta: number;
    baselineRuns: 1;
    counterfactualRuns: 1;
  };
  caveat: string;
  provider: TurnRecord["provider"];
};
