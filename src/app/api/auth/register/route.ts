import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { hashPassword } from "@/lib/password";
import { createSession } from "@/lib/auth";
import { issueAccountOtp } from "@/lib/verification-mail";

// Nodemailer needs a socket for the verification code.
export const runtime = "nodejs";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  await connectDB();
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return NextResponse.json({ error: "email_taken" }, { status: 409 });
  }

  const user = await User.create({
    email: email.toLowerCase(),
    passwordHash: await hashPassword(password),
  });

  // Email the OTP the account needs to become usable. A session is still issued,
  // but with emailVerified false it reaches only /verify-email.
  const otp = await issueAccountOtp(user.email);
  user.emailOtpHash = otp.codeHash;
  user.emailOtpExpiresAt = otp.expiresAt;
  user.emailOtpAttempts = 0;
  await user.save();

  await createSession({
    userId: user._id.toString(),
    email: user.email,
    role: "user",
    emailVerified: false,
  });
  return NextResponse.json({ ok: true, codeSent: otp.sent }, { status: 201 });
}
