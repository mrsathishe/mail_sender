import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { TEMPLATE_LIST } from "@/lib/templates";
import { PageHeader } from "@/components/PageHeader";
import { AppsManager } from "./AppsManager";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Your apps",
  robots: { index: false, follow: false },
};

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="wrap">
      <PageHeader title="Your apps" subtitle={`Signed in as ${session.email}`} />
      {/* Catalog is passed from the server so the design markup never ships to
          the browser — the picker only needs id/name/description/previewHeight.
          accountEmail drives the "use my own address" shortcut, which skips the
          destination OTP because registration already proved that address. */}
      <AppsManager designs={TEMPLATE_LIST} accountEmail={session.email} />
    </div>
  );
}
