import { getSession } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { UsersManager } from "./UsersManager";
import { privateMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata = privateMetadata("Users");

export default async function AdminUsersPage() {
  const session = await getSession();
  return (
    <>
      <PageHeader title="Users" subtitle="Promote, disable or delete accounts." />
      <UsersManager currentEmail={session?.email ?? ""} />
    </>
  );
}
