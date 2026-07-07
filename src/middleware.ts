import { NextResponse, type NextRequest } from "next/server";
import { verifyToken } from "@/lib/jwt";

// Gate the dashboard: no valid session cookie → redirect to /login.
export async function middleware(req: NextRequest) {
  const token = req.cookies.get("session")?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
