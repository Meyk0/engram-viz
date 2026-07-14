export class RequestBodyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413
  ) {
    super(message);
    this.name = "RequestBodyError";
  }
}

export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RequestBodyError("Request body is too large.", 413);
  }

  const raw = await request.text().catch(() => "");
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new RequestBodyError("Request body is too large.", 413);
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new RequestBodyError("Request body must be valid JSON.", 400);
  }
}
