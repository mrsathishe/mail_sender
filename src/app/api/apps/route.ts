import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { App } from "@/models/App";
import { getSession } from "@/lib/auth";
import { generateSecretKey, hashSecret } from "@/lib/secret";

export const runtime = "nodejs";

// GET /api/apps — list the current user's apps (never returns the secret).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await connectDB();
  const apps = await App.find({ userId: session.userId })
    .sort({ createdAt: -1 })
    .select("websiteName destinationGmail createdAt")
    .lean();

  return NextResponse.json({
    apps: apps.map((a) => ({
      id: String(a._id),
      websiteName: a.websiteName,
      destinationGmail: a.destinationGmail,
      createdAt: a.createdAt,
    })),
  });
}

const createSchema = z.object({
  websiteName: z.string().min(1).max(100),
  destinationGmail: z.string().email(),
});

// POST /api/apps — register an app; returns the secret key ONCE.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const secretKey = generateSecretKey();

  await connectDB();
  const app = await App.create({
    userId: session.userId,
    websiteName: parsed.data.websiteName,
    destinationGmail: parsed.data.destinationGmail.toLowerCase(),
    secretKeyHash: hashSecret(secretKey),
  });

  return NextResponse.json(
    {
      id: String(app._id),
      websiteName: app.websiteName,
      destinationGmail: app.destinationGmail,
      secretKey, // shown once — never retrievable again
    },
    { status: 201 }
  );
}
