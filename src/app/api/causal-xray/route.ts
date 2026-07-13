import {
  CausalAblationProviderError,
  CausalAblationValidationError,
  MAX_CAUSAL_ABLATION_REQUEST_BYTES,
  runCausalAblation
} from "@/lib/evidence/ablation";
import {
  causalAblationRequestSchema,
  causalAblationResultSchema
} from "@/lib/events/schema";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_CAUSAL_ABLATION_REQUEST_BYTES
  ) {
    return errorResponse("Causal X-ray request is too large.", 413);
  }

  const rawBody = await request.text().catch(() => "");
  if (new TextEncoder().encode(rawBody).byteLength > MAX_CAUSAL_ABLATION_REQUEST_BYTES) {
    return errorResponse("Causal X-ray request is too large.", 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse("Causal X-ray request must be valid JSON.", 400);
  }

  const parsedRequest = causalAblationRequestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return errorResponse("Causal X-ray request failed validation.", 400);
  }

  try {
    const result = await runCausalAblation(parsedRequest.data);
    return Response.json(causalAblationResultSchema.parse(result));
  } catch (error) {
    if (error instanceof CausalAblationValidationError) {
      return errorResponse(error.message, 400);
    }
    if (error instanceof CausalAblationProviderError) {
      return errorResponse("Causal X-ray provider replay failed.", 502);
    }
    return errorResponse("Causal X-ray generation failed.", 500);
  }
}

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}
