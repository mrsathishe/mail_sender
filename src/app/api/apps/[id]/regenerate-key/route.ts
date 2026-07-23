import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { App } from "@/models/App";
import { getSession } from "@/lib/auth";
import { generateSecretKey, hashSecret } from "@/lib/secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/apps/[id]/regenerate-key — issue a NEW secret key for one of the
// current user's apps. The old key stops working immediately. The new key is
// returned ONCE (only its hash is stored), same as at registration.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  await connectDB();
  // Scope by userId so a user can only rotate keys for apps they own.
  const app = await App.findOne({ _id: id, userId: session.userId });
  if (!app) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const secretKey = generateSecretKey();
  app.secretKeyHash = hashSecret(secretKey);
  await app.save();

  return NextResponse.json({
    id: String(app._id),
    websiteName: app.websiteName,
    secretKey, // shown once — never retrievable again
  });
}
