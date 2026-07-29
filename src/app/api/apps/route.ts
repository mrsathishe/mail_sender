import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { App } from "@/models/App";
import { getSession, requireVerifiedUser } from "@/lib/auth";
import { generateSecretKey, hashSecret } from "@/lib/secret";
import { issueDestinationOtp } from "@/lib/verification-mail";
import { DEFAULT_TEMPLATE_ID, TEMPLATE_IDS, resolveTemplateId } from "@/lib/templates";
import { DEFAULT_FIELDS, parseFields, resolveFields } from "@/lib/fields";
import { resolveSpamGuard } from "@/lib/bot-guard";
import { resolveAutoResponder } from "@/lib/auto-responder";

export const runtime = "nodejs";

// GET /api/apps — list the current user's apps (never returns the secret).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await connectDB();
  const apps = await App.find({ userId: session.userId })
    .sort({ createdAt: -1 })
    .select(
      "websiteName destinationEmail destinationVerified templateId fields spamGuard autoResponder createdAt"
    )
    .lean();

  return NextResponse.json({
    apps: apps.map((a) => ({
      id: String(a._id),
      websiteName: a.websiteName,
      destinationEmail: a.destinationEmail,
      // .lean() skips schema defaults, so apps predating the field read as false.
      destinationVerified: Boolean(a.destinationVerified),
      // .lean() skips schema defaults, so apps predating templates resolve here.
      templateId: resolveTemplateId(a.templateId),
      // Same reason: an app stored before fields existed reads back as the default set.
      fields: resolveFields(a.fields),
      // Same again — an app registered before the guards reads back as "off".
      spamGuard: resolveSpamGuard(a.spamGuard),
      autoResponder: resolveAutoResponder(a.autoResponder),
      createdAt: a.createdAt,
    })),
  });
}

const createSchema = z.object({
  websiteName: z.string().min(1).max(100),
  destinationEmail: z.string().email(),
  templateId: z.enum(TEMPLATE_IDS).default(DEFAULT_TEMPLATE_ID),
  // Shape only — the names themselves are checked by parseFields, which owns the
  // rules and reports which rule was broken.
  fields: z.array(z.object({ name: z.string(), required: z.boolean().optional() })).optional(),
});

// POST /api/apps — register an app.
//
// Two outcomes, decided by the destination address:
//   * the owner's own (already verified) email → confirmed immediately, secret key
//     returned once, as before;
//   * anyone else's → an OTP is emailed to that address and NO key is returned
//     until it is entered (SPEC §3e).
export async function POST(req: Request) {
  // Registering an app makes us send mail to a caller-chosen address, so the
  // account's own email must be proven first.
  const gate = await requireVerifiedUser();
  if (!gate.ok) return gate.response;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // Omitting `fields` is normal: it means "the usual contact form".
  let fields = DEFAULT_FIELDS;
  if (parsed.data.fields) {
    const result = parseFields(parsed.data.fields);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    fields = result.fields;
  }

  const destinationEmail = parsed.data.destinationEmail.toLowerCase();
  // Compare against the DB email, not the form's checkbox — the client can't be
  // trusted to tell us that these match.
  const isOwnEmail = destinationEmail === gate.email.toLowerCase();

  const secretKey = generateSecretKey();

  await connectDB();
  const app = await App.create({
    userId: gate.session.userId,
    websiteName: parsed.data.websiteName,
    destinationEmail,
    templateId: parsed.data.templateId,
    fields,
    destinationVerified: isOwnEmail,
    secretKeyHash: hashSecret(secretKey),
  });

  if (isOwnEmail) {
    return NextResponse.json(
      {
        id: String(app._id),
        websiteName: app.websiteName,
        destinationEmail: app.destinationEmail,
        destinationVerified: true,
        otpRequired: false,
        templateId: app.templateId,
        fields,
        secretKey, // shown once — never retrievable again
      },
      { status: 201 }
    );
  }

  // Unconfirmed destination: mail the code and drop `secretKey` on the floor. The
  // stored hash therefore matches a key nobody has, so the app cannot send until
  // verification rotates it — a property of the data, not just of the 403 gate.
  const otp = await issueDestinationOtp(app.destinationEmail, app.websiteName);
  app.destinationOtpHash = otp.codeHash;
  app.destinationOtpExpiresAt = otp.expiresAt;
  app.destinationOtpAttempts = 0;
  await app.save();

  return NextResponse.json(
    {
      id: String(app._id),
      websiteName: app.websiteName,
      destinationEmail: app.destinationEmail,
      destinationVerified: false,
      otpRequired: true,
      codeSent: otp.sent,
      templateId: app.templateId,
      fields,
    },
    { status: 201 }
  );
}
