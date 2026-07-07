import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { generateResetToken } from "@/lib/secret";
import { sendMail } from "@/lib/mailer";
import { env } from "@/lib/env";

export const runtime = "nodejs";

const schema = z.object({ email: z.string().email() });
const RESET_TTL_MS = 30 * 60 * 1000; // 30 minutes

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  // Neutral response either way — never reveal whether an email is registered.
  const neutral = NextResponse.json({ ok: true });
  if (!parsed.success) return neutral;

  await connectDB();
  const user = await User.findOne({ email: parsed.data.email.toLowerCase() });
  if (!user) return neutral;

  const { token, tokenHash } = generateResetToken();
  user.resetTokenHash = tokenHash;
  user.resetTokenExpiresAt = new Date(Date.now() + RESET_TTL_MS);
  await user.save();

  const link = `${env.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  try {
    await sendMail({
      to: user.email,
      subject: "Reset your Mail Sender password",
      text: `Reset your password using this link (valid 30 minutes):\n\n${link}\n\nIf you didn't request this, ignore this email.`,
    });
  } catch {
    // Swallow send errors so the response stays neutral / non-enumerable.
  }
  return neutral;
}
