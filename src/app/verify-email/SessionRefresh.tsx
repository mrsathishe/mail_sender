"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Swaps a stale session cookie for one matching the DB, then continues to the
// dashboard. Rendered only when the server has already established that this
// account is verified.
export function SessionRefresh() {
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    fetch("/api/auth/refresh-session", { method: "POST" }).then(() => {
      router.replace("/dashboard");
      router.refresh();
    });
  }, [router]);

  return <p className="muted">Your email is already verified — taking you to your apps…</p>;
}
