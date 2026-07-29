import { redirect } from "next/navigation";
import { Suspense } from "react";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { getSession } from "@/lib/auth";
import { VerifyEmailForm } from "./VerifyEmailForm";
import { SessionRefresh } from "./SessionRefresh";

export const dynamic = "force-dynamic";

// Not in the middleware matcher on purpose — an unverified account is redirected
// *here*, so gating it would loop.
export default async function VerifyEmailPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  await connectDB();
  const user = await User.findById(session.userId).select("email emailVerified").lean();
  if (!user) redirect("/login");

  return (
    <div className="center">
      <div className="card">
        <h1>Verify your email</h1>
        {user.emailVerified ? (
          // Verified in the DB but the cookie still says otherwise (e.g. an account
          // grandfathered by the migration). Refresh the claim, don't ask for a
          // code that no longer exists.
          <SessionRefresh />
        ) : (
          // Suspense boundary: the form reads ?sent= from the URL.
          <Suspense fallback={<p className="muted">Loading…</p>}>
            <VerifyEmailForm email={user.email} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
