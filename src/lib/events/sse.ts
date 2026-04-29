import { parseStreamChunk } from "@/lib/events/schema";
import type { StreamChunk } from "@/types";

const EVENT_NAME = "engram";

export function encodeSseChunk(chunk: StreamChunk): string {
  return `event: ${EVENT_NAME}\ndata: ${JSON.stringify(chunk)}\n\n`;
}

export function decodeSsePayload(payload: string): StreamChunk {
  return parseStreamChunk(JSON.parse(payload));
}

export function decodeSseChunks(streamText: string): StreamChunk[] {
  return streamText
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const dataLine = block
        .split("\n")
        .find((line) => line.startsWith("data: "));

      if (!dataLine) {
        throw new Error(`SSE block is missing data: ${block}`);
      }

      return decodeSsePayload(dataLine.slice("data: ".length));
    });
}
