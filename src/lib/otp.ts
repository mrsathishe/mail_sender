import { randomBytes, createHash } from "crypto";

// One-time codes for email verification — used both for account registration and
// for confirming an app's destination address.
//
// 8 chars from a 32-symbol alphabet ≈ 40 bits: far too little to store like a
// password, but guessing is bounded by MAX_ATTEMPTS, not by hashing cost, so
// sha256 is the right choice for the same reason as in secret.ts — deterministic
// lookup with no plaintext at rest. Ambiguous glyphs (I, O, 0, 1) are excluded so
// a code stays typable from a phone screen.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export const OTP_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const OTP_MAX_ATTEMPTS = 5;

export function generateOtp(): { code: string; codeHash: string } {
  // 256 % 32 === 0, so plain modulo over the alphabet is unbiased here — no
  // reject sampling needed.
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
  return { code, codeHash: hashOtp(code) };
}

export function hashOtp(code: string): string {
  // Codes are compared case-insensitively — users retype them from an email.
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export function otpExpiry(): Date {
  return new Date(Date.now() + OTP_TTL_MS);
}

export type OtpState = {
  codeHash?: string | null;
  expiresAt?: Date | null;
  attempts?: number | null;
};

export type OtpResult = "ok" | "no_code" | "expired" | "too_many_attempts" | "invalid";

/**
 * Check `input` against a stored code. Pure — the caller persists the outcome
 * (clear the fields on "ok", increment `attempts` on "invalid"), since only it
 * knows which document the state lives on.
 */
export function checkOtp(state: OtpState, input: string): OtpResult {
  if (!state.codeHash) return "no_code";
  if (!state.expiresAt || state.expiresAt.getTime() < Date.now()) return "expired";
  if ((state.attempts ?? 0) >= OTP_MAX_ATTEMPTS) return "too_many_attempts";
  return hashOtp(input) === state.codeHash ? "ok" : "invalid";
}
