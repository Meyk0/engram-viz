import { fixtureStream } from "@/lib/events/fixtures";
import type { ChatMessage, StreamChunk } from "@/types";

export function createDemoStream(_messages: ChatMessage[]): StreamChunk[] {
  return fixtureStream;
}
