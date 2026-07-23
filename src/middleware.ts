import { NextResponse, type NextRequest } from "next/server";
import { verifyToken } from "@/lib/jwt";

// Gate authed areas: no valid session cookie → redirect to /login.
// /admin/* additionally requires the admin role claim (a cheap edge check;
// /api/admin/* routes re-verify against the DB).
export async function middleware(req: NextRequest) {
  const token = req.cookies.get("session")?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (req.nextUrl.pathname.startsWith("/admin") && session.role !== "admin") {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"],
};
