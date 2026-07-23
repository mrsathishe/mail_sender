"use client";

import { useEffect, useState } from "react";

type App = {
  id: string;
  websiteName: string;
  destinationGmail: string;
  createdAt: string;
};

export function AppsManager() {
  const [apps, setApps] = useState<App[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<{ name: string; key: string } | null>(null);

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
        destinationGmail: data.get("destinationGmail"),
      }),
    });
    setCreating(false);
    if (res.ok) {
      const created = await res.json();
      setNewSecret({ name: created.websiteName, key: created.secretKey });
      form.reset();
      load();
    } else {
      setError("Could not create app. Check the name and a valid Gmail address.");
    }
  }

  return (
    <>
      <form className="card" style={{ maxWidth: "100%" }} onSubmit={onCreate}>
        <h1 style={{ fontSize: "1.1rem" }}>Register a new app</h1>
        {error && <div className="msg error">{error}</div>}
        <label htmlFor="websiteName">Website name</label>
        <input id="websiteName" name="websiteName" type="text" required placeholder="Acme contact form" />
        <label htmlFor="destinationGmail">Gmail to send submissions to</label>
        <input id="destinationGmail" name="destinationGmail" type="email" required placeholder="support@acme.com" />
        <button type="submit" disabled={creating}>
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
                  <p>→ {a.destinationGmail}</p>
                </div>
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
          ))
        )}
      </div>
    </>
  );
}
