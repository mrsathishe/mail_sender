"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DesignPicker, type Design } from "./DesignPicker";
import { FieldsEditor } from "./FieldsEditor";
import { SpamGuardEditor } from "./SpamGuardEditor";
import { AutoReplyEditor } from "./AutoReplyEditor";
import { AttachmentsEditor } from "./AttachmentsEditor";
import { CodeSnippets } from "./CodeSnippets";
import { ActivityPanel } from "./ActivityPanel";
import { firstFieldProblem, withoutBlankFields, type AppField } from "@/lib/fields";
import { SPAM_GUARD_OFF, type SpamGuard } from "@/lib/bot-guard";
import { AUTO_RESPONDER_OFF, type AutoResponder } from "@/lib/auto-responder";
import {
  ATTACHMENTS_OFF,
  MAX_ATTACHMENTS_CEILING,
  type AttachmentConfig,
} from "@/lib/attachments";

type App = {
  id: string;
  websiteName: string;
  destinationEmail: string;
  destinationVerified: boolean;
  templateId: string;
  fields: AppField[];
  // Optional so a response from an older build (or a hand-written one) can't crash
  // the row — the API resolves both, but the fallback is one `??` away.
  spamGuard?: SpamGuard;
  autoResponder?: AutoResponder;
  attachments?: AttachmentConfig;
  createdAt: string;
};

type OtpTarget = { id: string; websiteName: string; destinationEmail: string };

/**
 * What the Actions menu can open. One panel per app at a time, tracked in a single piece
 * of state: the previous version kept a separate `editing*` object per editor, which made
 * "only one open" something every button had to remember rather than something the shape
 * of the state guarantees.
 */
type ActionKind = "fields" | "design" | "reply" | "guard" | "attachments" | "code";

/** The pending edit for whichever panel is open — its slice is the one the panel writes. */
type Draft = {
  templateId: string;
  fields: AppField[];
  guard: SpamGuard;
  autoResponder: AutoResponder;
  attachments: AttachmentConfig;
};

const ACTION_LABELS: Record<ActionKind, string> = {
  fields: "Edit fields",
  design: "Change design",
  reply: "Auto-reply",
  guard: "Spam guard",
  attachments: "Attachments",
  code: "Get the code",
};

const ACTION_ORDER: ActionKind[] = ["fields", "design", "reply", "guard", "attachments", "code"];

const OTP_MESSAGES: Record<string, string> = {
  invalid: "That code isn't right. Check the email and try again.",
  expired: "That code has expired. Send a new one.",
  too_many_attempts: "Too many wrong attempts. Send a new code.",
  no_code: "No code is pending. Send a new one.",
};

const FIELD_MESSAGES: Record<string, string> = {
  no_fields: "An app needs at least one field.",
  too_many_fields: "That's too many fields.",
  invalid_field_id:
    "Field ids must start with a letter and use only letters, digits, _ or -.",
  invalid_field_label: "Every field needs a label, and it must be short and single-line.",
  duplicate_field: "Two fields have the same id.",
  duplicate_label: "Two fields have the same label.",
};

const GUARD_MESSAGES: Record<string, string> = {
  invalid_guard_field:
    "Guard field names must start with a letter, use only letters, digits, _ or -, and differ from each other.",
  invalid_min_seconds: "The minimum time must be a whole number of seconds, 0–60.",
  timing_field_missing: "A minimum time needs a timing field name to measure against.",
  invalid_auto_reply: "That auto-reply isn't valid. Check the subject and message.",
  auto_reply_too_long: "The auto-reply subject or message is too long.",
  invalid_attachments: "Those attachment settings aren't valid.",
  invalid_max_files: `The file limit must be a whole number, 1–${MAX_ATTACHMENTS_CEILING}.`,
};

// One line for the app row: which of the two bot signals are actually armed.
function guardSummary(guard: SpamGuard): string {
  const parts: string[] = [];
  if (guard.honeypotField) parts.push(`honeypot “${guard.honeypotField}”`);
  if (guard.minSubmitSeconds > 0) parts.push(`min ${guard.minSubmitSeconds}s`);
  return parts.join(", ");
}

export function AppsManager({
  designs,
  baseUrl,
}: {
  designs: Design[];
  baseUrl: string;
}) {
  const [apps, setApps] = useState<App[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  // A key is shown once, in the row of the app it belongs to — `appId` is what puts it
  // there instead of at the top of the page, where it sat above whichever app you were
  // actually looking at.
  const [newSecret, setNewSecret] = useState<{ appId: string; name: string; key: string } | null>(
    null
  );
  // Which app is awaiting a destination code, and the code being typed for it.
  const [otpTarget, setOtpTarget] = useState<OtpTarget | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [resending, setResending] = useState(false);
  // The single open panel, and the edit it is holding. One of each, because the Actions
  // menu turns into Cancel while a panel is open — so a second one cannot be started.
  const [action, setAction] = useState<{ appId: string; kind: ActionKind } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch("/api/apps");
    if (res.ok) {
      const data = await res.json();
      setApps(data.apps);
    }
    setLoaded(true);
  }

  useEffect(() => {
    load();
  }, []);

  function designName(templateId: string) {
    return designs.find((d) => d.id === templateId)?.name ?? templateId;
  }

  function closeAction() {
    setAction(null);
    setDraft(null);
    setError("");
  }

  /** Open one panel, seeding the draft from the app's saved settings. */
  function openAction(app: App, kind: ActionKind) {
    setError("");
    setNotice("");
    setOtpTarget(null);
    setAction({ appId: app.id, kind });
    setDraft({
      templateId: app.templateId,
      fields: app.fields.map((f) => ({ ...f })),
      guard: { ...(app.spamGuard ?? SPAM_GUARD_OFF) },
      autoResponder: { ...(app.autoResponder ?? AUTO_RESPONDER_OFF) },
      attachments: { ...(app.attachments ?? ATTACHMENTS_OFF) },
    });
  }

  function isOpen(app: App, kind: ActionKind) {
    return action?.appId === app.id && action.kind === kind;
  }

  async function onRegenerate(app: App) {
    const ok = window.confirm(
      `Generate a new secret key for “${app.websiteName}”?\n\n` +
        "The current key will stop working immediately — you'll need to update " +
        "it wherever your website uses it."
    );
    if (!ok) return;

    setError("");
    setNotice("");
    setRegeneratingId(app.id);
    const res = await fetch(`/api/apps/${app.id}/regenerate-key`, { method: "POST" });
    setRegeneratingId(null);
    if (res.ok) {
      const data = await res.json();
      setNewSecret({ appId: app.id, name: data.websiteName, key: data.secretKey });
    } else {
      setError("Could not regenerate the key. Please try again.");
    }
  }

  function openOtpPanel(app: App) {
    setError("");
    setNotice("");
    setOtpCode("");
    closeAction();
    setOtpTarget(
      otpTarget?.id === app.id
        ? null
        : { id: app.id, websiteName: app.websiteName, destinationEmail: app.destinationEmail }
    );
  }

  async function onVerifyDestination(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!otpTarget) return;
    setError("");
    setNotice("");
    setOtpBusy(true);
    const res = await fetch(`/api/apps/${otpTarget.id}/verify-destination`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: otpCode }),
    });
    setOtpBusy(false);
    if (res.ok) {
      const data = await res.json();
      const appId = otpTarget.id;
      setOtpTarget(null);
      setOtpCode("");
      // The key only exists from this moment — the app had none before.
      setNewSecret({ appId, name: data.websiteName, key: data.secretKey });
      load();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(OTP_MESSAGES[data.error] ?? "Could not verify that code.");
  }

  async function onResendCode() {
    if (!otpTarget) return;
    setError("");
    setNotice("");
    setResending(true);
    const res = await fetch(`/api/apps/${otpTarget.id}/resend-verification`, { method: "POST" });
    setResending(false);
    if (res.ok) setNotice(`A new code is on its way to ${otpTarget.destinationEmail}.`);
    else setError("Could not send a new code. Please try again.");
  }

  /**
   * Every panel saves through the same PATCH: one route, one body per panel, one place
   * that reports failure. The server owns the rules, so a rejection is reported by its
   * own error code.
   */
  async function save(body: Record<string, unknown>, messages: Record<string, string>, ok: string) {
    if (!action) return;
    setError("");
    setNotice("");
    setSaving(true);
    const res = await fetch(`/api/apps/${action.appId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) {
      closeAction();
      setNotice(ok);
      load();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(messages[data.error] ?? "Could not save that change. Please try again.");
  }

  async function onSaveFields() {
    if (!draft) return;
    const fields = withoutBlankFields(draft.fields);
    const problem = firstFieldProblem(fields);
    if (problem) {
      setError(FIELD_MESSAGES[problem]);
      return;
    }
    await save(
      { fields },
      FIELD_MESSAGES,
      "Fields updated. Submissions are checked against the new list from now on."
    );
  }

  const otpPanel = otpTarget && (
    <form className="otp-panel" onSubmit={onVerifyDestination}>
      <p className="muted">
        Enter the 8-character code emailed to <strong>{otpTarget.destinationEmail}</strong> to
        confirm it receives submissions from &ldquo;{otpTarget.websiteName}&rdquo;. The secret
        key is issued once the address is confirmed.
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
  );

  /** The issued-once key, shown under the app it belongs to. */
  function secretCard(app: App) {
    if (newSecret?.appId !== app.id) return null;
    return (
      <div className="secret-issued">
        <h4>Secret key for “{newSecret.name}”</h4>
        <p className="muted">
          Copy it now — this is the only time it is shown. Store it in your
          website&rsquo;s environment variables.
        </p>
        <div className="secret">{newSecret.key}</div>
        <button type="button" className="regen-btn" onClick={() => setNewSecret(null)}>
          I&rsquo;ve saved it
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Registration moved to its own page: it now walks through the fields, the design
          and the three optional settings a section at a time, which is more than a card
          above the list can hold. What stays here are the two message areas the per-row
          actions still write to. */}
      <div className="card card-wide register-cta">
        <div>
          <h2>Register a new app</h2>
          <p className="muted">
            Name the site, say where submissions go, choose the fields and the design —
            the secret key is issued at the end.
          </p>
        </div>
        <Link href="/dashboard/register" className="btn-primary">
          Register an app
        </Link>
      </div>

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

      <section className="app-list" aria-label="Your registered apps">
        {!loaded ? (
          <p className="muted">Loading…</p>
        ) : apps.length === 0 ? (
          <p className="muted">No apps yet. Register one to get a secret key.</p>
        ) : (
          apps.map((a) => (
            <div className="app-item" key={a.id}>
              <div className="app-item-head">
                <div>
                  <h3>{a.websiteName}</h3>
                  <p>
                    → {a.destinationEmail}{" "}
                    {a.destinationVerified ? (
                      <span className="status-ok">confirmed</span>
                    ) : (
                      <span className="status-fail">awaiting confirmation</span>
                    )}
                  </p>
                  <p>Design: {designName(a.templateId)}</p>
                  <p>
                    Fields:{" "}
                    {a.fields.map((f, i) => (
                      <span key={f.id}>
                        {i > 0 && ", "}
                        <code>{f.id}</code>
                        {/* The label only differs from the id when the owner set one —
                            showing both would double the length of every row. */}
                        {f.name.toLowerCase() !== f.id.toLowerCase() && ` (${f.name})`}
                      </span>
                    ))}
                  </p>
                  <p>
                    Auto-reply:{" "}
                    {a.autoResponder?.enabled ? (
                      <span className="status-ok">on</span>
                    ) : (
                      <span className="muted">off</span>
                    )}{" "}
                    · Spam guard:{" "}
                    {guardSummary(a.spamGuard ?? SPAM_GUARD_OFF) || (
                      <span className="muted">off</span>
                    )}{" "}
                    · Attachments:{" "}
                    {a.attachments?.enabled ? (
                      <span className="status-ok">up to {a.attachments.maxFiles}</span>
                    ) : (
                      <span className="muted">off</span>
                    )}
                  </p>
                  {!a.destinationVerified && (
                    <p>
                      No secret key has been issued yet, and submissions are rejected with{" "}
                      <code>403</code> until this address is confirmed.
                    </p>
                  )}
                </div>
                <div className="app-item-actions">
                  {/* One menu, not eight buttons — and while a panel is open it is a
                      Cancel button, which is what limits the row to one action at a time. */}
                  {action?.appId === a.id ? (
                    <button type="button" className="regen-btn" onClick={closeAction}>
                      Cancel
                    </button>
                  ) : (
                    <select
                      className="action-select"
                      aria-label={`Actions for ${a.websiteName}`}
                      value=""
                      onChange={(e) => {
                        const value = e.target.value;
                        if (!value) return;
                        // Not a panel: it asks for confirmation and then shows the key
                        // below, so the menu goes straight back to its placeholder.
                        if (value === "key") {
                          e.target.value = "";
                          onRegenerate(a);
                          return;
                        }
                        openAction(a, value as ActionKind);
                      }}
                      disabled={regeneratingId === a.id}
                    >
                      <option value="">
                        {regeneratingId === a.id ? "Generating…" : "Actions…"}
                      </option>
                      {ACTION_ORDER.map((kind) => (
                        <option key={kind} value={kind}>
                          {ACTION_LABELS[kind]}
                        </option>
                      ))}
                      {/* Only an app with a confirmed destination has a key to replace. */}
                      {a.destinationVerified && <option value="key">Regenerate key</option>}
                    </select>
                  )}
                  {!a.destinationVerified && (
                    <button
                      type="button"
                      className="regen-btn"
                      aria-expanded={otpTarget?.id === a.id}
                      onClick={() => openOtpPanel(a)}
                    >
                      {otpTarget?.id === a.id ? "Cancel" : "Enter code"}
                    </button>
                  )}
                </div>
              </div>

              {otpTarget?.id === a.id && otpPanel}

              {isOpen(a, "fields") && draft && (
                <div className="design-edit">
                  <FieldsEditor
                    fields={draft.fields}
                    onChange={(fields) => setDraft({ ...draft, fields })}
                    idPrefix={`fields-${a.id}`}
                  />
                  <button type="button" className="regen-btn" disabled={saving} onClick={onSaveFields}>
                    {saving ? "Saving…" : "Save fields"}
                  </button>
                </div>
              )}

              {isOpen(a, "design") && draft && (
                <div className="design-edit">
                  <DesignPicker
                    designs={designs}
                    value={draft.templateId}
                    onChange={(templateId) => setDraft({ ...draft, templateId })}
                    idPrefix={`design-${a.id}`}
                  />
                  <button
                    type="button"
                    className="regen-btn"
                    disabled={saving || draft.templateId === a.templateId}
                    onClick={() =>
                      save({ templateId: draft.templateId }, GUARD_MESSAGES, "Design changed.")
                    }
                  >
                    {saving ? "Saving…" : "Save design"}
                  </button>
                </div>
              )}

              {isOpen(a, "reply") && draft && (
                <div className="design-edit">
                  <AutoReplyEditor
                    autoResponder={draft.autoResponder}
                    websiteName={a.websiteName}
                    onChange={(autoResponder) => setDraft({ ...draft, autoResponder })}
                    idPrefix={`reply-${a.id}`}
                  />
                  <button
                    type="button"
                    className="regen-btn"
                    disabled={saving}
                    onClick={() =>
                      save(
                        { autoResponder: draft.autoResponder },
                        GUARD_MESSAGES,
                        draft.autoResponder.enabled
                          ? "Auto-reply saved. Submitters get a confirmation from now on."
                          : "Auto-reply saved and switched off."
                      )
                    }
                  >
                    {saving ? "Saving…" : "Save auto-reply"}
                  </button>
                </div>
              )}

              {isOpen(a, "guard") && draft && (
                <div className="design-edit">
                  <SpamGuardEditor
                    guard={draft.guard}
                    onChange={(guard) => setDraft({ ...draft, guard })}
                    idPrefix={`guard-${a.id}`}
                  />
                  <button
                    type="button"
                    className="regen-btn"
                    disabled={saving}
                    onClick={() => save({ spamGuard: draft.guard }, GUARD_MESSAGES, "Spam guard saved.")}
                  >
                    {saving ? "Saving…" : "Save spam guard"}
                  </button>
                </div>
              )}

              {isOpen(a, "attachments") && draft && (
                <div className="design-edit">
                  <AttachmentsEditor
                    attachments={draft.attachments}
                    onChange={(attachments) => setDraft({ ...draft, attachments })}
                    idPrefix={`attachments-${a.id}`}
                  />
                  <button
                    type="button"
                    className="regen-btn"
                    disabled={saving}
                    onClick={() =>
                      save(
                        { attachments: draft.attachments },
                        GUARD_MESSAGES,
                        draft.attachments.enabled
                          ? "Attachments saved. Add a file input to your form — the endpoint is unchanged."
                          : "Attachments saved and switched off."
                      )
                    }
                  >
                    {saving ? "Saving…" : "Save attachments"}
                  </button>
                </div>
              )}

              {isOpen(a, "code") && (
                <div className="design-edit">
                  <CodeSnippets
                    endpoint={`${baseUrl}/api/v1/send`}
                    fields={a.fields}
                    spamGuard={a.spamGuard ?? SPAM_GUARD_OFF}
                    attachments={a.attachments ?? ATTACHMENTS_OFF}
                  />
                </div>
              )}

              {secretCard(a)}

              {/* Last in the row, and only for an app that has a key: before the
                  destination is confirmed there is nothing that could have been sent. */}
              {a.destinationVerified && (
                <div className="design-edit">
                  <ActivityPanel appId={a.id} />
                </div>
              )}
            </div>
          ))
        )}
      </section>
    </>
  );
}
