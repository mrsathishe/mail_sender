import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AppsManager } from "./AppsManager";
import { LogoutButton } from "./LogoutButton";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="wrap">
      <div className="topbar">
        <div>
          <h1 style={{ margin: 0 }}>Your apps</h1>
          <span className="muted">{session.email}</span>
        </div>
        <div className="topbar-actions">
          {session.role === "admin" && <Link href="/admin">Admin</Link>}
          <LogoutButton />
        </div>
      </div>
      <AppsManager />
    </div>
  );
}
