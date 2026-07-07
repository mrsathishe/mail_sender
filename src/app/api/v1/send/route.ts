import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { App } from "@/models/App";
import { hashSecret } from "@/lib/secret";
import { buildEmailBody, sanitizeSubject } from "@/lib/flatten";
import { sendMail } from "@/lib/mailer";

// Must run on the Node.js runtime — Nodemailer opens an SMTP socket, which the
// Edge runtime cannot do (SPEC §6).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearer(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : null;
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const type = req.headers.get("content-type") || "";
  try {
    if (type.includes("application/json")) {
      const parsed = await req.json();
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    }
    if (type.includes("form")) {
      const form = await req.formData();
      const out: Record<string, unknown> = {};
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") out[key] = value; // files deferred (SPEC §8)
      }
      return out;
    }
  } catch {
    return null;
  }
  return null;
}

export async function POST(req: Request) {
  // 1. Secret key
  const key = bearer(req);
  if (!key) return NextResponse.json({ error: "invalid_key" }, { status: 401 });

  // 2. Verify against a registered app
  await connectDB();
  const app = await App.findOne({ secretKeyHash: hashSecret(key) });
  if (!app) return NextResponse.json({ error: "invalid_key" }, { status: 401 });

  // 3. Collect the posted data
  const data = await readBody(req);
  if (!data || Object.keys(data).length === 0) {
    return NextResponse.json({ error: "empty_or_invalid_body" }, { status: 400 });
  }

  // 4. Build message
  const subject = sanitizeSubject(`New submission from ${app.websiteName}`);
  const text = buildEmailBody(data);

  // 5. Send to the configured destination Gmail
  try {
    await sendMail({ to: app.destinationGmail, subject, text });
  } catch {
    return NextResponse.json({ error: "smtp_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true }, { status: 202 });
}
