import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseMemoryExecutorManifest,
  parseMemoryExecutorReplayRequest,
  parseMemoryExecutorReplayResult,
  type MemoryReplayExecutor
} from "@engramviz/core";

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const DEFAULT_REPLAY_TIMEOUT_MS = 120_000;

export type MemoryExecutorServer = {
  url: string;
  close: () => Promise<void>;
};

export async function loadMemoryReplayExecutor(file: string, cwd = process.cwd()): Promise<MemoryReplayExecutor> {
  const absolute = path.resolve(cwd, file);
  const exports = await import(`${pathToFileURL(absolute).href}?engram=${Date.now()}`) as Record<string, unknown>;
  const candidate = exports.executor ?? exports.default;
  if (!isRecord(candidate) || typeof candidate.replay !== "function") {
    throw new Error(`Executor module ${absolute} must export a MemoryReplayExecutor as default or "executor".`);
  }
  const manifest = parseMemoryExecutorManifest(candidate.manifest);
  return { manifest, replay: candidate.replay as MemoryReplayExecutor["replay"] };
}

export async function startMemoryExecutorServer(options: {
  executor: MemoryReplayExecutor;
  token: string;
  port: number;
  hostname?: "127.0.0.1" | "::1";
  replayTimeoutMs?: number;
}): Promise<MemoryExecutorServer> {
  const manifest = parseMemoryExecutorManifest(options.executor.manifest);
  const token = options.token.trim();
  if (!token) throw new Error("The executor server requires an authentication token.");
  const hostname = options.hostname ?? "127.0.0.1";
  const replayTimeoutMs = options.replayTimeoutMs ?? DEFAULT_REPLAY_TIMEOUT_MS;
  const server = createServer(async (request, response) => {
    setSecurityHeaders(response);
    if (!authorized(request, token)) {
      respondJson(response, 401, { error: "Unauthorized." });
      return;
    }
    if (request.method === "GET" && request.url === "/v1/manifest") {
      respondJson(response, 200, manifest);
      return;
    }
    if (request.method === "POST" && request.url === "/v1/replay") {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error(`Replay exceeded ${replayTimeoutMs}ms.`)),
        replayTimeoutMs
      );
      request.once("aborted", () => controller.abort(new Error("Replay request was aborted.")));
      try {
        const envelope = parseMemoryExecutorReplayRequest(await readJson(request));
        if (!manifest.sideEffects.supportedModes.includes(envelope.sideEffectMode)) {
          respondJson(response, 400, { error: `Side-effect mode ${envelope.sideEffectMode} is not supported.` });
          return;
        }
        const result = parseMemoryExecutorReplayResult(await options.executor.replay(envelope.request, {
          sideEffectMode: envelope.sideEffectMode,
          signal: controller.signal
        }));
        respondJson(response, 200, result);
      } catch (error) {
        const status = error instanceof PayloadTooLargeError ? 413 : error instanceof SyntaxError ? 400 : 422;
        respondJson(response, status, { error: safeError(error) });
      } finally {
        clearTimeout(timeout);
      }
      return;
    }
    respondJson(response, 404, { error: "Not found." });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, hostname, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return {
    url: `http://${hostname === "::1" ? "[::1]" : hostname}:${port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

async function readJson(request: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new PayloadTooLargeError();
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function authorized(request: IncomingMessage, token: string) {
  return request.headers.authorization === `Bearer ${token}`;
}

function respondJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function setSecurityHeaders(response: ServerResponse) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
}

function safeError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.slice(0, 2_000);
  return "The executor could not complete the replay.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class PayloadTooLargeError extends Error {
  constructor() {
    super(`Executor request exceeds ${MAX_BODY_BYTES} bytes.`);
  }
}
