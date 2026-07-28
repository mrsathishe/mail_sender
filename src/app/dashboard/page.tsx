import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { TEMPLATE_LIST } from "@/lib/templates";
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
          <Link href="/docs">API docs</Link>
          {session.role === "admin" && <Link href="/admin">Admin</Link>}
          <LogoutButton />
        </div>
      </div>
      {/* Catalog is passed from the server so the design markup never ships to
          the browser — the picker only needs id/name/description. */}
      <AppsManager designs={TEMPLATE_LIST} />
    </div>
  );
}
