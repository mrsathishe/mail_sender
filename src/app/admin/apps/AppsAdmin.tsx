"use client";

import { useEffect, useState } from "react";

type AdminApp = {
  id: string;
  websiteName: string;
  destinationGmail: string;
  ownerEmail: string;
  createdAt: string;
};

export function AppsAdmin() {
  const [apps, setApps] = useState<AdminApp[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/apps");
    if (res.ok) setApps((await res.json()).apps);
    setLoaded(true);
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(app: AdminApp) {
    if (!confirm(`Delete app “${app.websiteName}” (${app.ownerEmail})? Its secret key stops working immediately.`)) {
      return;
    }
    setError("");
    setBusy(app.id);
    const res = await fetch(`/api/admin/apps/${app.id}`, { method: "DELETE" });
    setBusy(null);
    if (res.ok) load();
    else setError("Could not delete app.");
  }

  if (!loaded) return <p className="muted">Loading…</p>;
  if (apps.length === 0) return <p className="muted">No apps registered.</p>;

  return (
    <>
      {error && <div className="msg error">{error}</div>}
      <table className="admin-table">
        <thead>
          <tr>
            <th>Website</th>
            <th>Destination</th>
            <th>Owner</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {apps.map((a) => (
            <tr key={a.id}>
              <td>{a.websiteName}</td>
              <td>{a.destinationGmail}</td>
              <td>{a.ownerEmail}</td>
              <td className="actions">
                <button
                  type="button"
                  className="danger"
                  disabled={busy === a.id}
                  onClick={() => remove(a)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
