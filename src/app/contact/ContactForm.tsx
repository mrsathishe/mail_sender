"use client";

import { useRef, useState } from "react";
import {
  ACCEPTED_EXTENSIONS,
  ACCEPT_ATTRIBUTE,
  ATTACHMENT_MAX_TOTAL_BYTES,
  formatBytes,
} from "@/lib/attachments";

// Machine-readable codes from POST /api/contact turned into something a visitor can
// act on. The guard failures deliberately don't say which guard fired — that is a
// lesson for a bot author, not help for a person.
const MESSAGES: Record<string, string> = {
  honeypot_filled: "That submission looked automated. Please try again.",
  too_fast: "That was submitted a little too quickly — please try again.",
  timing_missing: "That was submitted a little too quickly — please try again.",
  spam_rejected:
    "The message was flagged by our spam filter. Try again with fewer links, or email us directly.",
  invalid_input: "Please check the form: a name, a valid email and a message are needed.",
  too_many_requests: "You've just sent a message — please wait a minute before the next one.",
  payload_too_large: `That message and its attachments come to more than ${formatBytes(
    ATTACHMENT_MAX_TOTAL_BYTES
  )}.`,
  too_many_files: "That's too many files — attach up to three.",
  unsupported_file_type: `That file type isn't accepted. Try one of: ${ACCEPTED_EXTENSIONS.join(
    ", "
  )}.`,
  invalid_filename: "One of those files has no extension, so we can't tell what it is.",
  empty_file: "One of those files is empty.",
  send_failed: "Our mail server refused it. Please try again, or email us directly.",
};

type State = { kind: "ok"; duplicate: boolean } | { kind: "error"; text: string } | null;

export function ContactForm() {
  // Set on first render, read at submit: an elapsed duration rather than a timestamp,
  // which is what the server's timing check prefers because it survives a wrong clock.
  const renderedAt = useRef(Date.now());
  const [sending, setSending] = useState(false);
  const [state, setState] = useState<State>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = new FormData(form);
    values.set("elapsed_ms", String(Date.now() - renderedAt.current));

    // Checked here as well as on the server so an oversized attachment is reported
    // before it is uploaded — and because nginx answers its own 413 without the CORS
    // headers or the JSON body this page reads.
    const total = Array.from(values.values()).reduce(
      (sum, value) => sum + (typeof value === "string" ? value.length : value.size),
      0
    );
    if (total > ATTACHMENT_MAX_TOTAL_BYTES) {
      setState({ kind: "error", text: MESSAGES.payload_too_large });
      return;
    }

    setSending(true);
    setState(null);

    try {
      // No Content-Type header: the browser has to set it itself, because only it knows
      // the multipart boundary it generated.
      const res = await fetch("/api/contact", { method: "POST", body: values });
      const payload = await res.json().catch(() => null);

      if (res.ok) {
        setState({ kind: "ok", duplicate: Boolean(payload?.duplicate) });
        form.reset();
        // A fresh window for the next message, so the timing check doesn't measure
        // from the first render of the page.
        renderedAt.current = Date.now();
      } else {
        const code = typeof payload?.error === "string" ? payload.error : "";
        setState({
          kind: "error",
          text: MESSAGES[code] ?? "Something went wrong. Please try again.",
        });
      }
    } catch {
      setState({ kind: "error", text: "Couldn't reach the server. Please try again." });
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="card card-wide contact-form" onSubmit={onSubmit}>
      <h2>Send us a message</h2>

      {state?.kind === "ok" && (
        <div className="msg ok">
          {state.duplicate
            ? "We already have that message — no need to send it twice."
            : "Thanks — your message is on its way. We reply to the address you gave."}
        </div>
      )}
      {state?.kind === "error" && <div className="msg error">{state.text}</div>}

      <label htmlFor="contact-name">Your name</label>
      <input id="contact-name" name="name" required maxLength={120} autoComplete="name" />

      <label htmlFor="contact-email">Email</label>
      <input
        id="contact-email"
        name="email"
        type="email"
        required
        maxLength={200}
        autoComplete="email"
      />

      <label htmlFor="contact-subject">Subject (optional)</label>
      <input id="contact-subject" name="subject" maxLength={160} />

      <label htmlFor="contact-message">How can we help?</label>
      <textarea id="contact-message" name="message" rows={6} required minLength={10} maxLength={5000} />

      <label htmlFor="contact-files">Attachments (optional)</label>
      <input
        id="contact-files"
        name="files"
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        aria-describedby="contact-files-help"
      />
      <p className="muted field-help" id="contact-files-help">
        Up to three files, {formatBytes(ATTACHMENT_MAX_TOTAL_BYTES)} in total — a
        screenshot or a log makes a rendering problem far quicker to answer. Accepted:{" "}
        {ACCEPTED_EXTENSIONS.join(", ")}.
      </p>

      {/* Honeypot: off-screen and aria-hidden, so a person never sees or hears it and
          a naive bot fills it anyway. Not `.visually-hidden` — that class is meant to
          be announced by screen readers, which is the opposite of what this wants. */}
      <div className="honeypot" aria-hidden="true">
        <label htmlFor="contact-company-url">Company URL (leave blank)</label>
        <input id="contact-company-url" name="company_url" tabIndex={-1} autoComplete="off" />
      </div>

      <button type="submit" disabled={sending}>
        {sending ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
