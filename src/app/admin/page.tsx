import Link from "next/link";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { App } from "@/models/App";
import { SendLog } from "@/models/SendLog";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  await connectDB();
  const [userCount, appCount, sentCount, failedCount] = await Promise.all([
    User.countDocuments(),
    App.countDocuments(),
    SendLog.countDocuments({ status: "sent" }),
    SendLog.countDocuments({ status: "smtp_failed" }),
  ]);

  const stats = [
    { label: "Users", value: userCount, href: "/admin/users" },
    { label: "Apps", value: appCount, href: "/admin/apps" },
    { label: "Emails sent", value: sentCount, href: "/admin/logs" },
    { label: "Send failures", value: failedCount, href: "/admin/logs" },
  ];

  return (
    <div className="stat-grid">
      {stats.map((s) => (
        <Link className="stat-card" key={s.label} href={s.href}>
          <span className="stat-value">{s.value}</span>
          <span className="stat-label">{s.label}</span>
        </Link>
      ))}
    </div>
  );
}
