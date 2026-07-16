const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);

export function guardLocalModeRequest(
  request: Request,
  environment: NodeJS.ProcessEnv = process.env
): Response | undefined {
  if (environment.ENGRAM_LOCAL_MODE !== "true") return undefined;

  const requestUrl = new URL(request.url);
  const authority = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const hostname = authority ? hostnameFromAuthority(authority) : requestUrl.hostname;
  if (!isLoopbackHostname(hostname) || !isLoopbackHostname(requestUrl.hostname)) {
    return Response.json({ error: "Local Engram Studio accepts only loopback requests." }, { status: 403 });
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (!isLoopbackHostname(new URL(origin).hostname)) {
        return Response.json({ error: "Local Engram Studio rejects non-loopback origins." }, { status: 403 });
      }
    } catch {
      return Response.json({ error: "Local Engram Studio received an invalid origin." }, { status: 403 });
    }
  }

  return undefined;
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().replace(/^\[|\]$/g, "").toLocaleLowerCase();
  return LOOPBACK_HOSTNAMES.has(normalized);
}

function hostnameFromAuthority(authority: string): string {
  try {
    return new URL(`http://${authority}`).hostname;
  } catch {
    return "";
  }
}
