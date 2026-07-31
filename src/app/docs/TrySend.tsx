"use client";

import { useRef, useState } from "react";
import {
  ACCEPT_ATTRIBUTE,
  ATTACHMENT_MAX_TOTAL_BYTES,
  formatBytes,
} from "@/lib/attachments";

const DEFAULT_BODY = `{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "message": "Hello from the docs page!"
}`;

type Result = { status: number; body: string; ok: boolean } | { error: string } | null;

// Live tester: paste an app's secret key + a JSON payload and actually call
// POST /api/v1/send. This sends a REAL email to that app's destination inbox.
//
// Attaching a file switches it to the multipart endpoint, because that is the only way
// to exercise uploads without a terminal — the JSON fields become form parts, which is
// exactly the shape a customer's own route would forward.
export function TrySend({
  endpoint,
  attachmentEndpoint,
}: {
  endpoint: string;
  attachmentEndpoint: string;
}) {
  const [secret, setSecret] = useState("");
  const [body, setBody] = useState(DEFAULT_BODY);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function send() {
    setResult(null);

    if (!secret.trim()) {
      setResult({ error: "Enter your app's secret key first." });
      return;
    }
    // Validate the JSON locally so we show a clear error instead of a 400.
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body);
    } catch {
      setResult({ error: "Request body is not valid JSON." });
      return;
    }

    const files = Array.from(fileInput.current?.files ?? []);
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > ATTACHMENT_MAX_TOTAL_BYTES) {
      setResult({
        error: `Those files come to ${formatBytes(total)} — the limit is ${formatBytes(
          ATTACHMENT_MAX_TOTAL_BYTES
        )}.`,
      });
      return;
    }

    setSending(true);
    try {
      // With files this has to be multipart, and the browser must set Content-Type
      // itself so the boundary matches the body it built.
      let request: { url: string; headers: Record<string, string>; body: BodyInit };
      if (files.length > 0) {
        const form = new FormData();
        for (const [key, value] of Object.entries(parsed)) {
          form.append(key, typeof value === "string" ? value : JSON.stringify(value));
        }
        for (const file of files) form.append("files", file);
        request = { url: attachmentEndpoint, headers: {}, body: form };
      } else {
        request = {
          url: endpoint,
          headers: { "Content-Type": "application/json" },
          body,
        };
      }

      const res = await fetch(request.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret.trim()}`, ...request.headers },
        body: request.body,
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

      <label htmlFor="try-files">Attachments (optional)</label>
      <input
        id="try-files"
        ref={fileInput}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        aria-describedby="try-files-help"
      />
      <p className="muted field-help" id="try-files-help">
        Attach a file and the request goes to <code>/api/v1/sendWithAttachment</code> as{" "}
        <code>multipart/form-data</code> instead, with the fields above as form parts. The
        app needs attachments switched on, or the answer is{" "}
        <code>422 attachments_not_enabled</code>.
      </p>

      <button type="button" className="send-btn" onClick={send} disabled={sending}>
        {sending ? "Sending…" : "Send test email"}
      </button>

      <p className="muted" style={{ marginTop: "0.75rem" }}>
        This sends a real email to the destination address configured for that app,
        using its selected mail design.
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
