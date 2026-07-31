import { PageHeader } from "@/components/PageHeader";
import { AppsAdmin } from "./AppsAdmin";
import { privateMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata = privateMetadata("Apps");

export default function AdminAppsPage() {
  return (
    <>
      <PageHeader title="Apps" subtitle="Every registered app and its destination address." />
      <AppsAdmin />
    </>
  );
}
