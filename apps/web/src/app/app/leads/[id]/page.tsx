import Link from "next/link";
import { notFound } from "next/navigation";
import { endReasonText } from "@cloudivoice/core/outcomes";
import { formatPhone } from "@cloudivoice/core/phone";
import { getLead } from "@cloudivoice/core/services/leads";
import { fmtDate, fmtDuration, leadName, OutcomeChip, PageHeader } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/form";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { hasPermission, tenant } from "@/lib/session";
import { leadDncAction, updateLeadAction } from "../actions";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { data, user } = await tenant(async (tx, user) => ({ data: await getLead(tx, id), user }));
  if (!data) notFound();
  const l = data.lead as Record<string, unknown> & { first_name: string | null; last_name: string | null; phone_e164: string; dnc: boolean; custom: Record<string, string> };
  const canEdit = hasPermission(user, "leads.edit");
  return (
    <>
      <PageHeader
        title={leadName(l.first_name, l.last_name)}
        crumbs={[{ href: "/app/leads", label: "Leads" }]}
        sub={
          <>
            <span className="mono">{formatPhone(l.phone_e164)}</span>
            {l.dnc && (
              <span className="chip chip-bad" style={{ marginLeft: 10 }}>
                Do not call
              </span>
            )}
          </>
        }
        actions={
          canEdit &&
          !l.dnc && (
            <form action={leadDncAction}>
              <input type="hidden" name="id" value={id} />
              <ConfirmButton message="Add this number to the do-not-call list? It will be removed from all campaign queues." className="btn btn-ghost btn-sm">
                Mark do-not-call
              </ConfirmButton>
            </form>
          )
        }
      />
      <div className="grid-main-side">
        <section className="panel">
          <div className="panel-head">
            <h2>Call history</h2>
            <span className="field-hint">{data.calls.length} calls</span>
          </div>
          {data.calls.length === 0 ? (
            <p className="panel-body field-hint">No calls yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Campaign</th>
                    <th>Outcome</th>
                    <th>How it ended</th>
                    <th className="num">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {data.calls.map((c) => (
                    <tr key={String(c.id)}>
                      <td>
                        <Link className="row-link" href={`/app/calls/${c.id}`}>
                          {fmtDate(c.created_at as Date)}
                        </Link>
                      </td>
                      <td>{(c.campaign_name as string) ?? <span className="muted">{String(c.direction)}</span>}</td>
                      <td>
                        <OutcomeChip outcome={c.outcome as string} />
                      </td>
                      <td className="muted">{endReasonText(c.end_reason as string)}</td>
                      <td className="num">{fmtDuration(c.duration_sec as number)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.calls.some((c) => c.summary) && (
            <div className="panel-body" style={{ borderTop: "1px solid var(--line)" }}>
              <span className="label">Latest summary</span>
              <p style={{ margin: "8px 0 0", color: "var(--text-2)" }}>{String(data.calls.find((c) => c.summary)?.summary)}</p>
            </div>
          )}
        </section>
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>Details</h2>
            </div>
            <form action={updateLeadAction} className="panel-body stack">
              <input type="hidden" name="id" value={id} />
              <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }} className="form-grid">
                {(
                  [
                    ["first_name", "First name"],
                    ["last_name", "Last name"],
                    ["phone", "Phone"],
                    ["email", "Email"],
                    ["city", "City"],
                    ["state", "State"],
                  ] as const
                ).map(([k, label]) => (
                  <div className="field" key={k}>
                    <label htmlFor={`l-${k}`}>{label}</label>
                    <input id={`l-${k}`} name={k} className="input" defaultValue={k === "phone" ? formatPhone(l.phone_e164) : ((l[k] as string) ?? "")} />
                  </div>
                ))}
              </fieldset>
              {canEdit && <SubmitButton className="btn btn-ghost btn-sm">Save details</SubmitButton>}
            </form>
          </section>
          {Object.keys(l.custom ?? {}).length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h2>Custom fields</h2>
              </div>
              <dl className="kv panel-body">
                {Object.entries(l.custom).map(([k, v]) => (
                  <div key={k} style={{ display: "contents" }}>
                    <dt className="mono">{`{{${k}}}`}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          <section className="panel">
            <div className="panel-head">
              <h2>Lists &amp; callbacks</h2>
            </div>
            <div className="panel-body stack">
              <div>
                {data.lists.length ? data.lists.map((li) => <span key={String(li.id)} className="chip" style={{ marginRight: 6 }}>{String(li.name)}</span>) : <span className="field-hint">Not in any list.</span>}
              </div>
              {data.callbacks.map((cb) => (
                <div key={String(cb.id)} className="field-hint">
                  Callback {String(cb.status)} · {fmtDate(cb.scheduled_for as Date)} {cb.reason ? `— ${String(cb.reason)}` : ""}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
