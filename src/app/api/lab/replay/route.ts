import {
  memoryBranchReplayRequestSchema,
  memoryBranchReplayResultSchema
} from "@/lib/events/schema";
import {
  MAX_MEMORY_BRANCH_REPLAY_REQUEST_BYTES,
  MemoryBranchReplayProviderError,
  MemoryBranchReplayValidationError,
  runMemoryBranchReplay
} from "@/lib/lab/replay";
import { executePublicDemoReplay } from "@/lib/lab/demo-replay";
import { createRequestDeadline } from "@/lib/request-signal";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const limited = checkApiRateLimit(request, { scope: "branch-replay", limit: 8 });
  if (limited) return limited;

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_MEMORY_BRANCH_REPLAY_REQUEST_BYTES) {
    return errorResponse("Memory branch replay request is too large.", 413);
  }

  const rawBody = await request.text().catch(() => "");
  if (new TextEncoder().encode(rawBody).byteLength > MAX_MEMORY_BRANCH_REPLAY_REQUEST_BYTES) {
    return errorResponse("Memory branch replay request is too large.", 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse("Memory branch replay request must be valid JSON.", 400);
  }

  const parsed = memoryBranchReplayRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Memory branch replay request failed validation.", 400);
  }

  const deadline = createRequestDeadline(request.signal, 45_000);
  try {
    const result = parsed.data.record.sessionId === "sample-memory-incident"
      && parsed.data.record.provider.id === "demo"
      ? await executePublicDemoReplay(parsed.data)
      : await runMemoryBranchReplay(parsed.data, undefined, deadline.signal);
    return Response.json(memoryBranchReplayResultSchema.parse(result));
  } catch (error) {
    if (error instanceof MemoryBranchReplayValidationError) {
      return errorResponse(error.message, 400);
    }
    if (error instanceof MemoryBranchReplayProviderError) {
      return errorResponse("Memory branch provider replay failed.", 502);
    }
    return errorResponse("Memory branch replay failed.", 500);
  } finally {
    deadline.dispose();
  }
}

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}
