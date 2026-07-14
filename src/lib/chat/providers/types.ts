import type { ChatMessage, ChatProvider, EngramMemory } from "@/types";
import type { TurnMemoryPlan } from "@/lib/memory/turn-planner";

export type ChatTurnInput = {
  message: string;
  history: ChatMessage[];
  retrievedMemories: EngramMemory[];
  storedMemories?: EngramMemory[];
  turnIntent?: TurnMemoryPlan["intent"];
};

export type ProviderChunk =
  | { kind: "text"; delta: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

export type ChatProviderClient = {
  readonly id: Exclude<ChatProvider, "anthropic">;
  readonly model?: string;
  streamTurn(input: ChatTurnInput): AsyncIterable<ProviderChunk>;
};
