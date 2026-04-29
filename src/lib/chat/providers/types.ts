import type { ChatMessage, EngramMemory } from "@/types";

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
  streamTurn(input: ChatTurnInput): AsyncIterable<ProviderChunk>;
};
