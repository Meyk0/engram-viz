import { ZodError } from "zod";
import { parseAgentTurnEnvelope } from "@engramviz/core";
import { getAgentTurnStore } from "@/lib/ingest/runtime";
import { authenticateConfiguredIngestRequest } from "@/lib/ingest/request-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 320_000;

export async function POST(request: Request) {
  const authentication = authenticateConfiguredIngestRequest(request);
  if ("response" in authentication) return authentication.response;
  const raw = await request.text().catch(() => "");
  if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) {
    return Response.json({ error: "Turn payload is too large." }, { status: 413 });
  }
  try {
    const value = JSON.parse(raw) as unknown;
    const turn = parseAgentTurnEnvelope(value);
    if (turn.projectId !== undefined && turn.projectId !== authentication.context.projectId) {
      return Response.json({ error: "The turn claims a different project." }, { status: 403 });
    }
    const result = await getAgentTurnStore().append(authentication.context, {
      ...turn,
      projectId: authentication.context.projectId
    });
    return Response.json({
      projectId: authentication.context.projectId,
      turnId: turn.turnId,
      duplicate: result.duplicate,
      cursor: result.cursor
    }, { status: result.duplicate ? 200 : 202 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json({ error: "Turn payload must be valid JSON." }, { status: 400 });
    }
    if (error instanceof ZodError) {
      return Response.json({ error: "Turn payload does not match the v1 contract." }, { status: 400 });
    }
    return Response.json({ error: "Turn could not be stored." }, { status: 503 });
  }
}
