import Link from "next/link";
import { listCampaigns } from "@cloudivoice/core/services/campaigns";
import { Icon } from "@/components/ui/Icon";
import { EmptyState, fmtDate, PageHeader } from "@/components/ui/kit";
import { hasPermission, tenant } from "@/lib/session";

export const metadata = { title: "Campaigns" };

const TONE: Record<string, string> = { running: "chip-ok", paused: "chip-warn", stopped: "", draft: "", completed: "chip-info" };

export default async function CampaignsPage() {
  const { campaigns, user } = await tenant(async (tx, user) => ({ campaigns: await listCampaigns(tx), user }));
  const canEdit = hasPermission(user, "campaigns.edit");
  return (
    <>
      <PageHeader
        title="Campaigns"
        sub="Outbound calling with pacing, calling hours, retries and live counts. Pausing stops new calls; calls in progress finish naturally."
        actions={
          canEdit && (
            <Link href="/app/campaigns/new" className="btn btn-accent btn-sm">
              <Icon name="plus" /> New campaign
            </Link>
          )
        }
      />
      <section className="panel">
        {campaigns.length === 0 ? (
          <EmptyState icon="campaign" title="No campaigns yet" body="Pick an agent, a lead list and caller numbers. We check everything before the first call goes out." actions={canEdit && <Link href="/app/campaigns/new" className="btn btn-accent btn-sm">Create campaign</Link>} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Agent</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th className="num">Waiting</th>
                  <th className="num">Live</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link className="row-link" href={`/app/campaigns/${c.id}`}>
                        {c.name}
                      </Link>
                    </td>
                    <td>{c.agent_name ?? <span className="muted">—</span>}</td>
                    <td>
                      <span className={`chip chip-dot ${TONE[c.status] ?? ""}`}>{c.status}</span>
                    </td>
                    <td style={{ minWidth: 160 }}>
                      <div className="meter" title={`${c.completed} of ${c.total} done`}>
                        <span style={{ width: `${c.total ? (c.completed / c.total) * 100 : 0}%` }} />
                      </div>
                      <span className="field-hint">
                        {c.completed.toLocaleString("en-IN")} / {c.total.toLocaleString("en-IN")}
                      </span>
                    </td>
                    <td className="num">{c.pending.toLocaleString("en-IN")}</td>
                    <td className="num">{c.in_progress}</td>
                    <td className="muted">{fmtDate(c.created_at, { time: false })}</td>
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
