import { createLiveMemoryStream } from "@/lib/chat/live";
import { encodeSseChunk } from "@/lib/events/sse";
import type { ChatMessage } from "@/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    sessionId?: string;
    message?: string;
    history?: ChatMessage[];
  };

  const chunks = await createLiveMemoryStream({
    sessionId: body.sessionId ?? "demo-session",
    message: body.message ?? "",
    history: body.history ?? []
  });

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      chunks.forEach((chunk) => {
        controller.enqueue(encoder.encode(encodeSseChunk(chunk)));
      });
      controller.close();
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
