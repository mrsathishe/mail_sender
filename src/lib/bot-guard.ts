// Bot signals for /v1/send: a honeypot field and a minimum fill time
// (HARDENING_ROADMAP §4.4, SPEC §4d).
//
// This is the cheap tier of spam defence — it costs one string comparison and one
// subtraction, and it catches the naive bots that make up most automated form
// traffic, before anything more expensive (content scoring, captcha) is needed.
//
// Both signals are **per app** and off by default. The honeypot's *name* is the
// customer's own choice on purpose: one platform-wide reserved name is a name every
// bot author can learn once and skip forever, whereas `mobile_2` on one site and
// `company_url` on another cannot be enumerated.
//
// Guard fields are deliberately **not** part of the app's declared field list
// (SPEC §4b): they are stripped from the submission before the contract is checked,
// so a honeypot never has to be declared, never reaches the email, and never shifts
// the destination inbox's layout.

export type SpamGuard = {
  /** Field that must arrive empty or absent. `null` = no honeypot. */
  honeypotField: string | null;
  /** Field carrying how long the form was on screen. `null` = no timing check. */
  timingField: string | null;
  /** Minimum seconds between render and submit. `0` = off. */
  minSubmitSeconds: number;
};

export const SPAM_GUARD_OFF: SpamGuard = {
  honeypotField: null,
  timingField: null,
  minSubmitSeconds: 0,
};

/**
 * A human cannot read a form and fill it in under a second, and no legitimate
 * integration needs to wait a minute — past that the setting would only reject real
 * visitors who type fast.
 */
export const MAX_MIN_SUBMIT_SECONDS = 60;

// Same rule as a declared field name (fields.ts): these are HTML `name` attributes
// too, so the two sets must be spellable the same way.
const GUARD_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

export type SpamGuardError = "invalid_guard_field" | "invalid_min_seconds" | "timing_field_missing";

export type ParseGuardResult =
  | { ok: true; guard: SpamGuard }
  | { ok: false; error: SpamGuardError };

/**
 * Validate an owner-supplied guard config. Empty strings mean "off" rather than
 * being an error, because that is what an emptied input posts.
 */
export function parseSpamGuard(input: unknown): ParseGuardResult {
  if (!input || typeof input !== "object") return { ok: false, error: "invalid_guard_field" };
  const { honeypotField, timingField, minSubmitSeconds } = input as Record<string, unknown>;

  const honeypot = optionalName(honeypotField);
  if (honeypot === false) return { ok: false, error: "invalid_guard_field" };
  const timing = optionalName(timingField);
  if (timing === false) return { ok: false, error: "invalid_guard_field" };

  const seconds = minSubmitSeconds === undefined || minSubmitSeconds === null || minSubmitSeconds === ""
    ? 0
    : Number(minSubmitSeconds);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_MIN_SUBMIT_SECONDS) {
    return { ok: false, error: "invalid_min_seconds" };
  }
  // A minimum with no field to measure against would silently never fire, which
  // reads as "the guard is on" while nothing is checked.
  if (seconds > 0 && !timing) return { ok: false, error: "timing_field_missing" };

  // The same name in both roles would make one signal shadow the other.
  if (honeypot && timing && honeypot.toLowerCase() === timing.toLowerCase()) {
    return { ok: false, error: "invalid_guard_field" };
  }

  return {
    ok: true,
    guard: { honeypotField: honeypot, timingField: timing, minSubmitSeconds: seconds },
  };
}

// `false` = present but unusable; `null` = deliberately off.
function optionalName(value: unknown): string | null | false {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return GUARD_NAME_RE.test(trimmed) ? trimmed : false;
}

/** Apps stored before the guard existed, or a `.lean()` read that skipped defaults. */
export function resolveSpamGuard(value: unknown): SpamGuard {
  if (!value || typeof value !== "object") return SPAM_GUARD_OFF;
  const raw = value as Record<string, unknown>;
  const honeypotField = typeof raw.honeypotField === "string" && raw.honeypotField.trim() !== ""
    ? raw.honeypotField.trim()
    : null;
  const timingField = typeof raw.timingField === "string" && raw.timingField.trim() !== ""
    ? raw.timingField.trim()
    : null;
  const seconds = Number(raw.minSubmitSeconds);
  const minSubmitSeconds =
    Number.isInteger(seconds) && seconds > 0 && timingField
      ? Math.min(seconds, MAX_MIN_SUBMIT_SECONDS)
      : 0;
  return { honeypotField, timingField, minSubmitSeconds };
}

export function guardIsOn(guard: SpamGuard): boolean {
  return guard.honeypotField !== null || guard.minSubmitSeconds > 0;
}

export type GuardSplit = {
  /** The submission with guard fields removed — what the field contract sees. */
  submission: Record<string, unknown>;
  honeypot: unknown;
  timing: unknown;
};

/**
 * Take the guard fields out of the posted body. Matched case-insensitively, like
 * declared fields, so a client that capitalises differently is still understood.
 */
export function splitGuardFields(
  guard: SpamGuard,
  data: Record<string, unknown>
): GuardSplit {
  if (guard.honeypotField === null && guard.timingField === null) {
    return { submission: data, honeypot: undefined, timing: undefined };
  }
  const honeypotKey = guard.honeypotField?.toLowerCase();
  const timingKey = guard.timingField?.toLowerCase();

  const submission: Record<string, unknown> = {};
  let honeypot: unknown;
  let timing: unknown;
  for (const [key, value] of Object.entries(data)) {
    const lower = key.toLowerCase();
    if (honeypotKey && lower === honeypotKey) honeypot = value;
    else if (timingKey && lower === timingKey) timing = value;
    else submission[key] = value;
  }
  return { submission, honeypot, timing };
}

export type BotSignal = "honeypot_filled" | "too_fast" | "timing_missing";

export type BotCheck = { ok: true } | { ok: false; error: BotSignal; detail: string };

/**
 * Judge the two signals. Called before the field contract, because it is the
 * cheapest check and needs no knowledge of the app's fields.
 */
export function checkBotSignals(guard: SpamGuard, split: GuardSplit): BotCheck {
  if (guard.honeypotField !== null && !isBlank(split.honeypot)) {
    // Never echo the submitted value: it is attacker-controlled and ends up in a log.
    return {
      ok: false,
      error: "honeypot_filled",
      detail: `honeypot ${guard.honeypotField} was not empty`,
    };
  }

  if (guard.minSubmitSeconds > 0) {
    const elapsed = elapsedMs(split.timing);
    if (elapsed === null) {
      return {
        ok: false,
        error: "timing_missing",
        detail: `no usable value in ${guard.timingField}`,
      };
    }
    // A negative elapsed time means the client's clock runs ahead of ours, which is
    // common and is not evidence of a bot — fail open rather than reject a real
    // visitor over clock skew.
    const requiredMs = guard.minSubmitSeconds * 1000;
    if (elapsed >= 0 && elapsed < requiredMs) {
      return {
        ok: false,
        error: "too_fast",
        detail: `submitted after ${elapsed}ms, minimum ${requiredMs}ms`,
      };
    }
  }

  return { ok: true };
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0 || value.every(isBlank);
  return false;
}

// Anything ≥ 1e9 is a point in time rather than a duration: 1e9 milliseconds is 11
// days, which no form sits open for, while 1e9 *seconds* is 2001 — so a 10-digit
// value is epoch seconds and a 13-digit one epoch milliseconds. Below that it is an
// elapsed duration in milliseconds, which is what a `Date.now() - renderedAt` in the
// page produces and is immune to a wrong client clock.
const EPOCH_FLOOR = 1e9;
const EPOCH_MS_FLOOR = 1e11;

/**
 * Milliseconds between the form being rendered and submitted, from whatever shape
 * the client sent: an elapsed duration, an epoch stamp in seconds or milliseconds,
 * or an ISO date string. `null` when nothing usable arrived.
 */
export function elapsedMs(value: unknown, now: number = Date.now()): number | null {
  if (typeof value === "number") return fromNumber(value, now);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  // An empty value is a missing one — that is what an untouched hidden input posts.
  if (trimmed === "") return null;
  if (Number.isNaN(Number(trimmed))) {
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : now - parsed;
  }
  return fromNumber(Number(trimmed), now);
}

function fromNumber(n: number, now: number): number | null {
  if (!Number.isFinite(n) || n < 0) return null;
  if (n >= EPOCH_MS_FLOOR) return now - n;
  if (n >= EPOCH_FLOOR) return now - n * 1000;
  return n;
}
