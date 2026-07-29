import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { getSession, createSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/auth/refresh-session — re-issue the session cookie from what the DB
// actually says. Needed because middleware's `emailVerified` check is a claim in a
// 7-day token: an account verified (or grandfathered) after its cookie was minted
// would otherwise keep being sent to /verify-email with nothing left to verify.
// Deliberately cannot grant anything the DB doesn't already say.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await connectDB();
  const user = await User.findById(session.userId).select("email role disabled emailVerified").lean();
  if (!user || user.disabled) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await createSession({
    userId: session.userId,
    email: user.email,
    role: user.role === "admin" ? "admin" : "user",
    emailVerified: Boolean(user.emailVerified),
  });

  return NextResponse.json({ ok: true, emailVerified: Boolean(user.emailVerified) });
}
