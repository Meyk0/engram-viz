import { liveTraceHub } from "@/lib/traces/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 512_000;
const CHANNEL_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const encoder = new TextEncoder();

export async function GET(request: Request) {
  const channelId = readChannelId(request);
  if (!channelId) return jsonError("A valid live recorder channel is required.", 400);

  let unsubscribe: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("retry: 1500\n\n"));
      unsubscribe = liveTraceHub.subscribe(channelId, (snapshot) => {
        controller.enqueue(encoder.encode(`event: trace\ndata: ${JSON.stringify(snapshot)}\n\n`));
      });
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(": heartbeat\n\n")), 15_000);
    },
    cancel() {
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}

export async function POST(request: Request) {
  const channelId = readChannelId(request);
  if (!channelId) return jsonError("A valid live recorder channel is required.", 400);
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return jsonError("Live recorder payload is too large.", 413);
  }

  const raw = await request.text().catch(() => "");
  if (encoder.encode(raw).byteLength > MAX_REQUEST_BYTES) {
    return jsonError("Live recorder payload is too large.", 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError("Live recorder payload must be valid JSON.", 400);
  }
  if (!isRecord(body)) return jsonError("Live recorder payload must be an object.", 400);
  const items = Array.isArray(body.items) ? body.items : "item" in body ? [body.item] : [];
  if (items.length === 0 || items.length > 100) {
    return jsonError("Send between 1 and 100 trace items.", 400);
  }

  try {
    const snapshot = liveTraceHub.append(channelId, items);
    return Response.json({
      accepted: items.length,
      itemCount: snapshot.itemCount,
      stepCount: snapshot.trace.steps.length,
      memoryEventCount: snapshot.trace.steps.reduce(
        (count, step) => count + step.memoryMappings.filter((mapping) => mapping.event).length,
        0
      )
    }, { headers: corsHeaders() });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Live trace could not be recorded.", 400);
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function readChannelId(request: Request) {
  const channelId = new URL(request.url).searchParams.get("channel") ?? "";
  return CHANNEL_PATTERN.test(channelId) ? channelId : undefined;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Origin": "*"
  };
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: corsHeaders() });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
