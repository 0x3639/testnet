function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export function configuredPublicOrigin(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = environment.PUBLIC_BASE_URL?.trim();
  if (!raw) {
    if (environment.NODE_ENV === "production") {
      throw new Error("PUBLIC_BASE_URL must be set in production.");
    }
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("PUBLIC_BASE_URL must be a valid absolute URL.");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PUBLIC_BASE_URL must contain only an HTTP(S) origin without credentials, path, query, or fragment.");
  }
  if (environment.NODE_ENV === "production" && url.protocol !== "https:" && !isLoopbackHost(url.hostname)) {
    throw new Error("PUBLIC_BASE_URL must use HTTPS in production unless it is loopback-only.");
  }
  return url.origin;
}
