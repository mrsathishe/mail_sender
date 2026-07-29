import { generateOtp, otpExpiry, OTP_TTL_MS } from "./otp";
import { sendMail } from "./mailer";
import { BRAND_FULL } from "./brand";

// Both verification flows email a code and store only its hash: the account's own
// address at registration (SPEC §3a) and an app's destination address (SPEC §3e).
// Sending is best-effort — the caller's operation has already succeeded by this
// point, so a failed mail must not undo it; the user asks for a resend instead.

const TTL_MINUTES = Math.round(OTP_TTL_MS / 60_000);

type Issued = { codeHash: string; expiresAt: Date; sent: boolean };

async function issue(to: string, subject: string, body: (code: string) => string): Promise<Issued> {
  const { code, codeHash } = generateOtp();
  const expiresAt = otpExpiry();
  let sent = false;
  try {
    await sendMail({ to, subject, text: body(code) });
    sent = true;
  } catch {
    // Swallow: the token is stored either way, so a resend is all that's needed.
  }
  return { codeHash, expiresAt, sent };
}

/** Verification code for a newly registered account's own email address. */
export function issueAccountOtp(email: string): Promise<Issued> {
  return issue(
    email,
    `Your ${BRAND_FULL} verification code`,
    (code) =>
      `Welcome to ${BRAND_FULL}. Enter this code to verify your email address:\n\n` +
      `    ${code}\n\n` +
      `It expires in ${TTL_MINUTES} minutes. If you didn't create this account, ` +
      `ignore this email.`
  );
}

/**
 * Confirmation code for an app's destination inbox. Addressed to the destination,
 * not the account holder — they need not be the same person, which is the whole
 * point of the check.
 */
export function issueDestinationOtp(destinationEmail: string, websiteName: string): Promise<Issued> {
  return issue(
    destinationEmail,
    `Your code to confirm form submissions from “${websiteName}”`,
    (code) =>
      `Someone registered the website “${websiteName}” on ${BRAND_FULL} and set ` +
      `${destinationEmail} as the inbox its form submissions are delivered to.\n\n` +
      `If that was you, enter this code on the dashboard to confirm:\n\n` +
      `    ${code}\n\n` +
      `It expires in ${TTL_MINUTES} minutes. If you don't recognise this, ignore ` +
      `this email — no submissions are delivered until the address is confirmed.`
  );
}
