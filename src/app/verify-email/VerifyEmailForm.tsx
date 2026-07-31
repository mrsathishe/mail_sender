"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { LogoutButton } from "@/components/LogoutButton";

const MESSAGES: Record<string, string> = {
  invalid: "That code isn't right. Check the email and try again.",
  expired: "That code has expired. Send yourself a new one.",
  too_many_attempts: "Too many wrong attempts. Send yourself a new code.",
  no_code: "No code is pending. Send yourself a new one.",
};

export function VerifyEmailForm({ email }: { email: string }) {
  // register redirects here with ?sent=0 when the code mail didn't go out, so the
  // page doesn't promise an email that never left.
  const sendFailed = useSearchParams().get("sent") === "0";
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: form.get("code") }),
    });
    if (res.ok) {
      // Verified. That response re-minted the session cookie, so leave via a full
      // navigation rather than a client push: it is what guarantees the header and
      // the edge gate both read the new `emailVerified` claim instead of a cached
      // render (same reason LogoutButton does it). Keep the button disabled until
      // the dashboard takes over.
      window.location.assign("/dashboard");
      return;
    }
    setLoading(false);
    const data = await res.json().catch(() => ({}));
    setError(MESSAGES[data.error] ?? "Could not verify that code.");
  }

  async function onResend() {
    setError("");
    setNotice("");
    setResending(true);
    const res = await fetch("/api/auth/resend-verification-email", { method: "POST" });
    setResending(false);
    if (res.ok) setNotice(`A new code is on its way to ${email}.`);
    else setError("Could not send a new code. Please try again.");
  }

  return (
    <form onSubmit={onSubmit}>
      <p className="muted">
        We emailed an 8-character code to <strong>{email}</strong>. Enter it to
        finish setting up your account.
      </p>
      {sendFailed && !notice && (
        <div className="msg error">
          We couldn&rsquo;t send that email just now. Use &ldquo;Send a new
          code&rdquo; below.
        </div>
      )}
      {error && <div className="msg error">{error}</div>}
      {notice && <div className="msg ok">{notice}</div>}
      <label htmlFor="code">Verification code</label>
      <input
        id="code"
        name="code"
        type="text"
        required
        maxLength={8}
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="ABCD2345"
        className="otp-input"
      />
      <button type="submit" disabled={loading}>
        {loading ? "Verifying…" : "Verify email"}
      </button>
      <div className="row">
        <button type="button" className="link-btn" onClick={onResend} disabled={resending}>
          {resending ? "Sending…" : "Send a new code"}
        </button>
        <LogoutButton />
      </div>
    </form>
  );
}
