import { listSessions } from "@cloudivoice/core/services/auth";
import { fmtDate } from "@/components/ui/kit";
import { requireOrgUser } from "@/lib/session";
import { signOutEverywhereAction } from "../actions";
import { ConfirmButton } from "@/components/ui/ConfirmButton";

export const metadata = { title: "Security" };

export default async function SecurityPage() {
  const user = await requireOrgUser();
  const sessions = await listSessions(user.userId);
  return (
    <div className="grid-main-side">
      <section className="panel">
        <div className="panel-head">
          <h2>Your active sessions</h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Signed in</th>
                <th>Device</th>
                <th>IP</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{fmtDate(s.created_at)}</td>
                  <td className="muted" style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.user_agent ?? "—"}
                  </td>
                  <td className="mono">{s.ip ?? "—"}</td>
                  <td className="muted">{fmtDate(s.expires_at, { time: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form action={signOutEverywhereAction} className="panel-body">
          <ConfirmButton message="Sign out of every device, including this one?" className="btn btn-ghost btn-sm">
            Sign out everywhere
          </ConfirmButton>
        </form>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Password rules</h2>
        </div>
        <div className="panel-body field-hint">
          Passwords need at least 10 characters with letters and a number, and are stored with scrypt hashing. Resetting your password signs you out everywhere. Sessions last 30 days.
          <p>
            To change your password, sign out and use <b>Forgot password</b>.
          </p>
        </div>
      </section>
    </div>
  );
}
