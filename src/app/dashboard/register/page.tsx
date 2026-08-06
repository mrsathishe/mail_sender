import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { TEMPLATE_LIST } from "@/lib/templates";
import { PageHeader } from "@/components/PageHeader";
import { RegisterApp } from "../RegisterApp";
import { privateMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata = privateMetadata("Register an app");

export default async function RegisterAppPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="wrap">
      <PageHeader
        title="Register an app"
        subtitle="One section at a time — the secret key is issued at the end"
      />
      {/* Catalog from the server, same as the dashboard: the picker only needs
          id/name/description/previewHeight, so no design markup reaches the browser.
          accountEmail drives the "use my own address" shortcut, which skips the
          destination OTP because registration already proved that address. No baseUrl
          here — nothing on this page generates integration snippets. */}
      <RegisterApp designs={TEMPLATE_LIST} accountEmail={session.email} />
    </div>
  );
}
