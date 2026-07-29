// The autoresponder: a "we got your message" reply to whoever filled the form
// (HARDENING_ROADMAP §4.2, SPEC §4e).
//
// Opt-in per app, and the text is the **owner's**: nothing the submitter posted is
// echoed back. That is the whole safety property here, because unlike the submission
// email — which only ever goes to a destination that confirmed itself (§3e) — this
// one goes to an address chosen by whoever posted the form. Owner-authored text means
// a leaked key can pick the recipient but never the words, so the worst case is a
// stranger receiving one acknowledgement from a site they didn't contact, bounded by
// the app's daily quota (SPEC §4c) and the 60s duplicate window.
//
// It doubles the sends per submission, which is why it consumes its own quota slot
// rather than riding along on the submission's.

import { sanitizeSubject } from "./flatten";
import { BRAND_FULL } from "./brand";

export type AutoResponder = { enabled: boolean; subject: string; message: string };

export const AUTO_SUBJECT_MAX = 150;
export const AUTO_MESSAGE_MAX = 2000;

export const AUTO_RESPONDER_OFF: AutoResponder = { enabled: false, subject: "", message: "" };

/**
 * Empty subject/message mean "use the wording below" — storing the default text
 * instead would freeze a copy of it in every app document, so an improvement to the
 * wording would never reach the apps that never edited it.
 */
export function defaultAutoSubject(websiteName: string): string {
  return `Thanks for contacting ${websiteName}`;
}

export function defaultAutoMessage(websiteName: string): string {
  return (
    `Thanks for getting in touch — we've received your message and someone from ` +
    `${websiteName} will get back to you soon.\n\n` +
    `This is an automatic confirmation, so there's nothing else you need to do.`
  );
}

export type AutoResponderError = "invalid_auto_reply" | "auto_reply_too_long";

export type ParseAutoResponderResult =
  | { ok: true; autoResponder: AutoResponder }
  | { ok: false; error: AutoResponderError };

/** Validate an owner-supplied config. Blank fields fall back to the defaults above. */
export function parseAutoResponder(input: unknown): ParseAutoResponderResult {
  if (!input || typeof input !== "object") return { ok: false, error: "invalid_auto_reply" };
  const { enabled, subject, message } = input as Record<string, unknown>;

  if (subject !== undefined && subject !== null && typeof subject !== "string") {
    return { ok: false, error: "invalid_auto_reply" };
  }
  if (message !== undefined && message !== null && typeof message !== "string") {
    return { ok: false, error: "invalid_auto_reply" };
  }

  // CR/LF out of the subject here as well as at send time: it lands in a header, and
  // a stored newline would otherwise look fine in the dashboard and be stripped later.
  const cleanSubject = typeof subject === "string" ? sanitizeSubject(subject) : "";
  const cleanMessage = typeof message === "string" ? message.trim() : "";
  if (cleanSubject.length > AUTO_SUBJECT_MAX || cleanMessage.length > AUTO_MESSAGE_MAX) {
    return { ok: false, error: "auto_reply_too_long" };
  }

  return {
    ok: true,
    autoResponder: {
      enabled: Boolean(enabled),
      subject: cleanSubject,
      message: cleanMessage,
    },
  };
}

/** Apps stored before the autoresponder existed, or a `.lean()` read. */
export function resolveAutoResponder(value: unknown): AutoResponder {
  if (!value || typeof value !== "object") return AUTO_RESPONDER_OFF;
  const raw = value as Record<string, unknown>;
  return {
    enabled: Boolean(raw.enabled),
    subject: typeof raw.subject === "string" ? raw.subject : "",
    message: typeof raw.message === "string" ? raw.message : "",
  };
}

export type AutoReplyParts = { subject: string; message: string; text: string };

/**
 * The subject, the resolved owner text, and the plain-text part. The HTML part is
 * `renderAutoReplyHtml()` in ./templates, composed by the caller — same split as the
 * submission email, so this module never imports design markup and can therefore be
 * read by the dashboard's client editor for its length limits.
 */
export function autoReplyParts(opts: {
  autoResponder: AutoResponder;
  websiteName: string;
}): AutoReplyParts {
  const subject = sanitizeSubject(
    opts.autoResponder.subject || defaultAutoSubject(opts.websiteName)
  );
  const message = opts.autoResponder.message || defaultAutoMessage(opts.websiteName);

  const text =
    `${message}\n\n—\n` +
    `You received this automatic reply because this address was used to submit the ` +
    `form on ${opts.websiteName}; a reply to this message goes to them. ` +
    `Sent by ${BRAND_FULL}.`;

  return { subject, message, text };
}
