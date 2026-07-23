"use client";

import { useState } from "react";

// A code sample with a one-click copy button. Client component so it can use
// the clipboard API and track "Copied!" feedback.
export function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked (e.g. non-HTTPS) — no-op
    }
  }

  return (
    <div className="code-block">
      <button type="button" className="copy-btn" onClick={copy}>
        {copied ? "Copied!" : "Copy"}
      </button>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
