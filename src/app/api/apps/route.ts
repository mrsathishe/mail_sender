import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { App } from "@/models/App";
import { getSession } from "@/lib/auth";
import { generateSecretKey, hashSecret } from "@/lib/secret";
import { DEFAULT_TEMPLATE_ID, TEMPLATE_IDS, resolveTemplateId } from "@/lib/templates";

export const runtime = "nodejs";

// GET /api/apps — list the current user's apps (never returns the secret).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await connectDB();
  const apps = await App.find({ userId: session.userId })
    .sort({ createdAt: -1 })
    .select("websiteName destinationEmail templateId createdAt")
    .lean();

  return NextResponse.json({
    apps: apps.map((a) => ({
      id: String(a._id),
      websiteName: a.websiteName,
      destinationEmail: a.destinationEmail,
      // .lean() skips schema defaults, so apps predating templates resolve here.
      templateId: resolveTemplateId(a.templateId),
      createdAt: a.createdAt,
    })),
  });
}

const createSchema = z.object({
  websiteName: z.string().min(1).max(100),
  destinationEmail: z.string().email(),
  templateId: z.enum(TEMPLATE_IDS).default(DEFAULT_TEMPLATE_ID),
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
    destinationEmail: parsed.data.destinationEmail.toLowerCase(),
    templateId: parsed.data.templateId,
    secretKeyHash: hashSecret(secretKey),
  });

  return NextResponse.json(
    {
      id: String(app._id),
      websiteName: app.websiteName,
      destinationEmail: app.destinationEmail,
      templateId: app.templateId,
      secretKey, // shown once — never retrievable again
    },
    { status: 201 }
  );
}
