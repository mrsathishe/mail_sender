import { NextResponse, type NextRequest } from "next/server";
import { verifyToken } from "@/lib/jwt";

// Next 16's replacement for the `middleware.ts` convention: same request hook, but
// the file must be named `proxy` and export a function called `proxy`, and it always
// runs on the Node.js runtime — a `runtime` segment export here is a build error.
// "Proxy" is Next's name for this hook and has nothing to do with the nginx reverse
// proxy in front of the app; the two only meet in `redirectTo` below.

// Build an absolute redirect to `pathname` on the PUBLIC origin. Behind a
// reverse proxy, req.nextUrl reports the app's internal bind address
// (localhost:3100), so redirects built from it send the browser to the wrong
// place. Prefer the forwarded host/proto headers nginx sets.
function redirectTo(req: NextRequest, pathname: string) {
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    req.nextUrl.host;
  const proto =
    req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(/:$/, "");
  return NextResponse.redirect(new URL(pathname, `${proto}://${host}`));
}

// Gate authed areas: no valid session cookie → redirect to /login.
// An authenticated but unverified account is bounced to /verify-email until it
// enters the OTP (SPEC §3a). This claim is safe to trust here in only one
// direction: it never goes true → false, and verifying re-mints the cookie, so a
// stale token can only under-privilege. Actions that send mail re-read the DB via
// requireVerifiedUser().
// /admin/* additionally requires the admin role claim — cheap because it reads the
// cookie and nothing else; /api/admin/* routes re-verify against the DB. That split
// is what the two layers buy, and it holds regardless of which runtime this runs on.
// /docs is deliberately NOT gated — it must stay readable by anyone (including
// AI agents handed the URL), so the page itself hides the session-only parts.
export async function proxy(req: NextRequest) {
  const token = req.cookies.get("session")?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session) {
    return redirectTo(req, "/login");
  }
  if (!session.emailVerified) {
    return redirectTo(req, "/verify-email");
  }
  if (req.nextUrl.pathname.startsWith("/admin") && session.role !== "admin") {
    return redirectTo(req, "/dashboard");
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"],
};
