import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { App } from "@/models/App";
import { User } from "@/models/User";
import { SendLog, type SendLogKind, type SendLogStatus } from "@/models/SendLog";
import { hashSecret } from "@/lib/secret";
import { buildEmailBody, sanitizeSubject, findReplyTo } from "@/lib/flatten";
import { orderSubmission, resolveFields, validateSubmission } from "@/lib/fields";
import { checkBotSignals, resolveSpamGuard, splitGuardFields } from "@/lib/bot-guard";
import { checkSubmissionContent } from "@/lib/spam-score";
import {
  ATTACHMENT_MAX_TOTAL_BYTES,
  checkAttachments,
  resolveAttachmentConfig,
} from "@/lib/attachments";
import { autoReplyParts, resolveAutoResponder } from "@/lib/auto-responder";
import { claimSubmission, releaseSubmission } from "@/lib/dedupe";
import { consumeDailySend } from "@/lib/send-limit";
import { MAX_BODY_BYTES, declaredTooLarge, readLimitedBody } from "@/lib/body-limit";
import { renderAutoReplyHtml, renderEmailHtml } from "@/lib/templates";
import { corsJson } from "@/lib/cors";
import { sendMail } from "@/lib/mailer";

// The submission pipeline behind the public send endpoint (SPEC §4).
//
// One endpoint takes JSON and multipart alike. Whether file parts are kept, and whether
// the 5MB cap applies instead of the 500KB one, is decided by the **app's** own
// `attachments.enabled` — never by which URL was called. There used to be a second route
// for uploads, because nginx's client_max_body_size is per-location and only that path
// was raised; the cost was that switching the setting on was not enough on its own, since
// the owner also had to change the URL their form posted to. The edge cap now sits on the
// one send location (deploy/nginx.conf) and the per-app cap below is what distinguishes
// the two allowances.
//
// It lives in lib/ rather than in the route file because this is the ordered part: drift
// in this order (guards before quota, dedupe before quota, body read after auth) is a
// security bug rather than a cosmetic one.

/**
 * The label the email gives the row listing attached files. It cannot collide with a
 * declared field because FIELD_NAME_RE (fields.ts) forbids spaces, so no app can ever
 * have declared it — which is what lets the row be appended without touching the field
 * contract or any of the five designs.
 */
const ATTACHMENTS_ROW = "Attached files";

function bearer(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : null;
}

export async function handleSend(req: Request) {
  // 0. Refuse an obviously oversized post before spending a DB round trip on it.
  // The real enforcement is inside readLimitedBody, which counts received bytes —
  // content-length is only a hint the client controls (HARDENING_ROADMAP §1.3). The bound
  // here has to be the most *any* app could allow, because whose app this is isn't known
  // until the key is looked up; the app's own cap is applied at the read below.
  if (declaredTooLarge(req.headers, ATTACHMENT_MAX_TOTAL_BYTES)) {
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

  // 3. Collect the posted data, bounded in total bytes. Deliberately after auth, so an
  // unauthenticated caller never gets us to buffer anything at all — and after the app is
  // loaded, which is what makes the raised cap per-app rather than per-endpoint: a key
  // belonging to an app that never enabled uploads still cannot make us buffer 5MB.
  //
  // `keepFiles` is unconditional so a file posted to an app with uploads switched off
  // still reaches checkAttachments and is refused by name. Dropping it here instead would
  // deliver the submission as though nothing had been attached — a silent half-failure
  // nobody can debug, and the one this endpoint exists to remove.
  const attachmentConfig = resolveAttachmentConfig(app.attachments);
  const cap = attachmentConfig.enabled ? ATTACHMENT_MAX_TOTAL_BYTES : MAX_BODY_BYTES;
  const body = await readLimitedBody(req, { maxBytes: cap, keepFiles: true });
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

  // 3g. Judge the attachments. Placed here for three reasons: after the field contract,
  // so a file part never has to be declared as a form field; after the content score, so
  // an attacker-chosen filename cannot push a real submission over the spam threshold;
  // and before the claim and the quota, so — like both guards above — a refused file
  // costs the owner nothing.
  const files = checkAttachments(attachmentConfig, body.files);
  if (!files.ok) {
    await logSend(app, "blocked_attachment", `${files.error}: ${files.detail}`);
    return corsJson({ error: files.error, file: files.file }, { status: 422 });
  }

  // 3e. Suppress an accidental repeat (HARDENING_ROADMAP §2.5). Before the quota, so
  // a double-clicked submit button costs the customer nothing, and answered `200`
  // because the submission the caller asked to deliver *was* delivered. The file bytes
  // are part of the identity: the same message with a different attachment is a
  // different submission.
  const claim = await claimSubmission(
    String(app._id),
    data,
    files.attachments.map((a) => a.content)
  );
  if (!claim.fresh) {
    return corsJson({ ok: true, duplicate: true }, { status: 200 });
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

  // 4. Build message — the app's chosen design, with a plain-text alternative. The
  // attachment row is appended for rendering only, so every design lists what came with
  // the submission (a client that hides attachments would otherwise show nothing) and
  // flatten's existing array handling escapes it — no design has to know about files.
  const rendered =
    files.summary.length > 0 ? { ...data, [ATTACHMENTS_ROW]: files.summary } : data;
  const subject = sanitizeSubject(`New submission from ${app.websiteName}`);
  const text = buildEmailBody(rendered);
  const html = renderEmailHtml(app.templateId, rendered, { websiteName: app.websiteName });
  // Replying to the notification should reach whoever filled the form, not us. Read from
  // the submission as posted, not from `data`: that is keyed by the owner's labels now,
  // and "Where can we reach you?" is not a name findReplyTo can recognise, while the
  // declared id (`email`) is exactly what it looks for.
  const replyTo = findReplyTo(split.submission);

  // 5. Send to the app's configured destination, logging the outcome either way.
  try {
    await sendMail({
      to: app.destinationEmail,
      subject,
      text,
      html,
      replyTo,
      attachments: files.attachments,
    });
  } catch (err) {
    // Free the idempotency claim: leaving it would answer a legitimate retry with
    // `200` while no mail had ever gone out. The quota slot stays spent — a failed
    // attempt still cost a provider interaction.
    await releaseSubmission(claim.key);
    // Keep the provider's own words — "sendMail threw" is undiagnosable when a
    // customer reports missing mail (HARDENING_ROADMAP §2.2). A message the provider
    // refused for its size arrives here too, which is why nothing special is done
    // about attachment size beyond our own cap.
    await logSend(app, "smtp_failed", describeSmtpError(err));
    return corsJson({ error: "smtp_failed" }, { status: 502 });
  }

  await logSend(app, "sent");

  // 6. Acknowledge the submitter, if the owner asked for it (SPEC §4e). Everything
  // about this is deliberately after the `200` is earned: it is a second email with
  // its own quota slot, its own log row, and no ability to change the caller's
  // result — the submission was delivered whether or not the courtesy reply was.
  await sendAutoReply(app, replyTo);

  // `200`, not `202`: the route awaits the provider before answering, so by the time a
  // caller reads this the mail really has gone out — `202 Accepted` would promise less
  // than actually happened.
  return corsJson({ ok: true }, { status: 200 });
}

// The two ids are the real ObjectId, not `unknown`: they are written straight into
// SendLog's ObjectId fields, and mongoose's create() types reject a widened id.
// templateId/autoResponder stay loose on purpose — their resolvers own the parsing.
type AppLike = {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
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
 *
 * It deliberately takes no `attachments` argument. Echoing the submitter's own file
 * back to an unproven address would double what a submission costs the shared mailbox
 * and would hand a leaked key a way to have us mail a chosen file to a chosen address.
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
