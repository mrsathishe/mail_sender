"use client";

import { useState } from "react";

const DEFAULT_BODY = `{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "message": "Hello from the docs page!"
}`;

type Result = { status: number; body: string; ok: boolean } | { error: string } | null;

// Live tester: paste an app's secret key + a JSON payload and actually call
// POST /api/v1/send. This sends a REAL email to that app's destination Gmail.
export function TrySend({ endpoint }: { endpoint: string }) {
  const [secret, setSecret] = useState("");
  const [body, setBody] = useState(DEFAULT_BODY);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Result>(null);

  async function send() {
    setResult(null);

    if (!secret.trim()) {
      setResult({ error: "Enter your app's secret key first." });
      return;
    }
    // Validate the JSON locally so we show a clear error instead of a 400.
    try {
      JSON.parse(body);
    } catch {
      setResult({ error: "Request body is not valid JSON." });
      return;
    }

    setSending(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret.trim()}`,
          "Content-Type": "application/json",
        },
        body,
      });
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* leave as-is */
      }
      setResult({ status: res.status, body: pretty, ok: res.ok });
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "Request failed." });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="try-panel">
      <label htmlFor="try-secret">Secret key</label>
      <input
        id="try-secret"
        type="password"
        placeholder="Paste the secret key shown when you registered the app"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        autoComplete="off"
      />

      <label htmlFor="try-body">Request body (JSON)</label>
      <textarea
        id="try-body"
        rows={6}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />

      <button type="button" className="send-btn" onClick={send} disabled={sending}>
        {sending ? "Sending…" : "Send test email"}
      </button>

      <p className="muted" style={{ marginTop: "0.75rem" }}>
        This sends a real email to the destination Gmail configured for that app.
      </p>

      {result && "error" in result && <div className="msg error">{result.error}</div>}

      {result && "status" in result && (
        <div className="try-result">
          <div className={result.ok ? "status-ok" : "status-fail"}>
            HTTP {result.status} {result.ok ? "— success" : "— failed"}
          </div>
          <pre>{result.body}</pre>
        </div>
      )}
    </div>
  );
}
