"use client";

import { useEffect, useState } from "react";
import { DesignPicker, type Design } from "./DesignPicker";
import { FieldsEditor } from "./FieldsEditor";
import { SpamGuardEditor } from "./SpamGuardEditor";
import { AutoReplyEditor } from "./AutoReplyEditor";
import { ActivityPanel } from "./ActivityPanel";
import { DEFAULT_FIELDS, type AppField } from "@/lib/fields";
import { SPAM_GUARD_OFF, type SpamGuard } from "@/lib/bot-guard";
import { AUTO_RESPONDER_OFF, type AutoResponder } from "@/lib/auto-responder";

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
  createdAt: string;
};

type OtpTarget = { id: string; websiteName: string; destinationEmail: string };

const OTP_MESSAGES: Record<string, string> = {
  invalid: "That code isn't right. Check the email and try again.",
  expired: "That code has expired. Send a new one.",
  too_many_attempts: "Too many wrong attempts. Send a new code.",
  no_code: "No code is pending. Send a new one.",
};

const FIELD_MESSAGES: Record<string, string> = {
  no_fields: "An app needs at least one field.",
  too_many_fields: "That's too many fields.",
  invalid_field_name:
    "Field names must start with a letter and use only letters, digits, _ or -.",
  duplicate_field: "Two fields have the same name.",
};

const GUARD_MESSAGES: Record<string, string> = {
  invalid_guard_field:
    "Guard field names must start with a letter, use only letters, digits, _ or -, and differ from each other.",
  invalid_min_seconds: "The minimum time must be a whole number of seconds, 0–60.",
  timing_field_missing: "A minimum time needs a timing field name to measure against.",
  invalid_auto_reply: "That auto-reply isn't valid. Check the subject and message.",
  auto_reply_too_long: "The auto-reply subject or message is too long.",
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
  accountEmail,
}: {
  designs: Design[];
  accountEmail: string;
}) {
  const [apps, setApps] = useState<App[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<{ name: string; key: string } | null>(null);
  // Widened to string: the picker hands back whichever id was clicked, and the
  // server is what validates it against the catalog.
  const [newTemplateId, setNewTemplateId] = useState<string>(designs[0].id);
  const [newFields, setNewFields] = useState<AppField[]>(DEFAULT_FIELDS.map((f) => ({ ...f })));
  // Destination field is controlled so the "my own address" checkbox can fill it.
  const [useOwnEmail, setUseOwnEmail] = useState(false);
  const [destination, setDestination] = useState("");
  // Which app is awaiting a destination code, and the code being typed for it.
  const [otpTarget, setOtpTarget] = useState<OtpTarget | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [resending, setResending] = useState(false);
  // Which app has its "change design" panel open, and the pending selection.
  const [editing, setEditing] = useState<{ id: string; templateId: string } | null>(null);
  const [savingDesign, setSavingDesign] = useState(false);
  // Same, for the field list.
  const [editingFields, setEditingFields] = useState<{ id: string; fields: AppField[] } | null>(
    null
  );
  const [savingFields, setSavingFields] = useState(false);
  // Same, for the bot guard and the auto-reply.
  const [editingGuard, setEditingGuard] = useState<{ id: string; guard: SpamGuard } | null>(null);
  const [savingGuard, setSavingGuard] = useState(false);
  const [editingReply, setEditingReply] = useState<{
    id: string;
    autoResponder: AutoResponder;
  } | null>(null);
  const [savingReply, setSavingReply] = useState(false);
  // Which app's delivery history is open. Mounted lazily so no app fetches its logs
  // until asked for them.
  const [activityId, setActivityId] = useState<string | null>(null);

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

  function onToggleOwnEmail(checked: boolean) {
    setUseOwnEmail(checked);
    setDestination(checked ? accountEmail : "");
  }

  // Cheap pre-flight so an obvious slip is reported without a round trip; the
  // server re-checks all of this in lib/fields.
  function fieldsProblem(fields: AppField[]): string {
    if (fields.length === 0) return FIELD_MESSAGES.no_fields;
    const seen = new Set<string>();
    for (const f of fields) {
      const name = f.name.trim();
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(name)) return FIELD_MESSAGES.invalid_field_name;
      if (seen.has(name.toLowerCase())) return FIELD_MESSAGES.duplicate_field;
      seen.add(name.toLowerCase());
    }
    return "";
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
      setNewSecret({ name: data.websiteName, key: data.secretKey });
    } else {
      setError("Could not regenerate the key. Please try again.");
    }
  }

  function openOtpPanel(app: App) {
    setError("");
    setNotice("");
    setOtpCode("");
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
      setOtpTarget(null);
      setOtpCode("");
      // The key only exists from this moment — the app had none before.
      setNewSecret({ name: data.websiteName, key: data.secretKey });
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

  async function onSaveDesign() {
    if (!editing) return;
    setError("");
    setSavingDesign(true);
    const res = await fetch(`/api/apps/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: editing.templateId }),
    });
    setSavingDesign(false);
    if (res.ok) {
      setEditing(null);
      load();
    } else {
      setError("Could not change the design. Please try again.");
    }
  }

  async function onSaveFields() {
    if (!editingFields) return;
    const problem = fieldsProblem(editingFields.fields);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setNotice("");
    setSavingFields(true);
    const res = await fetch(`/api/apps/${editingFields.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: editingFields.fields }),
    });
    setSavingFields(false);
    if (res.ok) {
      setEditingFields(null);
      setNotice("Fields updated. Submissions are checked against the new list from now on.");
      load();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(FIELD_MESSAGES[data.error] ?? "Could not save the fields. Please try again.");
  }

  // Both panels PATCH the same route as the design and field editors; the server owns
  // the rules, so a rejection is reported by its own error code.
  async function onSaveGuard() {
    if (!editingGuard) return;
    setError("");
    setNotice("");
    setSavingGuard(true);
    const res = await fetch(`/api/apps/${editingGuard.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spamGuard: editingGuard.guard }),
    });
    setSavingGuard(false);
    if (res.ok) {
      setEditingGuard(null);
      setNotice("Spam guard saved.");
      load();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(GUARD_MESSAGES[data.error] ?? "Could not save the spam guard. Please try again.");
  }

  async function onSaveReply() {
    if (!editingReply) return;
    setError("");
    setNotice("");
    setSavingReply(true);
    const res = await fetch(`/api/apps/${editingReply.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoResponder: editingReply.autoResponder }),
    });
    setSavingReply(false);
    if (res.ok) {
      setEditingReply(null);
      setNotice(
        editingReply.autoResponder.enabled
          ? "Auto-reply saved. Submitters get a confirmation from now on."
          : "Auto-reply saved and switched off."
      );
      load();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(GUARD_MESSAGES[data.error] ?? "Could not save the auto-reply. Please try again.");
  }

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const problem = fieldsProblem(newFields);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setNotice("");
    setCreating(true);
    const form = e.currentTarget;
    const data = new FormData(form);
    const res = await fetch("/api/apps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        websiteName: data.get("websiteName"),
        destinationEmail: destination,
        templateId: newTemplateId,
        fields: newFields,
      }),
    });
    setCreating(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(
        FIELD_MESSAGES[body.error] ??
          "Could not create app. Check the name and a valid email address."
      );
      return;
    }

    const created = await res.json();
    form.reset();
    setDestination("");
    setUseOwnEmail(false);
    setNewTemplateId(designs[0].id);
    setNewFields(DEFAULT_FIELDS.map((f) => ({ ...f })));
    if (created.otpRequired) {
      // No key yet: it is issued when the destination code is entered.
      setOtpTarget({
        id: created.id,
        websiteName: created.websiteName,
        destinationEmail: created.destinationEmail,
      });
      setOtpCode("");
      setNotice(
        created.codeSent
          ? `We emailed a code to ${created.destinationEmail}. Enter it below to confirm the address and get your secret key.`
          : `We couldn't email ${created.destinationEmail} just now — use “Send a new code” below.`
      );
    } else {
      setNewSecret({ name: created.websiteName, key: created.secretKey });
    }
    load();
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

  return (
    <>
      <form className="card card-wide" onSubmit={onCreate}>
        <h2>Register a new app</h2>
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
        <label htmlFor="websiteName">Website name</label>
        <input id="websiteName" name="websiteName" type="text" required placeholder="Acme contact form" />

        <label htmlFor="destinationEmail">Email to send submissions to</label>
        <label className="checkbox-row" htmlFor="useOwnEmail">
          <input
            id="useOwnEmail"
            type="checkbox"
            checked={useOwnEmail}
            onChange={(e) => onToggleOwnEmail(e.target.checked)}
          />
          <span>
            Send to my account address (<strong>{accountEmail}</strong>) — already verified, so
            no code needed
          </span>
        </label>
        <input
          id="destinationEmail"
          name="destinationEmail"
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

        <h3 className="form-section">Form fields</h3>
        <FieldsEditor fields={newFields} onChange={setNewFields} idPrefix="new-field" />

        <h3 className="form-section">Mail design</h3>
        <DesignPicker
          designs={designs}
          value={newTemplateId}
          onChange={setNewTemplateId}
          idPrefix="new-design"
        />

        <button type="submit" disabled={creating} style={{ marginTop: "1rem" }}>
          {creating ? "Generating…" : "Register app"}
        </button>
      </form>

      {newSecret && (
        <div className="card card-wide" style={{ marginTop: "1rem" }}>
          <h2>Secret key for “{newSecret.name}”</h2>
          <p className="muted">
            Copy it now — this is the only time it is shown. Store it in your
            website&rsquo;s environment variables.
          </p>
          <div className="secret">{newSecret.key}</div>
          <button type="button" onClick={() => setNewSecret(null)}>
            I&rsquo;ve saved it
          </button>
        </div>
      )}

      {/* Panel for an app just created; unverified rows below open their own copy. */}
      {otpTarget && !apps.some((a) => a.id === otpTarget.id) && (
        <div className="card card-wide" style={{ marginTop: "1rem" }}>
          <h2>Confirm the destination address</h2>
          {otpPanel}
        </div>
      )}

      <section className="app-list" aria-label="Your registered apps">
        {!loaded ? (
          <p className="muted">Loading…</p>
        ) : apps.length === 0 ? (
          <p className="muted">No apps yet. Register one above to get a secret key.</p>
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
                      <span key={f.name}>
                        {i > 0 && ", "}
                        <code>{f.name}</code>
                        {f.required && <abbr title="required">*</abbr>}
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
                  <button
                    type="button"
                    className="regen-btn"
                    aria-expanded={editingFields?.id === a.id}
                    onClick={() =>
                      setEditingFields(
                        editingFields?.id === a.id
                          ? null
                          : { id: a.id, fields: a.fields.map((f) => ({ ...f })) }
                      )
                    }
                  >
                    {editingFields?.id === a.id ? "Cancel" : "Edit fields"}
                  </button>
                  <button
                    type="button"
                    className="regen-btn"
                    aria-expanded={editing?.id === a.id}
                    onClick={() =>
                      setEditing(
                        editing?.id === a.id ? null : { id: a.id, templateId: a.templateId }
                      )
                    }
                  >
                    {editing?.id === a.id ? "Cancel" : "Change design"}
                  </button>
                  <button
                    type="button"
                    className="regen-btn"
                    aria-expanded={editingReply?.id === a.id}
                    onClick={() =>
                      setEditingReply(
                        editingReply?.id === a.id
                          ? null
                          : {
                              id: a.id,
                              autoResponder: { ...(a.autoResponder ?? AUTO_RESPONDER_OFF) },
                            }
                      )
                    }
                  >
                    {editingReply?.id === a.id ? "Cancel" : "Auto-reply"}
                  </button>
                  <button
                    type="button"
                    className="regen-btn"
                    aria-expanded={editingGuard?.id === a.id}
                    onClick={() =>
                      setEditingGuard(
                        editingGuard?.id === a.id
                          ? null
                          : { id: a.id, guard: { ...(a.spamGuard ?? SPAM_GUARD_OFF) } }
                      )
                    }
                  >
                    {editingGuard?.id === a.id ? "Cancel" : "Spam guard"}
                  </button>
                  <button
                    type="button"
                    className="regen-btn"
                    aria-expanded={activityId === a.id}
                    onClick={() => setActivityId(activityId === a.id ? null : a.id)}
                  >
                    {activityId === a.id ? "Hide activity" : "Activity"}
                  </button>
                  {a.destinationVerified ? (
                    <button
                      type="button"
                      className="regen-btn"
                      onClick={() => onRegenerate(a)}
                      disabled={regeneratingId === a.id}
                    >
                      {regeneratingId === a.id ? "Generating…" : "Regenerate key"}
                    </button>
                  ) : (
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

              {editingFields?.id === a.id && (
                <div className="design-edit">
                  <FieldsEditor
                    fields={editingFields.fields}
                    onChange={(fields) => setEditingFields({ id: a.id, fields })}
                    idPrefix={`fields-${a.id}`}
                  />
                  <button
                    type="button"
                    className="regen-btn"
                    disabled={savingFields}
                    onClick={onSaveFields}
                  >
                    {savingFields ? "Saving…" : "Save fields"}
                  </button>
                </div>
              )}

              {editing?.id === a.id && (
                <div className="design-edit">
                  <DesignPicker
                    designs={designs}
                    value={editing.templateId}
                    onChange={(templateId) => setEditing({ id: a.id, templateId })}
                    idPrefix={`design-${a.id}`}
                  />
                  <button
                    type="button"
                    className="regen-btn"
                    disabled={savingDesign || editing.templateId === a.templateId}
                    onClick={onSaveDesign}
                  >
                    {savingDesign ? "Saving…" : "Save design"}
                  </button>
                </div>
              )}

              {editingReply?.id === a.id && (
                <div className="design-edit">
                  <AutoReplyEditor
                    autoResponder={editingReply.autoResponder}
                    websiteName={a.websiteName}
                    onChange={(autoResponder) => setEditingReply({ id: a.id, autoResponder })}
                    idPrefix={`reply-${a.id}`}
                  />
                  <button
                    type="button"
                    className="regen-btn"
                    disabled={savingReply}
                    onClick={onSaveReply}
                  >
                    {savingReply ? "Saving…" : "Save auto-reply"}
                  </button>
                </div>
              )}

              {editingGuard?.id === a.id && (
                <div className="design-edit">
                  <SpamGuardEditor
                    guard={editingGuard.guard}
                    onChange={(guard) => setEditingGuard({ id: a.id, guard })}
                    idPrefix={`guard-${a.id}`}
                  />
                  <button
                    type="button"
                    className="regen-btn"
                    disabled={savingGuard}
                    onClick={onSaveGuard}
                  >
                    {savingGuard ? "Saving…" : "Save spam guard"}
                  </button>
                </div>
              )}

              {activityId === a.id && (
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
