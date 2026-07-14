import { streamLiveMemoryChunks } from "@/lib/chat/live";
import { engramMemorySchema } from "@/lib/events/schema";
import { encodeSseChunk } from "@/lib/events/sse";
import { readBoundedJson, RequestBodyError } from "@/lib/http";
import { InMemoryMemoryStore } from "@/lib/memory/store-interface";
import { createRequestDeadline } from "@/lib/request-signal";
import type { ChatMessage, EngramMemory, StreamChunk } from "@/types";

export const runtime = "nodejs";
const MAX_CHAT_REQUEST_BYTES = 256_000;
const MAX_CHAT_MESSAGE_CHARS = 12_000;
const MAX_CHAT_HISTORY_ITEMS = 100;

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await readBoundedJson(request, MAX_CHAT_REQUEST_BYTES);
  } catch (error) {
    return requestError(error, "Chat request could not be read.");
  }
  if (!isRecord(rawBody)) return errorResponse("Chat request must be an object.", 400);
  const body = rawBody;
  if (typeof body.message !== "string" || !body.message.trim() || body.message.length > MAX_CHAT_MESSAGE_CHARS) {
    return errorResponse(`Chat message must contain 1 to ${MAX_CHAT_MESSAGE_CHARS} characters.`, 400);
  }
  if (body.sessionId !== undefined && (typeof body.sessionId !== "string" || body.sessionId.length > 160)) {
    return errorResponse("Chat sessionId must be a string of at most 160 characters.", 400);
  }
  const history = parseHistory(body.history);
  if (!history) {
    return errorResponse(`Chat history must contain at most ${MAX_CHAT_HISTORY_ITEMS} valid messages.`, 400);
  }
  const message = body.message;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "demo-session";
  const clientMemories = parseClientMemories(body.clientMemories);
  const deadline = createRequestDeadline(request.signal, 45_000);
  let iterator: AsyncIterator<StreamChunk> | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      try {
        iterator = streamLiveMemoryChunks({
          sessionId,
          message,
          history,
          clientMemories,
          memoryStore: new InMemoryMemoryStore(),
          signal: deadline.signal
        })[Symbol.asyncIterator]();
        while (!deadline.signal.aborted) {
          const step = await iterator.next();
          if (step.done) break;
          const chunk = step.value;
          controller.enqueue(encoder.encode(encodeSseChunk(chunk)));
        }
      } catch (error) {
        if (!deadline.signal.aborted) {
          controller.enqueue(
            encoder.encode(
              encodeSseChunk({
                kind: "error",
                message: error instanceof Error ? error.message : "Chat stream failed."
              })
            )
          );
        }
      } finally {
        deadline.dispose();
        try {
          controller.close();
        } catch {
          // The consumer may already have canceled and closed the stream.
        }
      }
    },
    async cancel(reason) {
      deadline.abort(reason);
      deadline.dispose();
      await iterator?.return?.(reason);
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

function parseHistory(input: unknown): ChatMessage[] | undefined {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > MAX_CHAT_HISTORY_ITEMS) return undefined;
  const history: ChatMessage[] = [];
  for (const message of input) {
    if (!isRecord(message)) return undefined;
    if (message.role !== "user" && message.role !== "assistant") return undefined;
    if (typeof message.content !== "string" || message.content.length > MAX_CHAT_MESSAGE_CHARS) {
      return undefined;
    }
    history.push({ role: message.role, content: message.content });
  }
  return history;
}

function parseClientMemories(input: unknown): EngramMemory[] {
  if (!Array.isArray(input)) return [];

  return input.flatMap((memory) => {
    const result = engramMemorySchema.safeParse(memory);
    return result.success ? [result.data] : [];
  });
}

function requestError(error: unknown, fallback: string) {
  if (error instanceof RequestBodyError) return errorResponse(error.message, error.status);
  return errorResponse(fallback, 400);
}

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
