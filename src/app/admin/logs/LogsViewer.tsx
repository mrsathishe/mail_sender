"use client";

import { useEffect, useState } from "react";

type Log = {
  id: string;
  websiteName: string;
  destinationGmail: string;
  status: "sent" | "smtp_failed";
  error: string | null;
  createdAt: string;
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
      <table className="admin-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Website</th>
            <th>Destination</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id}>
              <td>{new Date(l.createdAt).toLocaleString()}</td>
              <td>{l.websiteName}</td>
              <td>{l.destinationGmail}</td>
              <td>
                <span className={l.status === "sent" ? "status-ok" : "status-fail"}>
                  {l.status === "sent" ? "Sent" : "Failed"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
