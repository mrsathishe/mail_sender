import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidObjectId } from "mongoose";
import { connectDB } from "@/lib/db";
import { App } from "@/models/App";
import { getSession } from "@/lib/auth";
import { generateSecretKey, hashSecret } from "@/lib/secret";
import { checkOtp } from "@/lib/otp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ code: z.string().min(1).max(32) });

// POST /api/apps/[id]/verify-destination — confirm a destination inbox with the
// code emailed to it. On success the secret key is issued for the first time: the
// hash stored at registration was of a key that was never disclosed, so this is
// what makes the app usable at all.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const { id } = await params;
  // Guard before querying: a malformed id would otherwise throw a CastError.
  if (!isValidObjectId(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await connectDB();
  // Scope by userId so a user can only confirm apps they own.
  const app = await App.findOne({ _id: id, userId: session.userId });
  if (!app) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (app.destinationVerified) {
    return NextResponse.json({ error: "already_verified" }, { status: 400 });
  }

  const result = checkOtp(
    {
      codeHash: app.destinationOtpHash,
      expiresAt: app.destinationOtpExpiresAt,
      attempts: app.destinationOtpAttempts,
    },
    parsed.data.code
  );

  if (result !== "ok") {
    if (result === "invalid") {
      app.destinationOtpAttempts = (app.destinationOtpAttempts ?? 0) + 1;
      await app.save();
    }
    return NextResponse.json({ error: result }, { status: 400 });
  }

  const secretKey = generateSecretKey();
  app.destinationVerified = true;
  app.destinationOtpHash = null;
  app.destinationOtpExpiresAt = null;
  app.destinationOtpAttempts = 0;
  app.secretKeyHash = hashSecret(secretKey);
  await app.save();

  return NextResponse.json({
    id: String(app._id),
    websiteName: app.websiteName,
    destinationEmail: app.destinationEmail,
    destinationVerified: true,
    secretKey, // shown once — never retrievable again
  });
}
