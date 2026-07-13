import type { ChatProviderClient, ChatTurnInput, ProviderChunk } from "@/lib/chat/providers/types";

export class DemoChatProvider implements ChatProviderClient {
  readonly id = "demo" as const;

  async *streamTurn(input: ChatTurnInput): AsyncIterable<ProviderChunk> {
    const memoryPhrase =
      input.retrievedMemories.length > 0
        ? `I connected this to ${input.retrievedMemories.length} prior memory trace${input.retrievedMemories.length === 1 ? "" : "s"}. `
        : "I do not have a matching prior memory yet. ";

    yield {
      kind: "text",
      delta: `${memoryPhrase}I will keep tracking how this changes the memory state.`
    };
    yield { kind: "done" };
  }
}
