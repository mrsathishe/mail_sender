import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { App } from "@/models/App";
import { getSession, requireVerifiedUser } from "@/lib/auth";
import { generateSecretKey, hashSecret } from "@/lib/secret";
import { issueDestinationOtp } from "@/lib/verification-mail";
import { DEFAULT_TEMPLATE_ID, TEMPLATE_IDS, resolveTemplateId } from "@/lib/templates";
import { DEFAULT_FIELDS, parseFields, resolveFields } from "@/lib/fields";
import { parseSpamGuard, resolveSpamGuard } from "@/lib/bot-guard";
import { parseAutoResponder, resolveAutoResponder } from "@/lib/auto-responder";
import { parseAttachmentConfig, resolveAttachmentConfig } from "@/lib/attachments";

export const runtime = "nodejs";

// GET /api/apps — list the current user's apps (never returns the secret).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await connectDB();
  const apps = await App.find({ userId: session.userId })
    .sort({ createdAt: -1 })
    .select(
      "websiteName destinationEmail destinationVerified templateId fields spamGuard autoResponder attachments createdAt"
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
      attachments: resolveAttachmentConfig(a.attachments),
      createdAt: a.createdAt,
    })),
  });
}

const createSchema = z.object({
  websiteName: z.string().min(1).max(100),
  destinationEmail: z.email(),
  templateId: z.enum(TEMPLATE_IDS).default(DEFAULT_TEMPLATE_ID),
  // Shape only — the ids and labels themselves are checked by parseFields, which owns
  // the rules and reports which one was broken.
  fields: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  // The three per-app settings, accepted here so the register flow can collect them
  // before the key is issued instead of making a PATCH per panel afterwards. Optional
  // throughout: omitting one leaves the schema default, which is "off".
  spamGuard: z.looseObject({}).optional(),
  autoResponder: z.looseObject({}).optional(),
  attachments: z.looseObject({}).optional(),
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

  // Same rules and the same error codes as PATCH — the parsers own them, so a setting
  // saved at registration is validated exactly as one edited later. Each stays
  // `undefined` when the caller omitted it, so the schema's own "off" default applies
  // rather than a second copy of it written here.
  const settings: Record<string, unknown> = {};
  if (parsed.data.spamGuard !== undefined) {
    const result = parseSpamGuard(parsed.data.spamGuard);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    settings.spamGuard = result.guard;
  }
  if (parsed.data.autoResponder !== undefined) {
    const result = parseAutoResponder(parsed.data.autoResponder);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    settings.autoResponder = result.autoResponder;
  }
  if (parsed.data.attachments !== undefined) {
    const result = parseAttachmentConfig(parsed.data.attachments);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    settings.attachments = result.attachments;
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
    ...settings,
    destinationVerified: isOwnEmail,
    secretKeyHash: hashSecret(secretKey),
  });

  // Read back off the saved document, so an omitted setting is echoed as whatever the
  // schema defaulted it to rather than as the absence the caller sent.
  const saved = {
    spamGuard: resolveSpamGuard(app.spamGuard),
    autoResponder: resolveAutoResponder(app.autoResponder),
    attachments: resolveAttachmentConfig(app.attachments),
  };

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
        ...saved,
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
      ...saved,
    },
    { status: 201 }
  );
}
