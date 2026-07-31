import { PageHeader } from "@/components/PageHeader";
import { LogsViewer } from "./LogsViewer";
import { privateMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata = privateMetadata("Activity");

export default function AdminLogsPage() {
  return (
    <>
      <PageHeader title="Activity" subtitle="One row per send attempt, newest first." />
      <LogsViewer />
    </>
  );
}
