import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { hashPassword } from "@/lib/password";
import { createSession } from "@/lib/auth";

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

  await createSession({ userId: user._id.toString(), email: user.email });
  return NextResponse.json({ ok: true }, { status: 201 });
}
