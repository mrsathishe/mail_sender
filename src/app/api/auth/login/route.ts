import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { verifyPassword } from "@/lib/password";
import { createSession } from "@/lib/auth";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  await connectDB();
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  await createSession({ userId: user._id.toString(), email: user.email });
  return NextResponse.json({ ok: true });
}
