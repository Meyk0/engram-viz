import { streamLiveMemoryChunks } from "@/lib/chat/live";
import { engramMemorySchema } from "@/lib/events/schema";
import { encodeSseChunk } from "@/lib/events/sse";
import type { ChatMessage, EngramMemory } from "@/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    clientMemories?: unknown;
    sessionId?: string;
    message?: string;
    history?: ChatMessage[];
  };
  const clientMemories = parseClientMemories(body.clientMemories);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      try {
        for await (const chunk of streamLiveMemoryChunks({
          sessionId: body.sessionId ?? "demo-session",
          message: body.message ?? "",
          history: body.history ?? [],
          clientMemories
        })) {
          controller.enqueue(encoder.encode(encodeSseChunk(chunk)));
        }
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            encodeSseChunk({
              kind: "error",
              message: error instanceof Error ? error.message : "Chat stream failed."
            })
          )
        );
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}

function parseClientMemories(input: unknown): EngramMemory[] {
  if (!Array.isArray(input)) return [];

  return input.flatMap((memory) => {
    const result = engramMemorySchema.safeParse(memory);
    return result.success ? [result.data] : [];
  });
}
