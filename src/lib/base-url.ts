// Behind nginx the app is bound to 127.0.0.1:3100, so anything derived from the
// request URL reports that internal address. The forwarded headers nginx sets are
// the only reliable source of the public origin (same reason middleware.ts builds
// its redirects this way).
export function baseUrlFrom(h: Headers): string {
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
