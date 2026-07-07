import { redirect } from "next/navigation";

export default function Home() {
  // Dashboard is auth-gated by middleware; unauthenticated users land on /login.
  redirect("/dashboard");
}
