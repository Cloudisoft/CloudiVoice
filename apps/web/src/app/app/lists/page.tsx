import Link from "next/link";
import { formatPhone } from "@cloudivoice/core/phone";
import { listLeadLists } from "@cloudivoice/core/services/leads";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { EmptyState, fmtDate, PageHeader } from "@/components/ui/kit";
import { hasPermission, tenant } from "@/lib/session";
import { addDncAction } from "../leads/actions";
import { createListAction, deleteListAction, removeDncAction } from "./actions";
import { ResetForm } from "./ResetForm";

export const metadata = { title: "Lead Lists" };

export default async function ListsPage() {
  const { lists, dnc, user } = await tenant(async (tx, user) => ({
    lists: await listLeadLists(tx),
    dnc: await tx<{ phone_e164: string; reason: string | null; created_at: Date }[]>`select phone_e164, reason, created_at from dnc_entries order by created_at desc limit 200`,
    user,
  }));
  const canEdit = hasPermission(user, "leads.edit");
  return (
    <>
      <PageHeader title="Lead Lists" sub="Group leads for campaigns, see what’s fresh versus already dialled, and put leads back in line for another round." />
      <div className="grid-main-side">
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>Lists</h2>
              {canEdit && (
                <form action={createListAction} style={{ display: "flex", gap: 6 }}>
                  <input name="name" className="input" placeholder="New list name" aria-label="New list name" style={{ minHeight: 34, height: 34, width: 200 }} required />
                  <button className="btn btn-ghost btn-sm">Create</button>
                </form>
              )}
            </div>
            {lists.length === 0 ? (
              <EmptyState icon="list" title="No lists yet" body="Lists are created when you import leads, or create an empty one here." actions={canEdit && <Link href="/app/leads/import" className="btn btn-accent btn-sm">Import leads</Link>} />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>List</th>
                      <th className="num">Leads</th>
                      <th className="num">Fresh</th>
                      <th className="num">Already dialled</th>
                      <th>Created</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lists.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <Link className="row-link" href={`/app/leads?list=${l.id}`}>
                            {l.name}
                          </Link>
                        </td>
                        <td className="num">{l.total.toLocaleString("en-IN")}</td>
                        <td className="num">{l.fresh.toLocaleString("en-IN")}</td>
                        <td className="num">{l.dialed.toLocaleString("en-IN")}</td>
                        <td className="muted">{fmtDate(l.created_at, { time: false })}</td>
                        <td className="num">
                          {hasPermission(user, "leads.delete") && (
                            <form action={deleteListAction}>
                              <input type="hidden" name="id" value={l.id} />
                              <ConfirmButton message={`Delete the list “${l.name}”? Leads stay in your account.`} className="btn btn-quiet btn-sm">
                                Delete
                              </ConfirmButton>
                            </form>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel" id="dnc">
            <div className="panel-head">
              <h2>Do Not Call list</h2>
              <span className="field-hint">{dnc.length} numbers</span>
            </div>
            {canEdit && (
              <form action={addDncAction} className="filters">
                <input name="phone" className="input" placeholder="Phone number" aria-label="Phone number" inputMode="tel" required />
                <input name="reason" className="input" placeholder="Reason (optional)" aria-label="Reason" />
                <button className="btn btn-ghost btn-sm">Add to DNC</button>
              </form>
            )}
            {dnc.length === 0 ? (
              <p className="panel-body field-hint">Numbers added here — or by the agent when a caller asks — are never called again.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {dnc.map((d) => (
                      <tr key={d.phone_e164}>
                        <td className="mono">{formatPhone(d.phone_e164)}</td>
                        <td>{d.reason ?? "—"}</td>
                        <td className="muted">{fmtDate(d.created_at)}</td>
                        <td className="num">
                          {hasPermission(user, "settings.manage") && (
                            <form action={removeDncAction}>
                              <input type="hidden" name="phone" value={d.phone_e164} />
                              <ConfirmButton message="Remove this number from the do-not-call list? Only do this with the person’s consent." className="btn btn-quiet btn-sm">
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
            )}
          </section>
        </div>
        {hasPermission(user, "campaigns.control") && lists.length > 0 && (
          <section className="panel">
            <div className="panel-head">
              <h2>Reset leads for redial</h2>
            </div>
            <div className="panel-body">
              <ResetForm lists={lists.map((l) => ({ id: l.id, name: l.name }))} />
            </div>
          </section>
        )}
      </div>
    </>
  );
}
