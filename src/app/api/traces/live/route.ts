import { createHash } from "node:crypto";
import {
  authenticateTelemetryRequest,
  parseTelemetryIngestKeys,
  TelemetryIngestAuthConfigurationError
} from "@/lib/ingest/auth";
import type { TelemetryTenantContext } from "@/lib/ingest/types";
import { liveTraceHub } from "@/lib/traces/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 512_000;
const CHANNEL_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const encoder = new TextEncoder();

export async function GET(request: Request) {
  const cors = corsHeaders(request);
  const access = authorizeLegacyRequest(request);
  if (access.response) return withHeaders(access.response, cors);

  const channelId = readChannelId(request);
  if (!channelId) return jsonError("A valid live recorder channel is required.", 400, cors);
  const scopedChannelId = scopeChannelId(channelId, access.context);

  let unsubscribe: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("retry: 1500\n\n"));
      unsubscribe = liveTraceHub.subscribe(scopedChannelId, (snapshot) => {
        const publicSnapshot = { ...snapshot, channelId };
        controller.enqueue(encoder.encode(`event: trace\ndata: ${JSON.stringify(publicSnapshot)}\n\n`));
      });
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(": heartbeat\n\n")), 15_000);
    },
    cancel() {
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    }
  });

  const headers = new Headers(cors);
  headers.set("Cache-Control", "no-cache, no-transform");
  headers.set("Content-Type", "text/event-stream");
  headers.set("Connection", "keep-alive");
  headers.set("X-Accel-Buffering", "no");
  return new Response(stream, { headers });
}

export async function POST(request: Request) {
  const cors = corsHeaders(request);
  const access = authorizeLegacyRequest(request);
  if (access.response) return withHeaders(access.response, cors);

  const channelId = readChannelId(request);
  if (!channelId) return jsonError("A valid live recorder channel is required.", 400, cors);
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return jsonError("Live recorder payload is too large.", 413, cors);
  }

  const raw = await request.text().catch(() => "");
  if (encoder.encode(raw).byteLength > MAX_REQUEST_BYTES) {
    return jsonError("Live recorder payload is too large.", 413, cors);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError("Live recorder payload must be valid JSON.", 400, cors);
  }
  if (!isRecord(body)) return jsonError("Live recorder payload must be an object.", 400, cors);
  if (!claimsMatchContext(body, access.context)) {
    return jsonError("Live recorder payload claims a different tenant or project.", 403, cors);
  }
  const items = Array.isArray(body.items) ? body.items : "item" in body ? [body.item] : [];
  if (items.length === 0 || items.length > 100) {
    return jsonError("Send between 1 and 100 trace items.", 400, cors);
  }

  try {
    const snapshot = liveTraceHub.append(scopeChannelId(channelId, access.context), items);
    return Response.json({
      accepted: items.length,
      itemCount: snapshot.itemCount,
      stepCount: snapshot.trace.steps.length,
      memoryEventCount: snapshot.trace.steps.reduce(
        (count, step) => count + step.memoryMappings.filter((mapping) => mapping.event).length,
        0
      )
    }, { headers: cors });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Live trace could not be recorded.", 400, cors);
  }
}

export function OPTIONS(request: Request) {
  const cors = corsHeaders(request);
  const availability = checkLegacyAvailability();
  if (availability) return withHeaders(availability, cors);
  return new Response(null, { status: 204, headers: cors });
}

function authorizeLegacyRequest(request: Request): {
  context?: TelemetryTenantContext;
  response?: Response;
} {
  const availability = checkLegacyAvailability();
  if (availability) return { response: availability };

  try {
    const keys = parseTelemetryIngestKeys();
    if (keys.length === 0) {
      if (!claimsMatchContext(new URL(request.url).searchParams)) {
        return { response: jsonError("Live recorder tenant and project claims require authentication.", 403) };
      }
      return {};
    }
    const context = authenticateTelemetryRequest(request, keys);
    if (!context) return { response: jsonError("Live recorder credentials are invalid.", 401) };
    if (!claimsMatchContext(new URL(request.url).searchParams, context)) {
      return { response: jsonError("Live recorder request claims a different tenant or project.", 403) };
    }
    return { context };
  } catch (error) {
    if (error instanceof TelemetryIngestAuthConfigurationError) {
      return { response: jsonError("Live recorder authentication is not configured correctly.", 503) };
    }
    return { response: jsonError("Live recorder credentials could not be verified.", 503) };
  }
}

function checkLegacyAvailability() {
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && process.env.ENGRAM_LEGACY_LIVE_RECORDER_ENABLED !== "true") {
    return jsonError("Legacy live recorder is disabled.", 404);
  }

  try {
    const keys = parseTelemetryIngestKeys();
    if (isProduction && keys.length === 0) {
      return jsonError("Legacy live recorder authentication is not configured.", 503);
    }
  } catch (error) {
    if (error instanceof TelemetryIngestAuthConfigurationError) {
      return jsonError("Live recorder authentication is not configured correctly.", 503);
    }
    return jsonError("Live recorder availability could not be verified.", 503);
  }
}

function readChannelId(request: Request) {
  const channelId = new URL(request.url).searchParams.get("channel") ?? "";
  return CHANNEL_PATTERN.test(channelId) ? channelId : undefined;
}

function scopeChannelId(channelId: string, context?: TelemetryTenantContext) {
  if (!context) return channelId;
  const scope = createHash("sha256")
    .update(`${context.tenantId}\0${context.projectId}`, "utf8")
    .digest("hex");
  return `${scope}:${channelId}`;
}

function claimsMatchContext(
  claims: Record<string, unknown> | URLSearchParams,
  context?: TelemetryTenantContext
) {
  const tenantIds = claims instanceof URLSearchParams
    ? claims.getAll("tenantId")
    : claims.tenantId == null ? [] : [claims.tenantId];
  const projectIds = claims instanceof URLSearchParams
    ? claims.getAll("projectId")
    : claims.projectId == null ? [] : [claims.projectId];
  if (!context) return tenantIds.length === 0 && projectIds.length === 0;
  return tenantIds.every((tenantId) => tenantId === context.tenantId)
    && projectIds.every((projectId) => projectId === context.projectId);
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  const allowedOrigins = new Set(
    (process.env.ENGRAM_INGEST_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Engram-Transport": "legacy-ephemeral"
  });
  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  return headers;
}

function jsonError(message: string, status: number, headers?: Headers) {
  return Response.json({ error: message }, { status, headers });
}

function withHeaders(response: Response, headers: Headers) {
  const merged = new Headers(response.headers);
  headers.forEach((value, key) => merged.set(key, value));
  return new Response(response.body, { status: response.status, headers: merged });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
