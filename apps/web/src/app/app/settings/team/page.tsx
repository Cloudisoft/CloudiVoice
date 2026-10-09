import { listMembers, listPendingInvites } from "@cloudivoice/core/services/org";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { fmtDate } from "@/components/ui/kit";
import { hasPermission, tenant } from "@/lib/session";
import { changeRoleAction, removeMemberAction, revokeInviteAction } from "../actions";
import { InviteForm } from "./InviteForm";

export const metadata = { title: "Team & roles" };

export default async function TeamPage() {
  const { members, invites, user } = await tenant(async (tx, user) => ({ members: await listMembers(tx), invites: await listPendingInvites(tx), user }));
  const canManage = hasPermission(user, "team.manage");
  return (
    <div className="grid-main-side">
      <div className="stack">
        <section className="panel">
          <div className="panel-head">
            <h2>Members</h2>
            <span className="field-hint">{members.length}</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Last sign-in</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id}>
                    <td>
                      <span className="strong">{m.name}</span>
                      {m.user_id === user.userId && <span className="chip" style={{ marginLeft: 8 }}>You</span>}
                      <div className="field-hint">{m.email}</div>
                    </td>
                    <td>
                      {canManage && m.user_id !== user.userId ? (
                        <form action={changeRoleAction} style={{ display: "flex", gap: 6 }}>
                          <input type="hidden" name="user_id" value={m.user_id} />
                          <select name="role" className="select select-compact" defaultValue={m.role} aria-label={`Role for ${m.name}`}>
                            {["admin", "manager", "operator", "viewer"].map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                          <button className="btn btn-quiet btn-sm">Save</button>
                        </form>
                      ) : (
                        <span style={{ textTransform: "capitalize" }}>{m.role}</span>
                      )}
                    </td>
                    <td className="muted">{fmtDate(m.last_login_at)}</td>
                    <td className="num">
                      {canManage && m.user_id !== user.userId && (
                        <form action={removeMemberAction}>
                          <input type="hidden" name="user_id" value={m.user_id} />
                          <ConfirmButton message={`Remove ${m.name} from this organization?`} className="btn btn-quiet btn-sm">
                            Remove
                          </ConfirmButton>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        {invites.length > 0 && (
          <section className="panel">
            <div className="panel-head">
              <h2>Pending invitations</h2>
            </div>
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {invites.map((i) => (
                    <tr key={i.id}>
                      <td className="strong">{i.email}</td>
                      <td style={{ textTransform: "capitalize" }}>{i.role}</td>
                      <td className="muted">expires {fmtDate(i.expires_at, { time: false })}</td>
                      <td className="num">
                        {canManage && (
                          <form action={revokeInviteAction}>
                            <input type="hidden" name="id" value={i.id} />
                            <button className="btn btn-quiet btn-sm">Revoke</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
      {canManage && (
        <section className="panel">
          <div className="panel-head">
            <h2>Invite a teammate</h2>
          </div>
          <div className="panel-body">
            <InviteForm />
          </div>
        </section>
      )}
    </div>
  );
}
