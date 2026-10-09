import Link from "next/link";
import { formatPhone } from "@cloudivoice/core/phone";
import { listCallbacks } from "@cloudivoice/core/services/callbacks";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { EmptyState, fmtDate, PageHeader } from "@/components/ui/kit";
import { hasPermission, tenant } from "@/lib/session";
import { cancelCallbackAction, newCallbackAction, rescheduleCallbackAction } from "./actions";

export const metadata = { title: "Callbacks" };

export default async function CallbacksPage({ searchParams }: { searchParams: Promise<{ view?: string; lead?: string }> }) {
  const sp = await searchParams;
  const view = sp.view === "past" ? "past" : "upcoming";
  const { rows, user, tz, lead } = await tenant(async (tx, user) => ({
    rows: await listCallbacks(tx, view),
    user,
    tz: (await tx<{ timezone: string }[]>`select timezone from organizations`)[0]!.timezone,
    lead: sp.lead && /^[0-9a-f-]{36}$/.test(sp.lead) ? (await tx<{ id: string; first_name: string | null; phone_e164: string }[]>`select id, first_name, phone_e164 from leads where id = ${sp.lead}`)[0] : undefined,
  }));
  const canControl = hasPermission(user, "campaigns.control");
  return (
    <>
      <PageHeader title="Callbacks" sub={`Callbacks are dialled automatically at the scheduled time, inside calling hours (${tz}). Agents schedule them when a caller asks to be called later.`} />
      {lead && canControl && (
        <form action={newCallbackAction} className="panel panel-body form-grid" style={{ marginBottom: 16 }}>
          <input type="hidden" name="lead_id" value={lead.id} />
          <div className="field">
            <label htmlFor="cb-when">Call {lead.first_name ?? formatPhone(lead.phone_e164)} at</label>
            <input id="cb-when" type="datetime-local" name="when" className="input" required />
          </div>
          <div className="field">
            <label htmlFor="cb-reason">Note</label>
            <input id="cb-reason" name="reason" className="input" />
          </div>
          <button className="btn btn-accent btn-sm">Schedule callback</button>
        </form>
      )}
      <section className="panel">
        <div className="panel-head">
          <div className="pill-tabs">
            <Link href="/app/callbacks" aria-current={view === "upcoming" ? "page" : undefined}>
              Upcoming
            </Link>
            <Link href="/app/callbacks?view=past" aria-current={view === "past" ? "page" : undefined}>
              Past
            </Link>
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon="callback" title={view === "upcoming" ? "No callbacks scheduled" : "No past callbacks"} body="When a caller says “call me tomorrow at 3”, the agent schedules it here and dials at the right time." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Lead</th>
                  <th>Campaign</th>
                  <th>Note</th>
                  <th>By</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="strong">{fmtDate(r.scheduled_for, { tz })}</td>
                    <td>
                      <Link className="row-link" href={`/app/leads/${r.lead_id}`}>
                        {r.lead_name ?? "No name on file"}
                      </Link>
                      <div className="field-hint mono">{formatPhone(r.phone_e164)}</div>
                    </td>
                    <td>{r.campaign_name ?? "—"}</td>
                    <td className="muted">{r.reason || "—"}</td>
                    <td>{r.created_by === "ai" ? <span className="chip chip-accent">Agent</span> : <span className="chip">Team</span>}</td>
                    <td>{r.status}</td>
                    <td className="num">
                      {canControl && ["scheduled", "failed"].includes(r.status) && (
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                          <form action={rescheduleCallbackAction} style={{ display: "flex", gap: 6 }}>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="datetime-local" name="when" className="input" required aria-label="New time" style={{ minHeight: 32, height: 32, width: 200 }} />
                            <button className="btn btn-quiet btn-sm">Move</button>
                          </form>
                          {r.status === "scheduled" && (
                            <form action={cancelCallbackAction}>
                              <input type="hidden" name="id" value={r.id} />
                              <ConfirmButton message="Cancel this callback?" className="btn btn-quiet btn-sm">
                                Cancel
                              </ConfirmButton>
                            </form>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
