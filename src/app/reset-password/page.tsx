"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: form.get("password") }),
    });
    setLoading(false);
    if (res.ok) {
      setDone(true);
    } else {
      setError("This reset link is invalid or has expired. Request a new one.");
    }
  }

  if (!token) {
    return <div className="msg error">Missing reset token. Use the link from your email.</div>;
  }
  if (done) {
    return (
      <>
        <div className="msg ok">Password updated. You can now log in.</div>
        <div className="row">
          <Link href="/login">Go to log in</Link>
        </div>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      {error && <div className="msg error">{error}</div>}
      <label htmlFor="password">New password</label>
      <input
        id="password"
        name="password"
        type="password"
        required
        minLength={8}
        autoComplete="new-password"
      />
      <button type="submit" disabled={loading}>
        {loading ? "Updating…" : "Set new password"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="center">
      <div className="card">
        <h1>Set a new password</h1>
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <ResetForm />
        </Suspense>
      </div>
    </div>
  );
}
