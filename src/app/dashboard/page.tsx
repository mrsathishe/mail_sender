import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
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
        <LogoutButton />
      </div>
      <AppsManager />
    </div>
  );
}
