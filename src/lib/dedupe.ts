import { createHash } from "crypto";
import { SendDedupe } from "@/models/SendDedupe";

// Duplicate/replay suppression for /v1/send (HARDENING_ROADMAP §2.5).
//
// The case this exists for is mundane: a visitor double-clicks submit, or a
// customer's form retries on a slow response, and the destination inbox gets the
// same email twice. Against a capped sending allowance that is pure waste, so a
// repeat inside the window is answered `200` — the caller asked for the submission
// to be delivered, and it was.

/** How long an identical submission is treated as already handled. */
export const DEDUPE_WINDOW_MS = 60_000;

/**
 * Identity of a submission: the app plus its canonicalised fields, plus the bytes of
 * any attachment. Safe to stringify because the data has already been through
 * `orderSubmission()`, so key order is the app's declared order rather than whatever
 * the client happened to serialise — two identical submissions therefore hash the same.
 *
 * File bytes go into the same hash rather than a digest of their own: the same text
 * with a different file is not a repeat, and neither is the same filename and size
 * carrying different content, which a name/size summary could not tell apart.
 */
function submissionKey(
  appId: string,
  data: Record<string, unknown>,
  files: Uint8Array[]
): string {
  const hash = createHash("sha256").update(`${appId}:${JSON.stringify(data)}`);
  for (const bytes of files) hash.update(bytes);
  return hash.digest("hex");
}

/**
 * Try to claim the right to send this submission.
 *
 * Atomic by construction: the upsert only matches a row whose window has already
 * closed, so when a live claim exists Mongo attempts an insert instead and the unique
 * index rejects it with E11000. Check-then-insert would let two concurrent
 * double-click requests both pass, which is exactly the case this guards.
 *
 * Fails **open** — a duplicate email is a waste, an unsent one is a lost customer
 * enquiry, so a database hiccup here must never block delivery.
 */
export async function claimSubmission(
  appId: string,
  data: Record<string, unknown>,
  files: Uint8Array[] = []
): Promise<{ fresh: true; key: string } | { fresh: false }> {
  const key = submissionKey(appId, data, files);
  const now = new Date();
  try {
    await SendDedupe.findOneAndUpdate(
      { key, expiresAt: { $lte: now } },
      { $set: { key, expiresAt: new Date(now.getTime() + DEDUPE_WINDOW_MS) } },
      { upsert: true }
    );
    return { fresh: true, key };
  } catch (err) {
    if (isDuplicateKey(err)) return { fresh: false };
    return { fresh: true, key };
  }
}

/**
 * Drop a claim so an immediate retry is allowed again. Called when the send failed:
 * leaving the claim in place would answer a legitimate retry with `200` while no
 * mail had ever gone out, which is worse than a duplicate.
 */
export async function releaseSubmission(key: string): Promise<void> {
  try {
    await SendDedupe.deleteOne({ key });
  } catch {
    // Best-effort: the row expires on its own within the window.
  }
}

// Mongo surfaces a unique-index violation as code 11000. An upsert racing another
// upsert on the same key can also report it, which is the same answer for us:
// somebody else holds the claim.
function isDuplicateKey(err: unknown): boolean {
  return Boolean(err) && (err as { code?: number }).code === 11000;
}
