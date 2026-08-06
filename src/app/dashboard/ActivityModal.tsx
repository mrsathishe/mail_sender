"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// The log table that used to sit inside the app row (SPEC §4f). It moved behind a
// "More info" link because the panel's job is the four counts — "did my form work" —
// while reading rows is a second, longer task that wants room, filters and a way to
// take the answer away with you.
//
// Nothing polls here either: the modal reads when it opens, when a filter changes and
// when the page changes, so a fetch is always something the owner asked for.

export type Log = {
  id: string;
  kind: "submission" | "autoresponse";
  status: "sent" | "smtp_failed" | "blocked_bot" | "blocked_spam" | "blocked_attachment";
  error: string | null;
  createdAt: string;
};

export const STATUS_LABEL: Record<Log["status"], string> = {
  sent: "Sent",
  smtp_failed: "Failed",
  blocked_bot: "Blocked (bot)",
  blocked_spam: "Blocked (spam)",
  blocked_attachment: "Blocked (attachment)",
};

/** Every value of `SendLog.status`, so the filter can never offer a status that no row carries. */
const STATUS_OPTIONS = Object.keys(STATUS_LABEL) as Log["status"][];

const FOCUSABLE = 'button:not(:disabled), select, input, [href], [tabindex]:not([tabindex="-1"])';

type Page = { logs: Log[]; total: number; pageSize: number; truncated: boolean };

/**
 * One cell of CSV. Quoting is unconditional because the `error` column carries the
 * provider's own reply — `550 5.1.1 <a@b>: rejected, denied` has both a comma and the
 * shape of something a naive writer would break on. The leading-symbol guard is
 * separate: a spreadsheet reads `=`/`+`/`-`/`@` at the start of a cell as a formula, and
 * an SMTP reply or a guard reason is attacker-influenced text.
 */
function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function csvFor(rows: Log[]): string {
  const lines = [["When", "Email", "Status", "Detail"].map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        // ISO, not `toLocaleString()`: the file outlives the browser that made it, and a
        // locale-formatted date is ambiguous by the time someone else opens it.
        new Date(row.createdAt).toISOString(),
        row.kind === "autoresponse" ? "Auto-reply" : "Submission",
        STATUS_LABEL[row.status],
        row.error ?? "",
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\r\n");
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
}

export function ActivityModal({
  appId,
  appName,
  onClose,
}: {
  appId: string;
  appName: string;
  onClose: () => void;
}) {
  const [logs, setLogs] = useState<Log[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(0);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const [scope, setScope] = useState<"page" | "all">("page");
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [truncated, setTruncated] = useState(false);
  // Set only for the instant `window.print()` is on screen — see the effect below.
  const [printRows, setPrintRows] = useState<Log[] | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback(
    async (opts: { page?: number; all?: boolean }): Promise<Page | null> => {
      const params = new URLSearchParams();
      if (opts.all) params.set("all", "1");
      else params.set("page", String(opts.page ?? 0));
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (status) params.set("status", status);
      const res = await fetch(`/api/apps/${appId}/logs?${params}`);
      return res.ok ? ((await res.json()) as Page) : null;
    },
    [appId, from, to, status]
  );

  useEffect(() => {
    let active = true;
    setLoaded(false);
    setFailed(false);
    fetchPage({ page })
      .then((data) => {
        if (!active) return;
        if (!data) {
          setFailed(true);
          return;
        }
        setLogs(data.logs);
        setTotal(data.total);
        setPageSize(data.pageSize);
      })
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, [fetchPage, page]);

  // Focus moves in on open and back to whatever opened us on close, because the trigger
  // is a row deep in a list of apps and losing the caret sends the keyboard to the top.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => opener?.focus?.();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (items.length === 0) return;
    const edge = event.shiftKey ? items[0] : items[items.length - 1];
    if (document.activeElement === edge) {
      event.preventDefault();
      (event.shiftKey ? items[items.length - 1] : items[0]).focus();
    }
  };

  /** The rows the chosen scope means: this page as already loaded, or a fresh full read. */
  const exportRows = async (): Promise<Log[] | null> => {
    if (scope === "page") {
      setTruncated(false);
      return logs;
    }
    setBusy(true);
    const data = await fetchPage({ all: true });
    setBusy(false);
    if (!data) {
      setFailed(true);
      return null;
    }
    setTruncated(data.truncated);
    return data.logs;
  };

  const downloadCsv = async () => {
    const rows = await exportRows();
    if (!rows) return;
    const blob = new Blob([csvFor(rows)], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `${slug(appName)}-activity-${from || "start"}-to-${to || "today"}.csv`;
    link.click();
    URL.revokeObjectURL(href);
  };

  const downloadPdf = async () => {
    const rows = await exportRows();
    if (!rows) return;
    setPrintRows(rows);
  };

  // Print-to-PDF rather than a PDF library: the browser already has a typesetter and a
  // "Save as PDF" target, and the alternative is a dependency to render a four-column
  // table. The rows have to be in the DOM for the print view to see them, which is why
  // an "all rows" export lands them here first; `print()` blocks, so clearing them
  // straight after is safe.
  useEffect(() => {
    if (!printRows) return;
    window.print();
    setPrintRows(null);
  }, [printRows]);

  const rows = printRows ?? logs;
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const filtered = Boolean(from || to || status);

  const changeFilter = (apply: () => void) => {
    apply();
    // A filter narrows the set, so the page number it was read on is meaningless.
    setPage(0);
    setTruncated(false);
  };

  return createPortal(
    <div
      className="activity-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="activity-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-modal-title"
        ref={dialogRef}
        onKeyDown={onKeyDown}
      >
        <div className="activity-modal-head">
          <h3 id="activity-modal-title">Activity · {appName}</h3>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close activity"
            data-autofocus
          >
            ✕
          </button>
        </div>

        <div className="activity-modal-filters">
          <label>
            From
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => changeFilter(() => setFrom(e.target.value))}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => changeFilter(() => setTo(e.target.value))}
            />
          </label>
          <label>
            Status
            <select value={status} onChange={(e) => changeFilter(() => setStatus(e.target.value))}>
              <option value="">Any status</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="link-btn"
            disabled={!filtered}
            onClick={() => changeFilter(() => {
              setFrom("");
              setTo("");
              setStatus("");
            })}
          >
            Clear filters
          </button>
        </div>

        <div className="activity-modal-export">
          <label>
            Export
            <select value={scope} onChange={(e) => setScope(e.target.value as "page" | "all")}>
              <option value="page">This page</option>
              <option value="all">All rows matching the filters</option>
            </select>
          </label>
          <button type="button" className="regen-btn" onClick={downloadCsv} disabled={busy}>
            Download CSV
          </button>
          <button type="button" className="regen-btn" onClick={downloadPdf} disabled={busy}>
            Download PDF
          </button>
        </div>

        {truncated && (
          <p className="msg error" role="status">
            Only the newest 5,000 matching rows were exported. Narrow the date range to
            reach the rest.
          </p>
        )}

        {failed ? (
          <div className="msg error" role="alert">
            Could not load these rows. Change a filter to try again.
          </div>
        ) : !loaded && rows.length === 0 ? (
          <p className="muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="muted">No attempts match these filters.</p>
        ) : (
          <>
            <div className="table-scroll log-table-wrap">
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
                  {rows.map((l) => (
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
    </div>,
    // Into `body`, not the app row it was opened from: the printed page is produced by
    // hiding every *other* child of body (see the @media print rules), which an inline
    // dialog buried in the dashboard tree cannot be separated from — and a fixed
    // backdrop nested in a scrolling row is at the mercy of its ancestors' overflow.
    document.body
  );
}
