import { dreamProposalSchema, engramMemorySchema } from "@/lib/events/schema";
import { configuredDreamPlanner } from "@/lib/memory/planner-config";
import { readBoundedJson, RequestBodyError } from "@/lib/http";
import type { EngramMemory } from "@/types";
import { createRequestDeadline } from "@/lib/request-signal";

export const runtime = "nodejs";
const MAX_DREAM_REQUEST_BYTES = 256_000;
const MAX_DREAM_MEMORIES = 200;

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await readBoundedJson(request, MAX_DREAM_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "Dream request could not be read." }, { status: 400 });
  }
  if (!isRecord(rawBody)) {
    return Response.json({ error: "Dream request must be an object." }, { status: 400 });
  }
  if (!Array.isArray(rawBody.clientMemories) || rawBody.clientMemories.length > MAX_DREAM_MEMORIES) {
    return Response.json(
      { error: `Dream review requires at most ${MAX_DREAM_MEMORIES} client memories.` },
      { status: 400 }
    );
  }
  if (rawBody.now !== undefined && typeof rawBody.now !== "string") {
    return Response.json({ error: "Dream review now must be an ISO timestamp string." }, { status: 400 });
  }
  const body = rawBody;
  const now = typeof body.now === "string" ? body.now : undefined;
  const deadline = createRequestDeadline(request.signal, 30_000);

  try {
    const planner = configuredDreamPlanner();
    const proposal = await planner.decide({
      memories: parseClientMemories(body.clientMemories),
      now,
      signal: deadline.signal
    });
    deadline.signal.throwIfAborted();

    return Response.json({ proposal: dreamProposalSchema.parse(proposal) });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Dream review failed."
      },
      { status: 500 }
    );
  } finally {
    deadline.dispose();
  }
}

function parseClientMemories(input: unknown): EngramMemory[] {
  if (!Array.isArray(input)) return [];

  return input.flatMap((memory) => {
    const result = engramMemorySchema.safeParse(memory);
    return result.success ? [result.data] : [];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
