import { PageHeader } from "@/components/PageHeader";
import { AppsAdmin } from "./AppsAdmin";

export const dynamic = "force-dynamic";

export const metadata = { title: "Apps" };

export default function AdminAppsPage() {
  return (
    <>
      <PageHeader title="Apps" subtitle="Every registered app and its destination address." />
      <AppsAdmin />
    </>
  );
}
