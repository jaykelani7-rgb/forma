/** Next may build Request.url with its listening hostname rather than the
 * browser's host. Compare Origin against the actual HTTP Host, never an
 * arbitrary forwarded host. The reverse proxy must preserve the public Host. */
export function sameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const incoming = new URL(request.url);
    const host = request.headers.get("host") ?? incoming.host;
    const expected = new URL(`${incoming.protocol}//${host}`);
    if (expected.host !== host.toLowerCase()) return false;
    return new URL(origin).origin === expected.origin;
  } catch {
    return false;
  }
}
