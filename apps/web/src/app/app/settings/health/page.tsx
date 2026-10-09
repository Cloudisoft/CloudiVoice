import { failedWebhooks, systemHealth } from "@cloudivoice/core/services/system";
import { fmtDate } from "@/components/ui/kit";
import { isPlatformAdmin } from "@/lib/platform";
import { tenant } from "@/lib/session";
import { replayWebhookAction } from "../actions";

export const metadata = { title: "System health" };

export default async function HealthPage() {
  const { org, user } = await tenant(async (tx, user) => {
    const [o] = await tx<{ stuck: number; last_success: Date | null; failed_24h: number; webhook_gaps: number }[]>`
      select count(*) filter (where state in ('queued','ringing') and created_at < now() - interval '5 minutes')::int as stuck,
             max(ended_at) filter (where state = 'completed' and answered_at is not null) as last_success,
             count(*) filter (where state = 'failed' and created_at > now() - interval '1 day')::int as failed_24h,
             count(*) filter (where state in ('completed','failed') and not exists (select 1 from call_events e where e.call_id = calls.id and e.type = 'finalized'))::int as webhook_gaps
      from calls where created_at > now() - interval '30 days'`;
    return { org: o!, user };
  }, "audit.view");
  const platform = isPlatformAdmin(user.email);
  const [sys, failed] = platform ? await Promise.all([systemHealth(), failedWebhooks()]) : [null, []];
  return (
    <div className="stack">
      <dl className="stats">
        <div className="stat">
          <dt>Last successful call</dt>
          <dd style={{ fontSize: 18 }}>{fmtDate(org.last_success)}</dd>
        </div>
        <div className="stat">
          <dt>Stuck dialling</dt>
          <dd style={{ color: org.stuck ? "var(--warn)" : undefined }}>{org.stuck}</dd>
        </div>
        <div className="stat">
          <dt>Failed calls · 24h</dt>
          <dd>{org.failed_24h}</dd>
        </div>
        <div className="stat">
          <dt>Calls awaiting repair</dt>
          <dd>{org.webhook_gaps}</dd>
        </div>
      </dl>
      <p className="field-hint">
        Background jobs close calls stuck ringing, confirm final status with the phone network when an end event is missing, and fill gaps in duration, outcome and recordings. They run every minute.
      </p>
      {platform && sys && (
        <section className="panel">
          <div className="panel-head">
            <h2>Platform (Cloudisoft operators)</h2>
            <span className="field-hint">
              Webhook backlog {sys.webhooks.backlog} · failed {sys.webhooks.failed}
            </span>
          </div>
          <div className="panel-body">
            <p className="field-hint" style={{ marginTop: 0 }}>
              Workers: {sys.leases.map((l) => `${l.name} → ${l.holder} (until ${fmtDate(l.expires_at)})`).join(" · ") || "none holding leases"}
            </p>
          </div>
          {failed.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>Kind</th>
                    <th className="num">Attempts</th>
                    <th>Error</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {failed.map((w) => (
                    <tr key={w.id}>
                      <td className="muted">{fmtDate(w.received_at)}</td>
                      <td className="mono">{w.kind}</td>
                      <td className="num">{w.attempts}</td>
                      <td className="muted">{w.error ?? "Not processed yet"}</td>
                      <td className="num">
                        <form action={replayWebhookAction}>
                          <input type="hidden" name="id" value={w.id} />
                          <button className="btn btn-quiet btn-sm">Replay</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
