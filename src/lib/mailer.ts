import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
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
}): Promise<void> {
  await getTransporter().sendMail({
    from: env.smtpFrom,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
}
