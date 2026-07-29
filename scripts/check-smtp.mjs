#!/usr/bin/env node
// Verify the SMTP settings in .env before trusting them in the app.
//
//   node scripts/check-smtp.mjs                 # connect + authenticate only
//   node scripts/check-smtp.mjs you@example.com # also send one test message
//
// Exists because a wrong host/port/TLS combination fails at *send* time inside a
// request, where the only trace is a 502 and a SendLog row. This surfaces the
// provider's own error immediately.

import { readFileSync } from "node:fs";
import nodemailer from "nodemailer";

function unquote(value) {
  // Only strip a *matched* surrounding pair. Stripping the two ends independently
  // corrupts values that legitimately start with a quote, e.g.
  //   SMTP_FROM="Mail Sender" <mail@example.com>
  const first = value[0];
  if ((first === '"' || first === "'") && value.length > 1 && value.endsWith(first)) {
    return value.slice(1, -1);
  }
  return value;
}

function loadEnv() {
  const out = { ...process.env };
  try {
    for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      // Real values win over .env, so `SMTP_PORT=587 node scripts/check-smtp.mjs`
      // can try alternatives without editing the file.
      if (out[key] === undefined) out[key] = unquote(trimmed.slice(eq + 1).trim());
    }
  } catch {
    /* no .env — rely on the environment */
  }
  return out;
}

const env = loadEnv();
const missing = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"].filter((k) => !env[k]);
if (missing.length) {
  console.error(`Missing: ${missing.join(", ")}`);
  process.exit(1);
}

const port = Number(env.SMTP_PORT || 587);
const secure = env.SMTP_SECURE ? env.SMTP_SECURE === "true" || env.SMTP_SECURE === "1" : port === 465;
const from = env.SMTP_FROM || env.SMTP_USER;

console.log(`host   ${env.SMTP_HOST}:${port} (secure=${secure})`);
console.log(`user   ${env.SMTP_USER}`);
console.log(`from   ${from}`);

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port,
  secure,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  connectionTimeout: 15000,
});

try {
  await transporter.verify();
  console.log("\n✓ connected and authenticated");
} catch (err) {
  console.error(`\n✗ ${err.code ?? ""} ${err.message}`);
  if (err.response) console.error(`  server said: ${err.response}`);
  console.error(
    "\nCommon causes: wrong port/TLS pair (465 needs secure, 587 does not), " +
      "username not the full email address, or the VPS blocking outbound SMTP."
  );
  process.exit(1);
}

const to = process.argv[2];
if (!to) {
  console.log("\nPass an address to also send a test message:");
  console.log("  node scripts/check-smtp.mjs you@example.com");
  process.exit(0);
}

try {
  const info = await transporter.sendMail({
    from,
    to,
    replyTo: "submitter@example.com",
    subject: "Mail Sender SMTP check",
    text:
      "If you received this, the SMTP settings work.\n\n" +
      "Check the headers: From should be your sending address and Reply-To " +
      "should read submitter@example.com — that is how form submissions arrive.",
  });
  console.log(`✓ sent — id ${info.messageId}`);
  if (info.accepted?.length) console.log(`  accepted: ${info.accepted.join(", ")}`);
  if (info.rejected?.length) console.log(`  rejected: ${info.rejected.join(", ")}`);
} catch (err) {
  console.error(`✗ send failed: ${err.code ?? ""} ${err.message}`);
  if (err.response) console.error(`  server said: ${err.response}`);
  process.exit(1);
}
