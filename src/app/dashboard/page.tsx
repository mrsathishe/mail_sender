import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { TEMPLATE_LIST } from "@/lib/templates";
import { PageHeader } from "@/components/PageHeader";
import { AppsManager } from "./AppsManager";
import { baseUrlFrom } from "@/lib/base-url";
import { privateMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata = privateMetadata("Your apps");

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Absolute, and from the forwarded headers rather than the bind address, because the
  // generated snippets are meant to be pasted into somebody else's project.
  const baseUrl = baseUrlFrom(await headers());

  return (
    <div className="wrap">
      <PageHeader title="Your apps" subtitle={`Signed in as ${session.email}`} />
      {/* Catalog is passed from the server so the design markup never ships to
          the browser — the picker only needs id/name/description/previewHeight.
          accountEmail drives the "use my own address" shortcut, which skips the
          destination OTP because registration already proved that address. */}
      <AppsManager designs={TEMPLATE_LIST} accountEmail={session.email} baseUrl={baseUrl} />
    </div>
  );
}
