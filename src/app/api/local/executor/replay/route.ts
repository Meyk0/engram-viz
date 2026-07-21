import { parseMemoryExecutorReplayRequest } from "@engramviz/core";
import { isTrustedLoopbackRequest } from "@/app/api/local/traces/route";
import { localExecutorConfigured, runLocalExecutorReplay } from "@/lib/executor/local-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (process.env.ENGRAM_LOCAL_MODE !== "true") {
    return Response.json({ error: "Local executor access is disabled." }, { status: 404 });
  }
  if (!isTrustedLoopbackRequest(request)) {
    return Response.json({ error: "Local executor access requires a loopback request." }, { status: 403 });
  }
  if (!localExecutorConfigured()) {
    return Response.json({ error: "No local replay executor is configured." }, { status: 503 });
  }
  try {
    const envelope = parseMemoryExecutorReplayRequest(await request.json());
    return Response.json(await runLocalExecutorReplay(envelope), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 422 });
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "The replay executor could not complete the run.";
}
