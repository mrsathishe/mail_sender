import { DailyUsage } from "@/models/DailyUsage";
import { env } from "./env";

// Per-app daily send limit (SPEC §4c, HARDENING_ROADMAP §1.2).
//
// One leaked or looping key is otherwise unbounded volume against a single shared
// mailbox — and a throttled mailbox takes down every app *plus* our own OTP and
// password-reset mail, since they share the account. The published figure is 500 a
// day per app, which a real contact form never approaches.
//
// The number lives in env (`SEND_APP_DAILY_LIMIT`, default 500) so raising it for a
// busy customer is a `.env` edit and a restart, not a release. It is read there and
// nowhere else, so the docs and this check can never quote different figures.

/** UTC day key. Must match everywhere, so the timezone is fixed rather than local. */
export function usageDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export type LimitResult =
  | { ok: true; used: number; limit: number }
  | { ok: false; used: number; limit: number };

/**
 * Count one send against the app's day and report whether it was allowed.
 *
 * Increment **then** compare: checking first and incrementing after lets two
 * concurrent requests both read `499` and both pass. A refused request has therefore
 * already consumed a slot, and that slot is deliberately left consumed — when the
 * downside of being wrong is the sending account getting suspended, biasing toward
 * under-sending is correct.
 *
 * Fails **closed**: if the counter can't be read or written we don't know how much
 * has been sent today, and guessing "none" is how an allowance gets blown through.
 */
export async function consumeDailySend(
  appId: string,
  now: Date = new Date()
): Promise<LimitResult> {
  const limit = env.appDailySendLimit;
  const date = usageDateKey(now);
  // Expire a day after the bucket closes — long enough to still be readable while
  // diagnosing a limit complaint, short enough to never accumulate.
  const expiresAt = new Date(now.getTime() + 2 * 86_400_000);

  const doc = await DailyUsage.findOneAndUpdate(
    { appId, date },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
    { upsert: true, new: true }
  ).lean();

  const used = doc?.count ?? 1;
  return used > limit ? { ok: false, used, limit } : { ok: true, used, limit };
}

/**
 * Today's count without touching it — for the owner's own activity panel (SPEC §4f).
 * A missing row means nothing has been sent today, which is a real answer here, so
 * unlike `consumeDailySend` this reads zero rather than failing closed.
 */
export async function peekDailySend(
  appId: string,
  now: Date = new Date()
): Promise<{ used: number; limit: number }> {
  const limit = env.appDailySendLimit;
  const doc = await DailyUsage.findOne({ appId, date: usageDateKey(now) }).select("count").lean();
  return { used: doc?.count ?? 0, limit };
}
