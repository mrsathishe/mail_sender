import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { readLimitedBody } from "@/lib/body-limit";
import { checkBotSignals, splitGuardFields, type SpamGuard } from "@/lib/bot-guard";
import { checkSubmissionContent } from "@/lib/spam-score";
import { claimSubmission, releaseSubmission } from "@/lib/dedupe";
import { buildEmailBody, findReplyTo, sanitizeSubject } from "@/lib/flatten";
import { DEFAULT_TEMPLATE_ID, renderEmailHtml } from "@/lib/templates";
import { sendMail } from "@/lib/mailer";
import { BRAND_FULL, CONTACT_EMAIL } from "@/lib/brand";

// Our own help form (/contact). Deliberately *not* part of the public API — it is
// unauthenticated, so it gets the same guards `/v1/send` uses, in the same order, and
// nothing more is invented here (HARDENING_ROADMAP §1.2 item 4).
//
// Same runtime pin as /v1/send: Nodemailer opens an SMTP socket, which Edge cannot do.
export const runtime = "nodejs";

// One form, ours, so the guard field names are fixed where an app's are the owner's
// choice — there is nothing to enumerate across tenants. A determined bot will still
// learn these two names, which is why the content score and the claims below are what
// actually bound the damage.
const GUARD: SpamGuard = {
  honeypotField: "company_url",
  timingField: "elapsed_ms",
  minSubmitSeconds: 3,
};

const schema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(200),
    subject: z.string().trim().max(160).optional(),
    message: z.string().trim().min(10).max(5000),
  })
  .strict();

/** Behind nginx the socket address is 127.0.0.1 — the real client is in a header. */
function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip");
  if (real?.trim()) return real.trim();
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  // No proxy header at all (dev, or a misconfigured one): everybody shares a bucket,
  // which throttles rather than opens. For a form this quiet that is the safe way to
  // be wrong.
  return "unknown";
}

export async function POST(req: Request) {
  await connectDB();

  // The per-client claim is taken **before** the body is read, unlike /v1/send where a
  // secret key has already vouched for the caller. This route is open to anyone, so a
  // throttle applied after the read would only start working once we had already
  // buffered the thing it exists to prevent.
  //
  // It is released below whenever the failure looks like a person making a mistake — an
  // unreadable body, a mistyped email — so a slip never costs a minute's wait. It is
  // deliberately *kept* when the failure looks automated (honeypot, fill time, spam
  // score), because throttling that caller is the entire point.
  const ip = await claimSubmission("contact-ip", { ip: clientIp(req.headers) });
  if (!ip.fresh) return NextResponse.json({ error: "too_many_requests" }, { status: 429 });

  // Default cap, and file parts dropped: this form takes text only, so there is nothing
  // here that needs the reader's raised allowance.
  const body = await readLimitedBody(req);
  if (!body.ok) {
    await releaseSubmission(ip.key);
    const status = body.error === "payload_too_large" ? 413 : 400;
    return NextResponse.json({ error: body.error }, { status });
  }

  // Guard fields are stripped before validation, so the honeypot never has to be
  // declared and never reaches the email.
  const split = splitGuardFields(GUARD, body.data);
  const bot = checkBotSignals(GUARD, split);
  if (!bot.ok) return NextResponse.json({ error: bot.error }, { status: 422 });

  const parsed = schema.safeParse(split.submission);
  if (!parsed.success) {
    await releaseSubmission(ip.key);
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // Keyed by the label each row is printed under, which is the contract lib/flatten
  // now expects (an app's rows are keyed by its declared labels — lib/fields).
  const data: Record<string, unknown> = {
    Name: parsed.data.name,
    Email: parsed.data.email,
    Subject: parsed.data.subject ?? "",
    Message: parsed.data.message,
  };

  const content = checkSubmissionContent(data);
  if (!content.ok) return NextResponse.json({ error: "spam_rejected" }, { status: 422 });

  // One 60-second claim per body as well as the per-client one above, so a
  // double-clicked submit is answered as the request it already is.
  const claim = await claimSubmission("contact", data);
  if (!claim.fresh) return NextResponse.json({ ok: true, duplicate: true });

  try {
    await sendMail({
      to: CONTACT_EMAIL,
      subject: sanitizeSubject(
        parsed.data.subject
          ? `[contact] ${parsed.data.subject}`
          : `[contact] Message from ${parsed.data.name}`
      ),
      text: buildEmailBody(data),
      html: renderEmailHtml(DEFAULT_TEMPLATE_ID, data, {
        websiteName: `${BRAND_FULL} — contact form`,
      }),
      // The sender's own address, so replying from the inbox reaches them. `From:`
      // stays ours, as everywhere else.
      replyTo: findReplyTo(data),
    });
  } catch {
    // Release both claims: a failed send must not leave a retry answered as a
    // duplicate, nor make the sender wait out the throttle for a message we lost.
    await Promise.all([releaseSubmission(claim.key), releaseSubmission(ip.key)]);
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
