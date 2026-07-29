import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { getSession, createSession } from "@/lib/auth";
import { checkOtp } from "@/lib/otp";

export const runtime = "nodejs";

const schema = z.object({ code: z.string().min(1).max(32) });

// POST /api/auth/verify-email — finish registration by entering the emailed code.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  await connectDB();
  const user = await User.findById(session.userId);
  if (!user || user.disabled) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (user.emailVerified) return NextResponse.json({ ok: true });

  const result = checkOtp(
    {
      codeHash: user.emailOtpHash,
      expiresAt: user.emailOtpExpiresAt,
      attempts: user.emailOtpAttempts,
    },
    parsed.data.code
  );

  if (result !== "ok") {
    // Count the wrong guess; the cap is what keeps an 8-char code safe.
    if (result === "invalid") {
      user.emailOtpAttempts = (user.emailOtpAttempts ?? 0) + 1;
      await user.save();
    }
    return NextResponse.json({ error: result }, { status: 400 });
  }

  user.emailVerified = true;
  user.emailOtpHash = null;
  user.emailOtpExpiresAt = null;
  user.emailOtpAttempts = 0;
  await user.save();

  // Re-mint the cookie so the edge check stops redirecting to /verify-email —
  // the claim in the old token is now stale.
  await createSession({
    userId: user._id.toString(),
    email: user.email,
    role: user.role === "admin" ? "admin" : "user",
    emailVerified: true,
  });

  return NextResponse.json({ ok: true });
}
