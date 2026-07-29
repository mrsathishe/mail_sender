import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Behind the login wall — keep it out of search results even where robots.txt is
// ignored. Applies to every /admin/* page through the layout.
export const metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

// Server-side guard mirrors middleware; keeps admin UI inaccessible even if the
// matcher ever changes.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/dashboard");

  return (
    <div className="wrap">
      <nav className="admin-nav" aria-label="Admin sections">
        <Link href="/admin">Overview</Link>
        <Link href="/admin/users">Users</Link>
        <Link href="/admin/apps">Apps</Link>
        <Link href="/admin/logs">Activity</Link>
      </nav>
      {children}
    </div>
  );
}
