import { getSession } from "@/lib/auth";
import { UsersManager } from "./UsersManager";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const session = await getSession();
  return <UsersManager currentEmail={session?.email ?? ""} />;
}
