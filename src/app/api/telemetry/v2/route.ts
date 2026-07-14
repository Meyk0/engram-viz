import { ZodError } from "zod";
import {
  authenticateTelemetryRequest,
  parseTelemetryIngestKeys,
  TelemetryIngestAuthConfigurationError
} from "@/lib/ingest/auth";
import { createMemoryTelemetryStoreFromEnv } from "@/lib/ingest/store";
import type { MemoryTelemetryStore, TelemetryTenantContext } from "@/lib/ingest/types";
import { parseMemoryTelemetryEvent } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 512_000;
const MAX_EVENTS_PER_BATCH = 100;
const MAX_READ_LIMIT = 500;
const encoder = new TextEncoder();

type TelemetryIngestDependencies = {
  store: MemoryTelemetryStore;
  authenticate(request: Request): TelemetryTenantContext | undefined;
};

export function createTelemetryV2Handlers(dependencies: TelemetryIngestDependencies) {
  async function POST(request: Request) {
    const cors = corsHeaders(request);
    const authentication = authenticate(request, dependencies.authenticate);
    if (authentication.response) return withHeaders(authentication.response, cors);
    const context = authentication.context!;

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return jsonError("Telemetry payload is too large.", 413, cors);
    }
    const raw = await request.text().catch(() => "");
    if (encoder.encode(raw).byteLength > MAX_REQUEST_BYTES) {
      return jsonError("Telemetry payload is too large.", 413, cors);
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return jsonError("Telemetry payload must be valid JSON.", 400, cors);
    }
    if (!isRecord(body) || !Array.isArray(body.events)) {
      return jsonError("Telemetry payload must contain an events array.", 400, cors);
    }
    if (body.events.length === 0 || body.events.length > MAX_EVENTS_PER_BATCH) {
      return jsonError(`Send between 1 and ${MAX_EVENTS_PER_BATCH} telemetry events.`, 400, cors);
    }

    try {
      const events = body.events.map((event, index) => {
        if (!isRecord(event)) throw new Error(`Telemetry event ${index + 1} must be an object.`);
        if (event.projectId !== undefined && event.projectId !== context.projectId) {
          throw new CrossProjectTelemetryError(index);
        }
        return parseMemoryTelemetryEvent({ ...event, projectId: context.projectId });
      });
      const result = await dependencies.store.append(context, events);
      return Response.json({
        projectId: context.projectId,
        accepted: result.acceptedEventIds.length,
        duplicates: result.duplicateEventIds.length,
        acceptedEventIds: result.acceptedEventIds,
        duplicateEventIds: result.duplicateEventIds,
        highWaterCursor: result.highWaterCursor
      }, { status: 202, headers: cors });
    } catch (error) {
      if (error instanceof CrossProjectTelemetryError) {
        return jsonError(error.message, 403, cors);
      }
      if (error instanceof ZodError) {
        return jsonError("One or more telemetry events do not match the v2 contract.", 400, cors);
      }
      if (error instanceof Error && error.message.startsWith("Telemetry event ")) {
        return jsonError(error.message, 400, cors);
      }
      return jsonError("Telemetry events could not be stored.", 503, cors);
    }
  }

  async function GET(request: Request) {
    const cors = corsHeaders(request);
    const authentication = authenticate(request, dependencies.authenticate);
    if (authentication.response) return withHeaders(authentication.response, cors);
    const context = authentication.context!;
    const url = new URL(request.url);
    const afterCursor = integerQuery(url.searchParams.get("after"), 0);
    const limit = integerQuery(url.searchParams.get("limit"), 100);
    if (afterCursor < 0 || limit < 1 || limit > MAX_READ_LIMIT) {
      return jsonError(`Use after >= 0 and limit between 1 and ${MAX_READ_LIMIT}.`, 400, cors);
    }

    try {
      const result = await dependencies.store.read(context, { afterCursor, limit });
      return Response.json({
        projectId: context.projectId,
        events: result.events,
        highWaterCursor: result.highWaterCursor,
        hasMore: result.events.length === limit
      }, { headers: cors });
    } catch {
      return jsonError("Telemetry events could not be read.", 503, cors);
    }
  }

  function OPTIONS(request: Request) {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  return { GET, OPTIONS, POST };
}

const globalStore = globalThis as typeof globalThis & {
  __engramMemoryTelemetryStore?: MemoryTelemetryStore;
};
const defaultStore = globalStore.__engramMemoryTelemetryStore ?? createMemoryTelemetryStoreFromEnv();
globalStore.__engramMemoryTelemetryStore = defaultStore;

const handlers = createTelemetryV2Handlers({
  store: defaultStore,
  authenticate(request) {
    const keys = parseTelemetryIngestKeys();
    if (keys.length === 0) {
      throw new TelemetryIngestAuthConfigurationError("Telemetry ingest is not configured.");
    }
    return authenticateTelemetryRequest(request, keys);
  }
});

export const GET = handlers.GET;
export const OPTIONS = handlers.OPTIONS;
export const POST = handlers.POST;

function authenticate(
  request: Request,
  resolver: TelemetryIngestDependencies["authenticate"]
): { context?: TelemetryTenantContext; response?: Response } {
  try {
    const context = resolver(request);
    if (!context) return { response: jsonError("Telemetry credentials are invalid.", 401) };
    return { context };
  } catch (error) {
    if (error instanceof TelemetryIngestAuthConfigurationError) {
      return { response: jsonError("Telemetry ingest is not configured.", 503) };
    }
    return { response: jsonError("Telemetry credentials could not be verified.", 503) };
  }
}

function integerQuery(value: string | null, fallback: number) {
  if (value === null || value === "") return fallback;
  return /^\d+$/.test(value) ? Number(value) : -1;
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  const allowed = new Set(
    (process.env.ENGRAM_INGEST_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Vary": "Origin"
  });
  if (origin && allowed.has(origin)) {
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

class CrossProjectTelemetryError extends Error {
  constructor(index: number) {
    super(`Telemetry event ${index + 1} claims a different project.`);
    this.name = "CrossProjectTelemetryError";
  }
}
