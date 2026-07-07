"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.get("email") }),
    });
    setLoading(false);
    setSent(true);
  }

  return (
    <div className="center">
      <form className="card" onSubmit={onSubmit}>
        <h1>Reset password</h1>
        {sent ? (
          <>
            <div className="msg ok">
              If that email is registered, a reset link is on its way. The link is
              valid for 30 minutes.
            </div>
            <div className="row">
              <Link href="/login">Back to log in</Link>
            </div>
          </>
        ) : (
          <>
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" />
            <button type="submit" disabled={loading}>
              {loading ? "Sending…" : "Send reset link"}
            </button>
            <div className="row">
              <Link href="/login">Back to log in</Link>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
