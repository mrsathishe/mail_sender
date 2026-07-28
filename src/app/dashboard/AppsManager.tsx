"use client";

import { useEffect, useState } from "react";
import { DesignPicker, type Design } from "./DesignPicker";

type App = {
  id: string;
  websiteName: string;
  destinationEmail: string;
  templateId: string;
  createdAt: string;
};

export function AppsManager({ designs }: { designs: Design[] }) {
  const [apps, setApps] = useState<App[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<{ name: string; key: string } | null>(null);
  const [newTemplateId, setNewTemplateId] = useState(designs[0].id);
  // Which app has its "change design" panel open, and the pending selection.
  const [editing, setEditing] = useState<{ id: string; templateId: string } | null>(null);
  const [savingDesign, setSavingDesign] = useState(false);

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

  async function onRegenerate(app: App) {
    const ok = window.confirm(
      `Generate a new secret key for “${app.websiteName}”?\n\n` +
        "The current key will stop working immediately — you'll need to update " +
        "it wherever your website uses it."
    );
    if (!ok) return;

    setError("");
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

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setCreating(true);
    const form = e.currentTarget;
    const data = new FormData(form);
    const res = await fetch("/api/apps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        websiteName: data.get("websiteName"),
        destinationEmail: data.get("destinationEmail"),
        templateId: newTemplateId,
      }),
    });
    setCreating(false);
    if (res.ok) {
      const created = await res.json();
      setNewSecret({ name: created.websiteName, key: created.secretKey });
      form.reset();
      setNewTemplateId(designs[0].id);
      load();
    } else {
      setError("Could not create app. Check the name and a valid email address.");
    }
  }

  return (
    <>
      <form className="card" style={{ maxWidth: "100%" }} onSubmit={onCreate}>
        <h1 style={{ fontSize: "1.1rem" }}>Register a new app</h1>
        {error && <div className="msg error">{error}</div>}
        <label htmlFor="websiteName">Website name</label>
        <input id="websiteName" name="websiteName" type="text" required placeholder="Acme contact form" />
        <label htmlFor="destinationEmail">Email to send submissions to</label>
        <input id="destinationEmail" name="destinationEmail" type="email" required placeholder="support@acme.com" />
        <p className="muted" style={{ margin: "-0.5rem 0 1rem" }}>
          Any inbox works — Gmail, Zoho, Outlook or your own domain.
        </p>

        <label>Mail design</label>
        <DesignPicker
          designs={designs}
          value={newTemplateId}
          onChange={setNewTemplateId}
          idPrefix="new-design"
        />

        <button type="submit" disabled={creating} style={{ marginTop: "1rem" }}>
          {creating ? "Generating…" : "Register app & generate secret"}
        </button>
      </form>

      {newSecret && (
        <div className="card" style={{ maxWidth: "100%", marginTop: "1rem" }}>
          <h1 style={{ fontSize: "1.1rem" }}>Secret key for “{newSecret.name}”</h1>
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

      <div style={{ marginTop: "2rem" }}>
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
                  <p>→ {a.destinationEmail}</p>
                  <p>Design: {designName(a.templateId)}</p>
                </div>
                <div className="app-item-actions">
                  <button
                    type="button"
                    className="regen-btn"
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
                    onClick={() => onRegenerate(a)}
                    disabled={regeneratingId === a.id}
                  >
                    {regeneratingId === a.id ? "Generating…" : "Regenerate key"}
                  </button>
                </div>
              </div>

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
            </div>
          ))
        )}
      </div>
    </>
  );
}
