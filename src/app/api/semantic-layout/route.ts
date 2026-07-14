import { buildSemanticLayout, canonicalizeSemanticMemories } from "@/lib/semantic/layout";
import { OpenAIEmbeddingsClient } from "@/lib/semantic/openai-embeddings";
import { getSemanticLayoutProviderConfig } from "@/lib/semantic/provider-config";
import {
  MAX_SEMANTIC_REQUEST_BYTES,
  semanticLayoutErrorSchema,
  semanticLayoutRequestSchema,
  semanticLayoutSnapshotSchema
} from "@/lib/semantic/schema";
import { semanticMemoryText } from "@/lib/semantic/text";
import type { SemanticLayoutRequest } from "@/lib/semantic/types";
import { createRequestDeadline } from "@/lib/request-signal";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const limited = checkApiRateLimit(request, { scope: "semantic-layout", limit: 20 });
  if (limited) return limited;

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_SEMANTIC_REQUEST_BYTES) {
    return errorResponse("Semantic layout request is too large.", 413);
  }

  const rawBody = await request.text().catch(() => "");
  if (new TextEncoder().encode(rawBody).byteLength > MAX_SEMANTIC_REQUEST_BYTES) {
    return errorResponse("Semantic layout request is too large.", 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse("Semantic layout request must be valid JSON.", 400);
  }

  const parsedRequest = semanticLayoutRequestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return errorResponse("Semantic layout request failed validation.", 400);
  }

  const deadline = createRequestDeadline(request.signal, 30_000);
  try {
    const snapshot = await createConfiguredLayout(parsedRequest.data, deadline.signal);
    return Response.json(semanticLayoutSnapshotSchema.parse(snapshot));
  } catch {
    return errorResponse("Semantic layout generation failed.", 500);
  } finally {
    deadline.dispose();
  }
}

async function createConfiguredLayout(request: SemanticLayoutRequest, signal?: AbortSignal) {
  const config = getSemanticLayoutProviderConfig();
  if (config.provider === "openai" && config.apiKey && config.model) {
    try {
      const memories = canonicalizeSemanticMemories(request.memories);
      const client = new OpenAIEmbeddingsClient({ apiKey: config.apiKey, model: config.model });
      const embeddings = await client.embed(memories.map(semanticMemoryText), signal);
      const vectors = new Map(memories.map((memory, index) => [memory.id, embeddings[index]!] as const));
      return buildSemanticLayout(request, {
        provider: "openai",
        model: config.model,
        vectors
      });
    } catch {
      signal?.throwIfAborted();
      // Provider failures are intentionally contained; Reality Mode remains available offline.
    }
  }

  return buildSemanticLayout(request, { provider: "lexical-fallback" });
}

function errorResponse(message: string, status: number) {
  return Response.json(semanticLayoutErrorSchema.parse({ error: message }), { status });
}
