import {
  parseMemoryExecutorManifest,
  parseMemoryExecutorReplayRequest,
  parseMemoryExecutorReplayResult,
  type MemoryExecutorReplayRequest
} from "@engramviz/core";

export function localExecutorConfigured() {
  return Boolean(process.env.ENGRAM_EXECUTOR_URL && process.env.ENGRAM_EXECUTOR_TOKEN);
}

export async function readLocalExecutorManifest() {
  const config = executorConfig();
  const response = await fetch(new URL("/v1/manifest", config.url), {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000)
  });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error(readError(payload) ?? "The replay executor is unavailable.");
  return parseMemoryExecutorManifest(payload);
}

export async function runLocalExecutorReplay(input: MemoryExecutorReplayRequest) {
  const config = executorConfig();
  const envelope = parseMemoryExecutorReplayRequest(input);
  const response = await fetch(new URL("/v1/replay", config.url), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(envelope),
    cache: "no-store",
    signal: AbortSignal.timeout(125_000)
  });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error(readError(payload) ?? "The replay executor could not complete the run.");
  return parseMemoryExecutorReplayResult(payload);
}

function executorConfig() {
  const value = process.env.ENGRAM_EXECUTOR_URL;
  const token = process.env.ENGRAM_EXECUTOR_TOKEN?.trim();
  if (!value || !token) throw new Error("No local replay executor is configured.");
  const url = new URL(value);
  if (url.protocol !== "http:" || url.username || url.password || !isLoopback(url.hostname)) {
    throw new Error("ENGRAM_EXECUTOR_URL must be an unauthenticated loopback HTTP URL.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("ENGRAM_EXECUTOR_URL must not include a path, query, or fragment.");
  }
  return { url, token };
}

function isLoopback(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function readError(value: unknown) {
  return typeof value === "object" && value !== null && "error" in value && typeof value.error === "string"
    ? value.error
    : undefined;
}
