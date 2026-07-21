import { isTrustedLoopbackRequest } from "@/app/api/local/traces/route";
import { localExecutorConfigured, readLocalExecutorManifest } from "@/lib/executor/local-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (process.env.ENGRAM_LOCAL_MODE !== "true") {
    return Response.json({ error: "Local executor access is disabled." }, { status: 404 });
  }
  if (!isTrustedLoopbackRequest(request)) {
    return Response.json({ error: "Local executor access requires a loopback request." }, { status: 403 });
  }
  if (!localExecutorConfigured()) {
    return Response.json({ available: false }, { headers: { "Cache-Control": "no-store" } });
  }
  try {
    return Response.json({ available: true, manifest: await readLocalExecutorManifest() }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return Response.json({ available: false, error: message(error) }, { status: 503 });
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "The replay executor is unavailable.";
}
