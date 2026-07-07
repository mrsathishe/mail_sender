import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { hashResetToken } from "@/lib/secret";
import { hashPassword } from "@/lib/password";

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  await connectDB();
  const user = await User.findOne({
    resetTokenHash: hashResetToken(parsed.data.token),
    resetTokenExpiresAt: { $gt: new Date() },
  });
  if (!user) {
    return NextResponse.json({ error: "invalid_or_expired_token" }, { status: 400 });
  }

  user.passwordHash = await hashPassword(parsed.data.password);
  user.resetTokenHash = null;
  user.resetTokenExpiresAt = null;
  await user.save();

  return NextResponse.json({ ok: true });
}
