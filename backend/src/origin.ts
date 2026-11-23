// Does a request come from our own page? Browsers send the Origin header with every WebSocket
// upgrade and every POST, and a page of another site cannot fake it. Checked for the live
// connection (live/gateway.ts) and for the requests that use the session cookie (auth/router.ts).
//
// origin and host are the request's headers. The page's own host is always allowed,
// allowedOrigins adds others (WS_ALLOWED_ORIGINS). A request without Origin is not from a
// browser page and is allowed: such a client has no cookies of a signed-in user.
export function isAllowedOrigin(
  origin: string | undefined,
  host: string | undefined,
  allowedOrigins: readonly string[]
): boolean {
  if (origin === undefined) return true;
  if (!host) return false;

  try {
    const parsedOrigin = new URL(origin);

    if (
      !['http:', 'https:'].includes(parsedOrigin.protocol) ||
      parsedOrigin.username ||
      parsedOrigin.password ||
      parsedOrigin.pathname !== '/' ||
      parsedOrigin.search ||
      parsedOrigin.hash ||
      parsedOrigin.origin === 'null'
    ) {
      return false;
    }

    // Allow the page's own host.
    if (parsedOrigin.host.toLowerCase() === host.toLowerCase()) {
      return true;
    }

    // Allow explicitly configured additional origins.
    return allowedOrigins.some((allowed) => {
      try {
        return new URL(allowed).origin === parsedOrigin.origin;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}
