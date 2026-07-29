"use client";

import { useEffect, useState } from "react";

// The owner's own delivery history for one app (SPEC §4f). Until now only admins could
// see whether a submission actually left the building — including the `smtp_failed`
// rows that carry the provider's real error, and the guard rows that explain a form
// that has gone quiet.

type Log = {
  id: string;
  kind: "submission" | "autoresponse";
  status: "sent" | "smtp_failed" | "blocked_bot" | "blocked_spam";
  error: string | null;
  createdAt: string;
};

type Counts = { sent: number; smtp_failed: number; blocked_bot: number; blocked_spam: number };

const STATUS_LABEL: Record<Log["status"], string> = {
  sent: "Sent",
  smtp_failed: "Failed",
  blocked_bot: "Blocked (bot)",
  blocked_spam: "Blocked (spam)",
};

export function ActivityPanel({ appId }: { appId: string }) {
  const [logs, setLogs] = useState<Log[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [today, setToday] = useState<{ used: number; limit: number } | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLoaded(false);
    fetch(`/api/apps/${appId}/logs?page=${page}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return;
        if (!data) {
          setFailed(true);
          return;
        }
        setLogs(data.logs);
        setCounts(data.counts);
        setToday(data.today);
        setTotal(data.total);
        setPageSize(data.pageSize);
      })
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, [appId, page]);

  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  if (failed) {
    return (
      <div className="msg error" role="alert">
        Could not load this app&rsquo;s activity. Please try again.
      </div>
    );
  }
  if (!loaded && logs.length === 0) return <p className="muted">Loading…</p>;

  return (
    <div className="activity-panel">
      {counts && today && (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-value">{counts.sent}</div>
            <div className="stat-label">Sent</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{counts.smtp_failed}</div>
            <div className="stat-label">Failed</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{counts.blocked_bot + counts.blocked_spam}</div>
            <div className="stat-label">Blocked</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">
              {today.used}
              <span className="stat-of">/{today.limit}</span>
            </div>
            <div className="stat-label">Used today</div>
          </div>
        </div>
      )}

      {total === 0 ? (
        <p className="muted">
          Nothing sent yet. Every attempt on this app — delivered, failed or blocked —
          appears here for 90 days.
        </p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>{new Date(l.createdAt).toLocaleString()}</td>
                    <td>{l.kind === "autoresponse" ? "Auto-reply" : "Submission"}</td>
                    <td>
                      <span className={l.status === "sent" ? "status-ok" : "status-fail"}>
                        {STATUS_LABEL[l.status]}
                      </span>
                    </td>
                    {/* The provider's own words, or which guard fired — that is the
                        whole point of showing this to the owner. */}
                    <td className="activity-detail">{l.error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lastPage > 0 && (
            <div className="pager">
              <button type="button" disabled={page <= 0} onClick={() => setPage((p) => p - 1)}>
                ← Prev
              </button>
              <span className="muted">
                Page {page + 1} of {lastPage + 1} · {total} total
              </span>
              <button
                type="button"
                disabled={page >= lastPage}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
