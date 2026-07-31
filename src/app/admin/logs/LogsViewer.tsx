"use client";

import { useEffect, useState } from "react";

type Log = {
  id: string;
  websiteName: string;
  destinationEmail: string;
  kind: "submission" | "autoresponse";
  status: "sent" | "smtp_failed" | "blocked_bot" | "blocked_spam" | "blocked_attachment";
  error: string | null;
  createdAt: string;
};

// `blocked_*` rows never reached SMTP — the bot, content or attachment guard refused
// them (SPEC §4d), which is a different fact from a failed send.
const STATUS_LABEL: Record<Log["status"], string> = {
  sent: "Sent",
  smtp_failed: "Failed",
  blocked_bot: "Blocked (bot)",
  blocked_spam: "Blocked (spam)",
  blocked_attachment: "Blocked (attachment)",
};

export function LogsViewer() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    setLoaded(false);
    fetch(`/api/admin/logs?page=${page}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        setLogs(data.logs);
        setTotal(data.total);
        setPageSize(data.pageSize);
      })
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, [page]);

  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  if (!loaded && logs.length === 0) return <p className="muted">Loading…</p>;
  if (total === 0) return <p className="muted">No send activity yet.</p>;

  return (
    <>
      <div className="table-scroll">
        <table className="admin-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Website</th>
            <th>Destination</th>
            <th>Email</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id}>
              <td>{new Date(l.createdAt).toLocaleString()}</td>
              <td>{l.websiteName}</td>
              <td>{l.destinationEmail}</td>
              <td>{l.kind === "autoresponse" ? "Auto-reply" : "Submission"}</td>
              <td>
                <span className={l.status === "sent" ? "status-ok" : "status-fail"}>
                  {STATUS_LABEL[l.status]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
      <div className="pager">
        <button type="button" disabled={page <= 0} onClick={() => setPage((p) => p - 1)}>
          ← Prev
        </button>
        <span className="muted">
          Page {page + 1} of {lastPage + 1} · {total} total
        </span>
        <button type="button" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
          Next →
        </button>
      </div>
    </>
  );
}
