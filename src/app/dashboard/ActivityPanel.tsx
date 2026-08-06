"use client";

import { useCallback, useEffect, useState } from "react";
import { ActivityModal } from "./ActivityModal";

// The owner's own delivery history for one app (SPEC §4f). Until now only admins could
// see whether a submission actually left the building — including the `smtp_failed`
// rows that carry the provider's real error, and the guard rows that explain a form
// that has gone quiet.
//
// Shown for every app that has a key, at the bottom of its row, rather than behind a
// toggle: "did my form work" is the question an owner comes here with, and it should be
// answered before they have to ask. Nothing polls — sends arrive whenever a visitor
// submits, so the panel offers a refresh instead of guessing an interval.
//
// The counts stay inline; the rows themselves live in ActivityModal, which is where the
// filters and the CSV/PDF export can have room without pushing every other app row down.

type Counts = {
  sent: number;
  smtp_failed: number;
  blocked_bot: number;
  blocked_spam: number;
  blocked_attachment: number;
};

export function ActivityPanel({ appId }: { appId: string }) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [today, setToday] = useState<{ used: number; limit: number } | null>(null);
  const [websiteName, setWebsiteName] = useState("");
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  // Bumped by the refresh button; the effect below reads it as a dependency, so a
  // refresh is the same code path as the first load rather than a second copy of it.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoaded(false);
    setFailed(false);
    fetch(`/api/apps/${appId}/logs?page=0`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return;
        if (!data) {
          setFailed(true);
          return;
        }
        setCounts(data.counts);
        setToday(data.today);
        setWebsiteName(data.websiteName);
        setTotal(data.total);
      })
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, [appId, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <div className="activity-panel">
      {/* Header stays rendered in every state, so the refresh button is still there to
          retry with when the fetch is what failed. */}
      <div className="activity-head">
        <h4>Activity</h4>
        <button
          type="button"
          className="icon-btn"
          onClick={refresh}
          disabled={!loaded}
          aria-label="Refresh activity"
          title="Refresh"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
      </div>

      {failed ? (
        <div className="msg error" role="alert">
          Could not load this app&rsquo;s activity. Use refresh to try again.
        </div>
      ) : !loaded && counts === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
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
                <div className="stat-value">
                  {counts.blocked_bot + counts.blocked_spam + counts.blocked_attachment}
                </div>
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
            // Only offered once there is something to read: a modal that opens on an
            // empty table is a click that answers nothing.
            <button type="button" className="link-btn" onClick={() => setOpen(true)}>
              More info →
            </button>
          )}
        </>
      )}

      {open && (
        <ActivityModal appId={appId} appName={websiteName} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
