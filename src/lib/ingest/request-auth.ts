import {
  authenticateTelemetryRequest,
  parseTelemetryIngestKeys,
  TelemetryIngestAuthConfigurationError
} from "@/lib/ingest/auth";
import type { TelemetryTenantContext } from "@/lib/ingest/types";

export function authenticateConfiguredIngestRequest(request: Request):
  | { context: TelemetryTenantContext }
  | { response: Response } {
  try {
    const keys = parseTelemetryIngestKeys();
    if (keys.length === 0) {
      throw new TelemetryIngestAuthConfigurationError("Telemetry ingest is not configured.");
    }
    const context = authenticateTelemetryRequest(request, keys);
    if (!context) return { response: Response.json({ error: "Telemetry credentials are invalid." }, { status: 401 }) };
    return { context };
  } catch (error) {
    const message = error instanceof TelemetryIngestAuthConfigurationError
      ? "Telemetry ingest is not configured."
      : "Telemetry credentials could not be verified.";
    return { response: Response.json({ error: message }, { status: 503 }) };
  }
}
