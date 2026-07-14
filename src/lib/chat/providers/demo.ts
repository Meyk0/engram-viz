import type { ChatProviderClient, ChatTurnInput, ProviderChunk } from "@/lib/chat/providers/types";

export class DemoChatProvider implements ChatProviderClient {
  readonly id = "demo" as const;

  async *streamTurn(input: ChatTurnInput): AsyncIterable<ProviderChunk> {
    const answer = deterministicMemoryAnswer(input);

    yield {
      kind: "text",
      delta: answer
    };
    yield { kind: "done" };
  }
}

function deterministicMemoryAnswer(input: ChatTurnInput) {
  if (input.retrievedMemories.length === 0) {
    return "I do not have a matching prior memory yet. This offline demo only answers from memory evidence that was retrieved for the turn.";
  }

  if (input.retrievedMemories.length === 1) {
    return `Based on the retrieved memory: ${input.retrievedMemories[0]!.text}`;
  }

  const evidence = input.retrievedMemories
    .map((memory) => `- ${memory.text}`)
    .join("\n");
  return `Based on ${input.retrievedMemories.length} retrieved memories:\n${evidence}`;
}
