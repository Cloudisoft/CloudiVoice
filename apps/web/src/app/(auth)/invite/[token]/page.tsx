import Link from "next/link";
import { db } from "@cloudivoice/core/db/client";
import { getInvitation } from "@cloudivoice/core/services/auth";
import { ensureMigrated } from "@/lib/db";
import { InviteForm } from "../../forms";

export const metadata = { title: "Join your team" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  await ensureMigrated();
  const { token } = await params;
  const inv = await getInvitation(token);
  if (!inv) {
    return (
      <div className="auth-card">
        <h1>Invitation expired</h1>
        <p className="lede">This invitation link is invalid or has expired. Ask your admin to send a new one.</p>
        <Link href="/login" className="btn btn-ghost">
          Go to sign in
        </Link>
      </div>
    );
  }
  const [existing] = await db()`select 1 from users where lower(email) = ${inv.email}`;
  return (
    <div className="auth-card">
      <h1>Join {inv.org_name}</h1>
      <p className="lede">
        You&rsquo;ve been invited as <b>{inv.role}</b> ({inv.email}).
      </p>
      <InviteForm token={token} needsName={!existing} />
    </div>
  );
}
