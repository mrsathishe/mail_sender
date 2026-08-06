import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { TEMPLATE_LIST } from "@/lib/templates";
import { PageHeader } from "@/components/PageHeader";
import { DonateDialog } from "@/components/DonateDialog";
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
          the browser — the picker only needs id/name/description/previewHeight. */}
      <AppsManager designs={TEMPLATE_LIST} baseUrl={baseUrl} />

      {/* Below the apps, not above them: someone signing in came to manage a form, and
          the ask reads as an aside only after that. Same dialog as the header's — the
          payment details have one source. */}
      <section className="card card-wide donate-card">
        <h2>Support this service</h2>
        <p className="muted">
          Your apps send through a mailbox and a server funded privately, at no charge to
          you. If this saved you writing a backend, a voluntary contribution helps keep it
          running. Nothing about your account or its limits depends on one.
        </p>
        <DonateDialog />
      </section>
    </div>
  );
}
