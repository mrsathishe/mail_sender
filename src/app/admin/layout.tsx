import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LogoutButton } from "../dashboard/LogoutButton";

export const dynamic = "force-dynamic";

// Server-side guard mirrors middleware; keeps admin UI inaccessible even if the
// matcher ever changes.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/dashboard");

  return (
    <div className="wrap">
      <div className="topbar">
        <div>
          <h1 style={{ margin: 0 }}>Admin</h1>
          <span className="muted">{session.email}</span>
        </div>
        <LogoutButton />
      </div>
      <nav className="admin-nav">
        <Link href="/admin">Overview</Link>
        <Link href="/admin/users">Users</Link>
        <Link href="/admin/apps">Apps</Link>
        <Link href="/admin/logs">Activity</Link>
        <Link href="/dashboard">← My apps</Link>
      </nav>
      {children}
    </div>
  );
}
