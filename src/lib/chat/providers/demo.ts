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
  if (input.retrievedMemories.length === 0 && input.storedMemories?.length) {
    if (input.storedMemories.length === 1) {
      return `Saved as a new memory: ${input.storedMemories[0]!.text}`;
    }
    return `Saved ${input.storedMemories.length} new memories for this session.`;
  }

  if (input.retrievedMemories.length === 0 && input.turnIntent === "memory_question") {
    return "I do not have a matching prior memory yet. This offline demo only answers from memory evidence that was retrieved for the turn.";
  }

  if (input.retrievedMemories.length === 0) {
    return "No durable memory was stored or used for this turn in the offline demo.";
  }

  if (input.retrievedMemories.length === 1) {
    return `Based on the retrieved memory: ${input.retrievedMemories[0]!.text}`;
  }

  const evidence = input.retrievedMemories
    .map((memory) => `- ${memory.text}`)
    .join("\n");
  return `Based on ${input.retrievedMemories.length} retrieved memories:\n${evidence}`;
}
