import type { ChatProviderClient, ChatTurnInput, ProviderChunk } from "@/lib/chat/providers/types";

export class OpenAIChatProvider implements ChatProviderClient {
  async *streamTurn(_input: ChatTurnInput): AsyncIterable<ProviderChunk> {
    yield {
      kind: "error",
      message: "OpenAI provider boundary is configured but live model calls are not enabled in this milestone."
    };
  }
}
