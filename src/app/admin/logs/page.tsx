import { PageHeader } from "@/components/PageHeader";
import { LogsViewer } from "./LogsViewer";

export const dynamic = "force-dynamic";

export const metadata = { title: "Activity" };

export default function AdminLogsPage() {
  return (
    <>
      <PageHeader title="Activity" subtitle="One row per send attempt, newest first." />
      <LogsViewer />
    </>
  );
}
