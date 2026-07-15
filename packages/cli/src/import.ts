import { readFile } from "node:fs/promises";
import { parseAgentTurnEnvelope, parseMemoryTelemetryEvent } from "@engramviz/core";
import type { EngramLocalConfig } from "./config.js";

export type EngramCaptureBundle = {
  format: "engram.capture";
  version: 1;
  telemetry: unknown[];
  turns: unknown[];
};

export async function importCaptureBundle(
  file: string,
  options: { endpoint: string; config: EngramLocalConfig; fetch?: typeof fetch }
) {
  const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
  if (!isRecord(raw) || raw.format !== "engram.capture" || raw.version !== 1) {
    throw new Error("Capture must use the engram.capture v1 format.");
  }
  const telemetry = Array.isArray(raw.telemetry) ? raw.telemetry.map(parseMemoryTelemetryEvent) : [];
  const turns = Array.isArray(raw.turns) ? raw.turns.map(parseAgentTurnEnvelope) : [];
  if (telemetry.length === 0 && turns.length === 0) throw new Error("Capture contains no telemetry or turns.");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const headers = { Authorization: `Bearer ${options.config.token}`, "Content-Type": "application/json" };
  if (telemetry.length > 0) {
    const response = await fetchImpl(new URL("/api/telemetry/v2", options.endpoint), {
      method: "POST", headers, body: JSON.stringify({ events: telemetry })
    });
    if (!response.ok) throw new Error(`Telemetry import failed (${response.status}).`);
  }
  for (const turn of turns) {
    const response = await fetchImpl(new URL("/api/turns/v1", options.endpoint), {
      method: "POST", headers, body: JSON.stringify(turn)
    });
    if (!response.ok) throw new Error(`Turn import failed (${response.status}).`);
  }
  return { telemetry: telemetry.length, turns: turns.length };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
