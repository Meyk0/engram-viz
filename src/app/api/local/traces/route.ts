import { parseTelemetryIngestKeys } from "@/lib/ingest/auth";
import { getAgentTurnStore, getMemoryTelemetryStore } from "@/lib/ingest/runtime";
import { buildTelemetryTraces } from "@/lib/traces/from-telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (process.env.ENGRAM_LOCAL_MODE !== "true") {
    return Response.json({ error: "Local trace access is disabled." }, { status: 404 });
  }
  if (!isTrustedLoopbackRequest(request)) {
    return Response.json({ error: "Local trace access requires a loopback request." }, { status: 403 });
  }
  const key = parseTelemetryIngestKeys()[0];
  if (!key) return Response.json({ error: "Local ingest is not configured." }, { status: 503 });
  const context = { tenantId: key.tenantId, projectId: key.projectId, keyId: key.keyId };
  try {
    const [turns, telemetry] = await Promise.all([
      getAgentTurnStore().read(context),
      getMemoryTelemetryStore().read(context, { afterCursor: 0, limit: 10_000 })
    ]);
    return Response.json({
      projectId: key.projectId,
      traces: buildTelemetryTraces(turns, telemetry.events)
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Local traces could not be reconstructed." }, { status: 503 });
  }
}

export function isTrustedLoopbackRequest(request: Request) {
  const host = parseAuthority(request.headers.get("host"));
  if (!host || !isLoopbackHostname(host.hostname)) return false;

  const originValue = request.headers.get("origin");
  if (!originValue) return true;

  try {
    const origin = new URL(originValue);
    return (origin.protocol === "http:" || origin.protocol === "https:")
      && !origin.username
      && !origin.password
      && origin.pathname === "/"
      && !origin.search
      && !origin.hash
      && isLoopbackHostname(origin.hostname)
      && origin.host.toLowerCase() === host.host;
  } catch {
    return false;
  }
}

function parseAuthority(value: string | null) {
  if (!value || /[\s,/@]/.test(value)) return undefined;
  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) return undefined;
    return {
      host: parsed.host.toLowerCase(),
      hostname: parsed.hostname.toLowerCase()
    };
  } catch {
    return undefined;
  }
}

function isLoopbackHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
