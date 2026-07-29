import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";

let transporter: Transporter | null = null;

// Host/port come from env rather than `service: "gmail"` so the sending account can
// move between providers (own domain mailbox, Resend, SES) without a code change —
// this function stays the single choke point where transport is decided
// (HARDENING_ROADMAP §1.4). Sending is always ours: a per-app transport was
// considered and rejected (§0/§4.1), so there is deliberately no per-app branch here.
function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      // Implicit TLS on 465; 587 upgrades via STARTTLS, which nodemailer does when
      // `secure` is false.
      secure: env.smtpSecure,
      auth: { user: env.smtpUser, pass: env.smtpPass },
    });
  }
  return transporter;
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  // Plain-text alternative; always sent so text-only clients stay readable.
  text: string;
  html?: string;
  // Where a reply should go — the form submitter, when we could identify them.
  // `from` is always our own address: putting the submitter there is spoofing and
  // fails DMARC (HARDENING_ROADMAP §2.1).
  replyTo?: string;
}): Promise<void> {
  await getTransporter().sendMail({
    from: env.smtpFrom,
    to: opts.to,
    replyTo: opts.replyTo,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
}
