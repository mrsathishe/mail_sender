"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
    });
    setLoading(false);
    if (res.ok) {
      router.push("/dashboard");
      router.refresh();
    } else {
      setError("Invalid email or password.");
    }
  }

  return (
    <div className="center">
      <form className="card" onSubmit={onSubmit}>
        <h1>Log in</h1>
        {error && <div className="msg error">{error}</div>}
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" />
        <button type="submit" disabled={loading}>
          {loading ? "Logging in…" : "Log in"}
        </button>
        <div className="row">
          <Link href="/register">Create an account</Link>
          <Link href="/forgot-password">Forgot password?</Link>
        </div>
      </form>
    </div>
  );
}
