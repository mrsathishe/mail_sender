import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { connectDB } from "@/lib/db";
import { App } from "@/models/App";
import { getSession } from "@/lib/auth";
import { issueDestinationOtp } from "@/lib/verification-mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/apps/[id]/resend-verification — email a fresh code to one of the
// current user's unconfirmed destinations (the first can be missed or expire).
// Issuing a new code invalidates the previous one and resets the attempt count.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  // Guard before querying: a malformed id would otherwise throw a CastError.
  if (!isValidObjectId(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await connectDB();
  // Scope by userId so a user can only trigger mail for apps they own — otherwise
  // this endpoint is itself a way to send mail to an arbitrary address.
  const app = await App.findOne({ _id: id, userId: session.userId });
  if (!app) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (app.destinationVerified) {
    return NextResponse.json({ error: "already_verified" }, { status: 400 });
  }

  const otp = await issueDestinationOtp(app.destinationEmail, app.websiteName);
  app.destinationOtpHash = otp.codeHash;
  app.destinationOtpExpiresAt = otp.expiresAt;
  app.destinationOtpAttempts = 0;
  await app.save();

  if (!otp.sent) return NextResponse.json({ error: "smtp_failed" }, { status: 502 });
  return NextResponse.json({ ok: true });
}
