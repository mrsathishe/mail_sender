"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
    });
    setLoading(false);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      // The account exists but is unverified — the OTP page is the only place it
      // can go until the emailed code is entered. Pass on a failed send so that
      // page offers a resend instead of claiming mail is on its way.
      router.push(data.codeSent === false ? "/verify-email?sent=0" : "/verify-email");
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(
      data.error === "email_taken"
        ? "That email is already registered."
        : "Could not create account. Password must be at least 8 characters."
    );
  }

  return (
    <div className="center">
      <form className="card" onSubmit={onSubmit}>
        <h1>Create account</h1>
        {error && <div className="msg error">{error}</div>}
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
        <button type="submit" disabled={loading}>
          {loading ? "Creating…" : "Create account"}
        </button>
        <div className="row">
          <Link href="/login">Already have an account? Log in</Link>
        </div>
      </form>
    </div>
  );
}
