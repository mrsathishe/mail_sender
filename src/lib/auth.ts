import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { signToken, verifyToken, type SessionPayload } from "./jwt";
import { connectDB } from "./db";
import { User } from "@/models/User";

const COOKIE_NAME = "session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await signToken(payload);
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

// Authoritative admin gate for /api/admin/* routes. The JWT role claim (used by
// middleware) is a fast edge check only — here we re-read the DB so a stale token
// or a since-disabled account cannot act as admin.
export async function requireAdmin(): Promise<
  { ok: true; session: SessionPayload } | { ok: false; response: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  await connectDB();
  const user = await User.findById(session.userId).select("role disabled").lean();
  if (!user || user.role !== "admin" || user.disabled) {
    return { ok: false, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true, session };
}
