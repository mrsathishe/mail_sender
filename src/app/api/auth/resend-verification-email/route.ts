import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { getSession } from "@/lib/auth";
import { issueAccountOtp } from "@/lib/verification-mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/auth/resend-verification-email — issue a fresh registration code for
// the signed-in account, invalidating the previous one.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await connectDB();
  const user = await User.findById(session.userId);
  if (!user || user.disabled) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (user.emailVerified) {
    return NextResponse.json({ error: "already_verified" }, { status: 400 });
  }

  const otp = await issueAccountOtp(user.email);
  user.emailOtpHash = otp.codeHash;
  user.emailOtpExpiresAt = otp.expiresAt;
  // Reset the counter: a new code deserves a fresh set of attempts, and the old
  // hash is gone so previous guesses are meaningless.
  user.emailOtpAttempts = 0;
  await user.save();

  if (!otp.sent) return NextResponse.json({ error: "smtp_failed" }, { status: 502 });
  return NextResponse.json({ ok: true });
}
