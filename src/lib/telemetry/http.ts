import type { MemoryTelemetryTransport } from "@/lib/telemetry/client";

export type MemoryTelemetryHttpTransportOptions = {
  endpoint: string;
  token: string;
  fetch?: typeof fetch;
};

export class MemoryTelemetryHttpError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "MemoryTelemetryHttpError";
    this.status = status;
  }
}

export function createMemoryTelemetryHttpTransport(
  options: MemoryTelemetryHttpTransportOptions
): MemoryTelemetryTransport {
  const endpoint = validEndpoint(options.endpoint);
  const token = options.token.trim();
  if (!token) throw new TypeError("A telemetry ingest token is required.");
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return async (events) => {
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ events })
      });
    } catch {
      throw new MemoryTelemetryHttpError("Memory telemetry could not reach the ingest endpoint.");
    }

    if (!response.ok) {
      throw new MemoryTelemetryHttpError(
        `Memory telemetry ingest rejected the batch (${response.status}).`,
        response.status
      );
    }
  };
}

function validEndpoint(value: string) {
  const endpoint = new URL(value);
  if (!/^https?:$/.test(endpoint.protocol)) {
    throw new TypeError("Telemetry endpoint must use HTTP or HTTPS.");
  }
  return endpoint;
}
