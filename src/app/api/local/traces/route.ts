import { parseTelemetryIngestKeys } from "@/lib/ingest/auth";
import { getAgentTurnStore, getMemoryTelemetryStore } from "@/lib/ingest/runtime";
import { buildTelemetryTraces } from "@/lib/traces/from-telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.ENGRAM_LOCAL_MODE !== "true") {
    return Response.json({ error: "Local trace access is disabled." }, { status: 404 });
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
