"use client";

import { useState } from "react";
import Link from "next/link";
import { DesignPicker, type Design } from "./DesignPicker";
import { FieldsEditor } from "./FieldsEditor";
import { SpamGuardEditor } from "./SpamGuardEditor";
import { AutoReplyEditor } from "./AutoReplyEditor";
import { AttachmentsEditor } from "./AttachmentsEditor";
import {
  DEFAULT_FIELDS,
  firstFieldProblem,
  withoutBlankFields,
  type AppField,
} from "@/lib/fields";
import { SPAM_GUARD_OFF, type SpamGuard } from "@/lib/bot-guard";
import { AUTO_RESPONDER_OFF, type AutoResponder } from "@/lib/auto-responder";
import {
  ATTACHMENTS_OFF,
  MAX_ATTACHMENTS_CEILING,
  type AttachmentConfig,
} from "@/lib/attachments";

// Registration on its own page, as one numbered section after another. The dashboard's
// card asked for a name, an address, the fields and the design; the three optional
// settings had to be found afterwards under the row's Actions menu, so most apps never got
// them. Offering every setting here, before the key exists, is what fixes that.
//
// All sections are on the page at once rather than one at a time behind Next: the flow is
// linear but not sequential — an owner who only wants the defaults should be able to see
// that the rest is optional and scroll past it, and one who wants the spam guard should
// not have to walk four screens to reach it.

// Same wording as the dashboard's own map: both read the codes lib/fields returns, so a
// rule broken here reads the same as one broken while editing an app later.
const FIELD_MESSAGES: Record<string, string> = {
  no_fields: "An app needs at least one field.",
  too_many_fields: "That's too many fields.",
  invalid_field_id:
    "Field ids must start with a letter and use only letters, digits, _ or -.",
  invalid_field_label: "Every field needs a label, and it must be short and single-line.",
  duplicate_field: "Two fields have the same id.",
  duplicate_label: "Two fields have the same label.",
};

// The codes the three setting parsers return. Reported on submit rather than per step:
// the editors constrain their own inputs, so reaching one of these means the server
// disagreed with something the client thought was fine.
const SETTING_MESSAGES: Record<string, string> = {
  invalid_guard_field:
    "Guard field names must start with a letter, use only letters, digits, _ or -, and differ from each other.",
  invalid_min_seconds: "The minimum time must be a whole number of seconds, 0–60.",
  timing_field_missing: "A minimum time needs a timing field name to measure against.",
  invalid_auto_reply: "That auto-reply isn't valid. Check the subject and message.",
  auto_reply_too_long: "The auto-reply subject or message is too long.",
  invalid_attachments: "Those attachment settings aren't valid.",
  invalid_max_files: `The file limit must be a whole number, 1–${MAX_ATTACHMENTS_CEILING}.`,
};

// Deliberately loose — the address is checked properly by zod on the server and then by
// the mail that has to reach it. This only stops the obvious slip before a round trip.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What the flow ends in: a key to copy, or a code to enter before one exists. */
type Outcome =
  | { kind: "key"; key: string }
  | { kind: "otp"; appId: string; destinationEmail: string; codeSent: boolean };

const OTP_MESSAGES: Record<string, string> = {
  invalid: "That code isn't right. Check the email and try again.",
  expired: "That code has expired. Send a new one.",
  too_many_attempts: "Too many wrong attempts. Send a new code.",
  no_code: "No code is pending. Send a new one.",
};

export function RegisterApp({
  designs,
  accountEmail,
}: {
  designs: Design[];
  accountEmail: string;
}) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [websiteName, setWebsiteName] = useState("");
  // Destination field is controlled so the "my own address" checkbox can fill it.
  const [useOwnEmail, setUseOwnEmail] = useState(false);
  const [destination, setDestination] = useState("");
  const [fields, setFields] = useState<AppField[]>(DEFAULT_FIELDS.map((f) => ({ ...f })));
  // Widened to string: the picker hands back whichever id was clicked, and the server is
  // what validates it against the catalog.
  const [templateId, setTemplateId] = useState<string>(designs[0].id);
  const [autoResponder, setAutoResponder] = useState<AutoResponder>({ ...AUTO_RESPONDER_OFF });
  const [guard, setGuard] = useState<SpamGuard>({ ...SPAM_GUARD_OFF });
  const [attachments, setAttachments] = useState<AttachmentConfig>({ ...ATTACHMENTS_OFF });

  const [creating, setCreating] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [resending, setResending] = useState(false);

  function onToggleOwnEmail(checked: boolean) {
    setUseOwnEmail(checked);
    setDestination(checked ? accountEmail : "");
  }

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Everything is checked here rather than per section, because every section is on
    // screen: the message can name what is wrong and the input is already in view.
    if (websiteName.trim() === "") {
      setError("Give the app a name so you can tell its rows apart.");
      return;
    }
    if (!EMAIL_RE.test(destination.trim())) {
      setError("Enter the address submissions should be delivered to.");
      return;
    }
    const cleanFields = withoutBlankFields(fields);
    const problem = firstFieldProblem(cleanFields);
    if (problem) {
      setError(FIELD_MESSAGES[problem]);
      return;
    }
    setError("");
    setNotice("");
    setCreating(true);
    const res = await fetch("/api/apps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        websiteName: websiteName.trim(),
        destinationEmail: destination.trim(),
        templateId,
        fields: cleanFields,
        spamGuard: guard,
        autoResponder,
        attachments,
      }),
    });
    setCreating(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(
        FIELD_MESSAGES[body.error] ??
          SETTING_MESSAGES[body.error] ??
          "Could not create app. Check the name and a valid email address."
      );
      return;
    }

    const created = await res.json();
    if (created.otpRequired) {
      // No key yet: it is issued when the destination code is entered.
      setOutcome({
        kind: "otp",
        appId: created.id,
        destinationEmail: created.destinationEmail,
        codeSent: created.codeSent,
      });
      setOtpCode("");
      return;
    }
    setOutcome({ kind: "key", key: created.secretKey });
  }

  async function onVerifyDestination(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (outcome?.kind !== "otp") return;
    setError("");
    setNotice("");
    setOtpBusy(true);
    const res = await fetch(`/api/apps/${outcome.appId}/verify-destination`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: otpCode }),
    });
    setOtpBusy(false);
    if (res.ok) {
      const data = await res.json();
      setOtpCode("");
      // The key only exists from this moment — the app had none before.
      setOutcome({ kind: "key", key: data.secretKey });
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(OTP_MESSAGES[data.error] ?? "Could not verify that code.");
  }

  async function onResendCode() {
    if (outcome?.kind !== "otp") return;
    setError("");
    setNotice("");
    setResending(true);
    const res = await fetch(`/api/apps/${outcome.appId}/resend-verification`, { method: "POST" });
    setResending(false);
    if (res.ok) setNotice(`A new code is on its way to ${outcome.destinationEmail}.`);
    else setError("Could not send a new code. Please try again.");
  }

  const designName = designs.find((d) => d.id === templateId)?.name ?? templateId;
  const guardParts = [
    guard.honeypotField ? `honeypot “${guard.honeypotField}”` : "",
    guard.minSubmitSeconds > 0 ? `min ${guard.minSubmitSeconds}s` : "",
  ].filter(Boolean);

  return (
    <div className="card card-wide">
      {error && (
        <div className="msg error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="msg ok" role="status">
          {notice}
        </div>
      )}

      {/* The form disappears once the app exists: every value in it has been saved, and
          editing one afterwards is the dashboard row's job. */}
      {!outcome && (
        <form onSubmit={onCreate}>
          <section className="reg-section">
            <h3>1. Basics</h3>
            <label htmlFor="websiteName">Website name</label>
            <input
              id="websiteName"
              type="text"
              required
              value={websiteName}
              onChange={(e) => setWebsiteName(e.target.value)}
              placeholder="Acme contact form"
            />

            <label htmlFor="destinationEmail">Email to send submissions to</label>
            <label className="checkbox-row" htmlFor="useOwnEmail">
              <input
                id="useOwnEmail"
                type="checkbox"
                checked={useOwnEmail}
                onChange={(e) => onToggleOwnEmail(e.target.checked)}
              />
              <span>
                Send to my account address (<strong>{accountEmail}</strong>) — already verified,
                so no code needed
              </span>
            </label>
            <input
              id="destinationEmail"
              type="email"
              required
              readOnly={useOwnEmail}
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="support@acme.com"
              aria-describedby="destination-help"
            />
            <p className="muted field-help" id="destination-help">
              Any inbox works — Gmail, Zoho, Outlook or your own domain. Any address other
              than your own is emailed a confirmation code, and submissions are only
              delivered once it is entered.
            </p>
          </section>

          <section className="reg-section">
            <h3>2. Form fields</h3>
            <FieldsEditor fields={fields} onChange={setFields} idPrefix="new-field" />
          </section>

          <section className="reg-section">
            <h3>3. Mail design</h3>
            <DesignPicker
              designs={designs}
              value={templateId}
              onChange={setTemplateId}
              idPrefix="new-design"
            />
          </section>

          <section className="reg-section">
            <h3>
              4. Auto-reply <span className="reg-optional">optional</span>
            </h3>
            <p className="muted step-note">
              Off unless you switch it on. Leave it alone and nobody who fills the form
              hears back automatically.
            </p>
            <AutoReplyEditor
              autoResponder={autoResponder}
              websiteName={websiteName}
              onChange={setAutoResponder}
              idPrefix="new-reply"
            />
          </section>

          <section className="reg-section">
            <h3>
              5. Spam guard <span className="reg-optional">optional</span>
            </h3>
            <p className="muted step-note">
              Off unless you name the fields your form posts. Skip it now and switch it on
              later once the form is live.
            </p>
            <SpamGuardEditor guard={guard} onChange={setGuard} idPrefix="new-guard" />
          </section>

          <section className="reg-section">
            <h3>
              6. Attachments <span className="reg-optional">optional</span>
            </h3>
            <p className="muted step-note">
              Off unless you switch it on. A form with no file input has nothing to gain
              from it.
            </p>
            <AttachmentsEditor
              attachments={attachments}
              onChange={setAttachments}
              idPrefix="new-attachments"
            />
          </section>

          <section className="reg-section">
            <h3>7. Generate key</h3>
            <dl className="review-list">
              <dt>Website name</dt>
              <dd>{websiteName.trim() || "—"}</dd>
              <dt>Submissions go to</dt>
              <dd>
                {destination.trim() || "—"}
                {destination.trim() !== "" && !useOwnEmail &&
                  " — we'll email a confirmation code to it"}
              </dd>
              <dt>Fields</dt>
              <dd>
                {withoutBlankFields(fields)
                  .map((f) => f.id.trim())
                  .join(", ") || "—"}
              </dd>
              <dt>Mail design</dt>
              <dd>{designName}</dd>
              <dt>Auto-reply</dt>
              <dd>{autoResponder.enabled ? "on" : "off"}</dd>
              <dt>Spam guard</dt>
              <dd>{guardParts.length > 0 ? guardParts.join(", ") : "off"}</dd>
              <dt>Attachments</dt>
              <dd>{attachments.enabled ? `up to ${attachments.maxFiles} files` : "off"}</dd>
            </dl>
            <p className="muted field-help">
              Everything here can be changed later from the app&rsquo;s row on your
              dashboard.
            </p>
            <div className="reg-submit">
              <button type="submit" disabled={creating}>
                {creating ? "Generating…" : "Register app"}
              </button>
              <Link href="/dashboard" className="link-btn">
                Cancel
              </Link>
            </div>
          </section>
        </form>
      )}

      {outcome?.kind === "otp" && (
        <div className="reg-section">
          <h3 className="form-section">Confirm the destination address</h3>
          <p className="muted">
            {outcome.codeSent
              ? `We emailed a code to ${outcome.destinationEmail}.`
              : `We couldn't email ${outcome.destinationEmail} just now — use “Send a new code” below.`}
          </p>
          <form className="otp-panel" onSubmit={onVerifyDestination}>
            <p className="muted">
              Enter the 8-character code to confirm the address receives submissions from
              &ldquo;{websiteName.trim()}&rdquo;. The secret key is issued once the address is
              confirmed.
            </p>
            <input
              type="text"
              required
              maxLength={8}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="ABCD2345"
              className="otp-input"
              aria-label="Destination confirmation code"
            />
            <div className="otp-actions">
              <button type="submit" className="regen-btn" disabled={otpBusy || !otpCode.trim()}>
                {otpBusy ? "Confirming…" : "Confirm address"}
              </button>
              <button type="button" className="link-btn" onClick={onResendCode} disabled={resending}>
                {resending ? "Sending…" : "Send a new code"}
              </button>
            </div>
          </form>
          <p className="muted field-help">
            The app is already registered — you can leave and enter the code from its row
            on the dashboard instead.
          </p>
          <Link href="/dashboard">Back to your apps</Link>
        </div>
      )}

      {outcome?.kind === "key" && (
        <div className="reg-section">
          <h3 className="form-section">Secret key for “{websiteName.trim()}”</h3>
          <p className="muted">
            Copy it now — this is the only time it is shown. Store it in your
            website&rsquo;s environment variables.
          </p>
          <div className="secret">{outcome.key}</div>
          <Link href="/dashboard" className="btn-primary">
            I&rsquo;ve saved it — back to your apps
          </Link>
        </div>
      )}

    </div>
  );
}
