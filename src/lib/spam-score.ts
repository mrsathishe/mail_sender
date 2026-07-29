// Content spam scoring for /v1/send (HARDENING_ROADMAP §4.5, SPEC §4d).
//
// Under a permanently shared sender (§0) spam relayed *to* a customer still leaves
// our IP and our domain, so a complaint about it is our problem even though the
// delivery was "legitimate" — the destination asked for form submissions, not for
// link-farm pitches. There is no tier to move a bad sender to, so this and the bot
// signals in ./bot-guard are the only content defences that will ever exist.
//
// The scoring is deliberately weighted toward **structure over vocabulary**. A
// missed spam is one unwanted email; a false positive is a lost customer enquiry
// that nobody ever learns about, which is the same asymmetry that makes dedupe fail
// open. So keyword hits are capped below the threshold on purpose: they can only
// amplify a structural signal (link volume, anchor markup, header probes), never
// block on their own — an SEO agency's own contact form legitimately receives
// "we need backlinks and guest posts".

import { env } from "./env";

export type SpamVerdict = { score: number; reasons: string[] };

/** Weights, in one place so the arithmetic is readable against the threshold. */
const W = {
  linksFew: 2, // 3–4 links
  linksMany: 4, // 5–7
  linksFlood: 6, // 8+ — a contact form never has a legitimate reason
  markup: 3, // anchor tags or BBCode: not something a human types into a textarea
  headerProbe: 3, // "bcc:" / "content-type:" — a mail-injection probe, not prose
  keyword: 2, // amplifier only
  keywordCap: 3, // ...capped below the threshold on purpose
  shouting: 1,
} as const;

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']{3,}/gi;
// Anchor tags and BBCode links. Values are escaped before they reach the email, so
// this is not an injection risk — it is a signal that the text was machine-written.
const MARKUP_RE = /<a\s[^>]*href|\[url[=\]]|\[link[=\]]/i;
// A line that opens with a mail header is a classic injection probe. `To:` is
// deliberately absent — "To: whom it may concern" is something a human writes.
const HEADER_PROBE_RE = /^\s*(?:bcc|cc|content-type|mime-version)\s*:/im;

// Narrow and unambiguous on purpose — each phrase is one a real enquiry would have
// to work hard to contain, and no single hit (nor two) can reach the threshold.
const KEYWORDS = [
  "viagra",
  "cialis",
  "casino",
  "porn",
  "escort service",
  "payday loan",
  "buy backlinks",
  "guest post",
  "seo services",
  "rank higher on google",
  "bitcoin investment",
  "crypto investment",
  "forex signals",
  "make money fast",
  "work from home opportunity",
  "increase your traffic",
  "clone of your website",
];

/** Collect every string in the submission — nested values included. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) strings(v, out);
  }
  return out;
}

function countLinks(text: string): number {
  return (text.match(URL_RE) ?? []).length;
}

// "Shouting" only counts on a long value: a short all-caps answer ("YES", a country
// code, a name typed in caps) is normal, a 40-character shout is not.
function isShouting(text: string): boolean {
  if (text.length < 40) return false;
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 20) return false;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length >= 0.7;
}

/**
 * Score a submission. Pure and synchronous — the caller decides what to do with the
 * verdict, and `reasons` is what gets logged so a blocked send can be explained to
 * the owner (and the weights re-tuned from real traffic).
 */
export function scoreSubmission(data: Record<string, unknown>): SpamVerdict {
  const values = strings(data);
  const joined = values.join("\n");
  const lower = joined.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  const links = countLinks(joined);
  if (links >= 8) {
    score += W.linksFlood;
    reasons.push(`${links} links`);
  } else if (links >= 5) {
    score += W.linksMany;
    reasons.push(`${links} links`);
  } else if (links >= 3) {
    score += W.linksFew;
    reasons.push(`${links} links`);
  }

  if (MARKUP_RE.test(joined)) {
    score += W.markup;
    reasons.push("link markup");
  }

  if (HEADER_PROBE_RE.test(joined)) {
    score += W.headerProbe;
    reasons.push("mail header probe");
  }

  const hits = KEYWORDS.filter((word) => lower.includes(word));
  if (hits.length > 0) {
    score += Math.min(hits.length * W.keyword, W.keywordCap);
    reasons.push(`keywords: ${hits.slice(0, 3).join(", ")}`);
  }

  if (values.some(isShouting)) {
    score += W.shouting;
    reasons.push("shouting");
  }

  return { score, reasons };
}

export type SpamCheck = { ok: true } | { ok: false; detail: string };

/**
 * Apply the configured threshold. Separate from `scoreSubmission` so the scoring
 * stays pure and testable, and so the threshold is read once per request from env
 * (`SPAM_SCORE_THRESHOLD`) rather than baked into a constant.
 */
export function checkSubmissionContent(data: Record<string, unknown>): SpamCheck {
  const threshold = env.spamScoreThreshold;
  const verdict = scoreSubmission(data);
  if (verdict.score < threshold) return { ok: true };
  return {
    ok: false,
    detail: `score ${verdict.score}/${threshold}: ${verdict.reasons.join("; ")}`.slice(0, 500),
  };
}
