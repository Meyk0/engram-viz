import type { ChatMessage, ChatProvider, EngramMemory } from "@/types";

export type ChatTurnInput = {
  message: string;
  history: ChatMessage[];
  retrievedMemories: EngramMemory[];
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
