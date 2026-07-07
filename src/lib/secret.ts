import { randomBytes, createHash } from "crypto";

// API secret keys are high-entropy, so a fast deterministic hash (sha256) is the
// right choice for storage + lookup — unlike passwords, which need bcrypt.

export function generateSecretKey(): string {
  return `mks_${randomBytes(24).toString("base64url")}`;
}

export function hashSecret(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// Password-reset tokens: random, emailed in plaintext, only the hash is stored.
export function generateResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: createHash("sha256").update(token).digest("hex") };
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
