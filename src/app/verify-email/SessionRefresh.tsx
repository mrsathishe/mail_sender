"use client";

import { useEffect, useRef } from "react";

// Swaps a stale session cookie for one matching the DB, then continues to the
// dashboard. Rendered only when the server has already established that this
// account is verified.
export function SessionRefresh() {
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    fetch("/api/auth/refresh-session", { method: "POST" }).then(() => {
      // Full navigation, not router.replace: the cookie just changed, and only a
      // fresh document load has every server render (header included) reading the
      // new claim.
      window.location.assign("/dashboard");
    });
  }, []);

  return <p className="muted">Your email is already verified — taking you to your apps…</p>;
}
