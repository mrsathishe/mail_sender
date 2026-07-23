"use client";

import { useEffect, useState } from "react";

type User = {
  id: string;
  email: string;
  role: "user" | "admin";
  disabled: boolean;
  appCount: number;
  createdAt: string;
};

const ERROR_TEXT: Record<string, string> = {
  last_admin: "Can't remove the last remaining admin.",
  cannot_modify_self: "You can't modify your own account.",
  cannot_delete_self: "You can't delete your own account.",
};

export function UsersManager({ currentEmail }: { currentEmail: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/users");
    if (res.ok) setUsers((await res.json()).users);
    setLoaded(true);
  }

  useEffect(() => {
    load();
  }, []);

  async function act(id: string, run: () => Promise<Response>) {
    setError("");
    setBusy(id);
    const res = await run();
    setBusy(null);
    if (res.ok) {
      load();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(ERROR_TEXT[body.error] ?? "Action failed.");
    }
  }

  function patch(id: string, body: Record<string, unknown>) {
    return act(id, () =>
      fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  }

  function remove(u: User) {
    if (!confirm(`Delete ${u.email} and all their apps? This cannot be undone.`)) return;
    return act(u.id, () => fetch(`/api/admin/users/${u.id}`, { method: "DELETE" }));
  }

  if (!loaded) return <p className="muted">Loading…</p>;
  if (error) return <ErrorBar text={error} users={users} currentEmail={currentEmail} patch={patch} remove={remove} busy={busy} />;
  return <Table users={users} currentEmail={currentEmail} patch={patch} remove={remove} busy={busy} />;
}

function ErrorBar(props: TableProps & { text: string }) {
  const { text, ...rest } = props;
  return (
    <>
      <div className="msg error">{text}</div>
      <Table {...rest} />
    </>
  );
}

type TableProps = {
  users: User[];
  currentEmail: string;
  busy: string | null;
  patch: (id: string, body: Record<string, unknown>) => void;
  remove: (u: User) => void;
};

function Table({ users, currentEmail, busy, patch, remove }: TableProps) {
  if (users.length === 0) return <p className="muted">No users.</p>;
  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>Email</th>
          <th>Role</th>
          <th>Apps</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {users.map((u) => {
          const isSelf = u.email === currentEmail;
          const disabled = busy === u.id || isSelf;
          return (
            <tr key={u.id} className={u.disabled ? "row-disabled" : ""}>
              <td>
                {u.email}
                {isSelf && <span className="tag">you</span>}
              </td>
              <td>{u.role}</td>
              <td>{u.appCount}</td>
              <td>{u.disabled ? "Disabled" : "Active"}</td>
              <td className="actions">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => patch(u.id, { role: u.role === "admin" ? "user" : "admin" })}
                >
                  {u.role === "admin" ? "Demote" : "Make admin"}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => patch(u.id, { disabled: !u.disabled })}
                >
                  {u.disabled ? "Enable" : "Disable"}
                </button>
                <button type="button" className="danger" disabled={disabled} onClick={() => remove(u)}>
                  Delete
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
