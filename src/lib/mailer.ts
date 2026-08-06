import nodemailer, { type Transporter } from "nodemailer";
import type { MailAttachment } from "./attachments";
import { env } from "./env";

let transporter: Transporter | null = null;

// Host/port come from env rather than `service: "gmail"` so the sending account can
// move between providers (own domain mailbox, Resend, SES) without a code change —
// this function stays the single choke point where transport is decided
// (HARDENING_ROADMAP §1.4). Sending is always ours: a per-app transport was
// considered and rejected (§0/§4.1), so there is deliberately no per-app branch here.
function getTransporter(): Transporter {
  if (!transporter) {
    // Two calls rather than one with a ternary argument: a ternary is typed as the union
    // of both branches *before* `createTransport` resolves an overload, and `jsonTransport`
    // only exists on the JSON-transport options — so the union matches neither overload.
    //
    // MOCK_MODE (dev only, env.mockMode): nodemailer's own JSON transport never opens
    // a socket, so a local run cannot send from the real mailbox by accident. The
    // message is printed in sendMail below, which is how a verification code is
    // "received" with no inbox to read.
    transporter = env.mockMode
      ? nodemailer.createTransport({ jsonTransport: true })
      : nodemailer.createTransport({
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
  // Already validated by attachments.ts — filename sanitised, contentType confirmed
  // against the bytes. Wrapping in Buffer happens here so that module can stay free
  // of Node built-ins and be read by the dashboard's client editor.
  attachments?: MailAttachment[];
}): Promise<void> {
  await getTransporter().sendMail({
    from: env.smtpFrom,
    to: opts.to,
    replyTo: opts.replyTo,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    attachments: opts.attachments?.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content),
      contentType: a.contentType,
    })),
  });

  // Mock mode's entire delivery mechanism: nothing left the machine, so the terminal is
  // the inbox — which is what makes a registration or destination code readable locally.
  if (env.mockMode) {
    console.log(`\n[mock mail] to: ${opts.to}\n[mock mail] subject: ${opts.subject}\n${opts.text}\n`);
  }
}
