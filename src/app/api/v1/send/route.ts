import { connectDB } from "@/lib/db";
import { App } from "@/models/App";
import { User } from "@/models/User";
import { SendLog, type SendLogKind, type SendLogStatus } from "@/models/SendLog";
import { hashSecret } from "@/lib/secret";
import { buildEmailBody, sanitizeSubject, findReplyTo } from "@/lib/flatten";
import { orderSubmission, resolveFields, validateSubmission } from "@/lib/fields";
import { checkBotSignals, resolveSpamGuard, splitGuardFields } from "@/lib/bot-guard";
import { checkSubmissionContent } from "@/lib/spam-score";
import { autoReplyParts, resolveAutoResponder } from "@/lib/auto-responder";
import { claimSubmission, releaseSubmission } from "@/lib/dedupe";
import { consumeDailySend } from "@/lib/send-limit";
import { declaredTooLarge, readLimitedBody } from "@/lib/body-limit";
import { renderAutoReplyHtml, renderEmailHtml } from "@/lib/templates";
import { corsJson, corsPreflight } from "@/lib/cors";
import { sendMail } from "@/lib/mailer";

// Must run on the Node.js runtime — Nodemailer opens an SMTP socket, which the
// Edge runtime cannot do (SPEC §6).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Customers' forms post from the browser, so the endpoint has to answer the
// preflight before any POST is even attempted (cors.ts).
export function OPTIONS() {
  return corsPreflight();
}

function bearer(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : null;
}

export async function POST(req: Request) {
  // 0. Refuse an obviously oversized post before spending a DB round trip on it.
  // The real enforcement is inside readLimitedBody, which counts received bytes —
  // content-length is only a hint the client controls (HARDENING_ROADMAP §1.3).
  if (declaredTooLarge(req.headers)) {
    return corsJson({ error: "payload_too_large" }, { status: 413 });
  }

  // 1. Secret key
  const key = bearer(req);
  if (!key) return corsJson({ error: "invalid_key" }, { status: 401 });

  // 2. Verify against a registered app
  await connectDB();
  const app = await App.findOne({ secretKeyHash: hashSecret(key) });
  if (!app) return corsJson({ error: "invalid_key" }, { status: 401 });

  // 2b. Reject if the owning account has been disabled by an admin.
  const owner = await User.findById(app.userId).select("disabled").lean();
  if (owner?.disabled) {
    return corsJson({ error: "invalid_key" }, { status: 401 });
  }

  // 2c. Refuse to deliver anywhere the recipient hasn't confirmed — a valid key
  // is proof the app was registered, not that the destination agreed to receive
  // its mail (HARDENING_ROADMAP §1.1).
  if (!app.destinationVerified) {
    return corsJson({ error: "destination_unverified" }, { status: 403 });
  }

  // 3. Collect the posted data, bounded in total bytes. Deliberately after auth,
  // so an unauthenticated caller never gets us to buffer anything at all.
  const body = await readLimitedBody(req);
  if (!body.ok) {
    const status = body.error === "payload_too_large" ? 413 : 400;
    return corsJson({ error: body.error }, { status });
  }

  // 3b. Bot signals first — the cheapest check, and it needs no knowledge of the
  // app's fields (SPEC §4d). The guard's fields are taken out of the submission
  // before anything else sees them, so a honeypot never has to be declared as a form
  // field and never reaches the email.
  const guard = resolveSpamGuard(app.spamGuard);
  const split = splitGuardFields(guard, body.data);
  const bot = checkBotSignals(guard, split);
  if (!bot.ok) {
    await logSend(app, "blocked_bot", `${bot.error}: ${bot.detail}`);
    return corsJson({ error: bot.error }, { status: 422 });
  }

  // 3c. Hold the submission to the fields this app declared (SPEC §4b). Strict on
  // purpose: a valid key proves the request came from the app, not that the payload
  // is the form its owner built, so without this a leaked key mails arbitrary
  // content to the destination. The rejected field name is echoed back because
  // "invalid_input" tells whoever wired the form up nothing about which input to fix.
  const fields = resolveFields(app.fields);
  const check = validateSubmission(fields, split.submission);
  if (!check.ok) {
    return corsJson({ error: check.error, field: check.field }, { status: 400 });
  }
  // Declared order, declared spelling — the destination inbox gets the same rows
  // in the same order regardless of how the client serialised them.
  const data = orderSubmission(fields, split.submission);

  // 3d. Score the content (SPEC §4d). Under a shared sender, spam relayed *to* a
  // customer still leaves our IP, so the complaint is ours even when the delivery was
  // asked for. Weighted toward structure over vocabulary — a false positive is a lost
  // enquiry nobody ever hears about.
  const content = checkSubmissionContent(data);
  if (!content.ok) {
    await logSend(app, "blocked_spam", content.detail);
    return corsJson({ error: "spam_rejected" }, { status: 422 });
  }

  // 3e. Suppress an accidental repeat (HARDENING_ROADMAP §2.5). Before the quota, so
  // a double-clicked submit button costs the customer nothing, and answered `202`
  // because the submission the caller asked to deliver *was* delivered.
  const claim = await claimSubmission(String(app._id), data);
  if (!claim.fresh) {
    return corsJson({ ok: true, duplicate: true }, { status: 202 });
  }

  // 3f. Count it against the app's day (SPEC §4c). Deliberately *after* validation:
  // a customer still wiring their form up shouldn't burn their allowance on requests
  // that were never going to send, and a scripted key sends valid bodies anyway.
  const quota = await consumeDailySend(String(app._id));
  if (!quota.ok) {
    await releaseSubmission(claim.key);
    return corsJson(
      { error: "daily_limit_exceeded", limit: quota.limit },
      { status: 429 }
    );
  }

  // 4. Build message — the app's chosen design, with a plain-text alternative.
  const subject = sanitizeSubject(`New submission from ${app.websiteName}`);
  const text = buildEmailBody(data);
  const html = renderEmailHtml(app.templateId, data, { websiteName: app.websiteName });
  // Replying to the notification should reach whoever filled the form, not us.
  const replyTo = findReplyTo(data);

  // 5. Send to the app's configured destination, logging the outcome either way.
  try {
    await sendMail({ to: app.destinationEmail, subject, text, html, replyTo });
  } catch (err) {
    // Free the idempotency claim: leaving it would answer a legitimate retry with
    // `202` while no mail had ever gone out. The quota slot stays spent — a failed
    // attempt still cost a provider interaction.
    await releaseSubmission(claim.key);
    // Keep the provider's own words — "sendMail threw" is undiagnosable when a
    // customer reports missing mail (HARDENING_ROADMAP §2.2).
    await logSend(app, "smtp_failed", describeSmtpError(err));
    return corsJson({ error: "smtp_failed" }, { status: 502 });
  }

  await logSend(app, "sent");

  // 6. Acknowledge the submitter, if the owner asked for it (SPEC §4e). Everything
  // about this is deliberately after the `202` is earned: it is a second email with
  // its own quota slot, its own log row, and no ability to change the caller's
  // result — the submission was delivered whether or not the courtesy reply was.
  await sendAutoReply(app, replyTo);

  return corsJson({ ok: true }, { status: 202 });
}

type AppLike = {
  _id: unknown;
  userId: unknown;
  websiteName: string;
  destinationEmail: string;
  templateId?: unknown;
  autoResponder?: unknown;
};

/**
 * The autoresponder's "we got your message" reply. Only ever sent to an address found
 * in the submission itself (`findReplyTo`, already header-safe), never to a
 * caller-named recipient, and it carries only the owner's own text — this mail goes
 * somewhere nothing confirmed it wanted mail, unlike the destination inbox.
 */
async function sendAutoReply(app: AppLike, replyTo: string | undefined): Promise<void> {
  const autoResponder = resolveAutoResponder(app.autoResponder);
  if (!autoResponder.enabled || !replyTo) return;

  // Its own slot: an autoresponse doubles what a submission costs the shared mailbox,
  // so it must be counted rather than ride along on the submission's slot. Out of
  // allowance means the courtesy reply is what gets dropped, not the submission.
  const quota = await consumeDailySend(String(app._id));
  if (!quota.ok) return;

  const parts = autoReplyParts({ autoResponder, websiteName: app.websiteName });
  try {
    await sendMail({
      to: replyTo,
      subject: parts.subject,
      text: parts.text,
      html: renderAutoReplyHtml(app.templateId, {
        websiteName: app.websiteName,
        message: parts.message,
      }),
      // A reply to the acknowledgement should reach the site owner, not our mailbox.
      replyTo: app.destinationEmail,
    });
  } catch (err) {
    await logSend(app, "smtp_failed", describeSmtpError(err), "autoresponse");
    return;
  }
  await logSend(app, "sent", undefined, "autoresponse");
}

// Nodemailer surfaces the SMTP conversation on the error: `responseCode` is the
// numeric reply (e.g. 550) and `response` the server's own line. Keep both — they
// are the difference between "mail is missing" and "the recipient rejected it".
function describeSmtpError(err: unknown): string {
  if (!(err instanceof Error)) return String(err).slice(0, 500);
  const e = err as Error & { code?: string; responseCode?: number; response?: string };
  const parts = [e.code, e.responseCode ? String(e.responseCode) : undefined, e.message, e.response]
    .filter(Boolean)
    .join(" | ");
  return parts.slice(0, 500);
}

// Record the attempt for the admin activity view and the owner's own history.
// Never let a logging failure affect the caller's result.
async function logSend(
  app: AppLike,
  status: SendLogStatus,
  error?: string,
  kind: SendLogKind = "submission"
): Promise<void> {
  try {
    await SendLog.create({
      appId: app._id,
      userId: app.userId,
      websiteName: app.websiteName,
      destinationEmail: app.destinationEmail,
      kind,
      status,
      error: error ?? null,
    });
  } catch {
    // swallow — logging is best-effort
  }
}
