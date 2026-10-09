import Link from "next/link";
import { notFound } from "next/navigation";
import { OUTCOMES, type Outcome } from "@cloudivoice/core/outcomes";
import { formatPhone } from "@cloudivoice/core/phone";
import { campaignCounts, campaignLeadTable, getCampaign, preflight } from "@cloudivoice/core/services/campaigns";
import { listLeadLists } from "@cloudivoice/core/services/leads";
import { AutoRefresh } from "@/components/ui/AutoRefresh";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { fmtDate, leadName, OutcomeChip, PageHeader, Pager, qs } from "@/components/ui/kit";
import { hasPermission, tenant } from "@/lib/session";
import { campaignControlAction } from "../actions";
import { CampaignForm } from "../CampaignForm";

const STATE_LABEL: Record<string, string> = { pending: "Waiting", in_progress: "In progress", retry_wait: "Retry waiting", completed: "Completed", exhausted: "Max attempts", skipped: "Skipped (DNC)" };

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const view = sp.view === "fresh" || sp.view === "dialed" ? sp.view : "all";
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const tab = sp.tab === "settings" ? "settings" : "overview";
  const data = await tenant(async (tx, user) => {
    const c = await getCampaign(tx, id);
    if (!c) return null;
    return {
      user,
      c,
      counts: await campaignCounts(tx, id),
      checks: await preflight(tx, id),
      table: await campaignLeadTable(tx, id, view, page, 50),
      agents: await tx<{ id: string; name: string; status: string }[]>`select id, name, status from agents order by name`,
      lists: await listLeadLists(tx),
      numbers: await tx<{ id: string; e164: string; label: string | null }[]>`select id, e164, label from phone_numbers where status = 'active' and voice_outbound order by created_at`,
      org: (await tx<{ calling_window_start: string; calling_window_end: string }[]>`select calling_window_start, calling_window_end from organizations`)[0]!,
    };
  });
  if (!data) notFound();
  const camp = data.c.campaign as Record<string, unknown> & { name: string; status: string; agent_name: string | null };
  const status = camp.status;
  const canControl = hasPermission(data.user, "campaigns.control");
  const canEdit = hasPermission(data.user, "campaigns.edit");
  const st = data.counts.states;
  const total = Object.values(st).reduce((a, b) => a + b, 0);
  const blocking = data.checks.filter((c) => c.blocking && !c.ok);

  const control = (op: string, label: string, cls: string, confirm?: string) => (
    <form action={campaignControlAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={op} />
      {confirm ? <ConfirmButton message={confirm} className={cls}>{label}</ConfirmButton> : <button className={cls}>{label}</button>}
    </form>
  );

  return (
    <>
      {status === "running" && <AutoRefresh seconds={5} />}
      <PageHeader
        title={camp.name}
        crumbs={[{ href: "/app/campaigns", label: "Campaigns" }]}
        sub={
          <>
            <span className={`chip chip-dot ${status === "running" ? "chip-ok" : status === "paused" ? "chip-warn" : ""}`}>{status}</span>
            <span style={{ marginLeft: 10 }}>Agent: {camp.agent_name ?? "not set"}</span>
          </>
        }
        actions={
          canControl && (
            <>
              {(status === "draft" || status === "stopped" || status === "completed") && control("start", "Start campaign", `btn btn-accent btn-sm`)}
              {status === "running" && control("pause", "Pause", "btn btn-ghost btn-sm")}
              {status === "paused" && control("resume", "Resume", "btn btn-accent btn-sm")}
              {(status === "running" || status === "paused") && control("stop", "Stop", "btn btn-danger btn-sm", "Stop this campaign? Calls in progress will finish; no new calls will be placed.")}
            </>
          )
        }
      />
      {sp.error && (
        <div className="notice notice-bad" role="alert" style={{ marginBottom: 16 }}>
          {sp.error}
        </div>
      )}
      <nav className="tabs">
        <Link className="tab" href={`/app/campaigns/${id}`} aria-current={tab === "overview" ? "page" : undefined}>
          Overview
        </Link>
        {canEdit && (
          <Link className="tab" href={`/app/campaigns/${id}?tab=settings`} aria-current={tab === "settings" ? "page" : undefined}>
            Settings
          </Link>
        )}
      </nav>

      {tab === "settings" ? (
        status === "running" ? (
          <div className="notice notice-warn">Pause the campaign to change its settings.</div>
        ) : (
          <CampaignForm
            d={{
              id,
              name: camp.name,
              agent_id: (camp.agent_id as string) ?? null,
              list_ids: data.c.lists.map((l) => l.id),
              number_ids: (camp.number_ids as string[]) ?? [],
              transfer_number: (camp.transfer_number as string) ?? "",
              intro_name: (camp.intro_name as string) ?? "",
              voicemail_message: (camp.voicemail_message as string) ?? "",
              max_concurrency: camp.max_concurrency as number,
              calls_per_minute: camp.calls_per_minute as number,
              max_attempts: camp.max_attempts as number,
              window_start: ((camp.window_start as string) ?? "").slice(0, 5),
              window_end: ((camp.window_end as string) ?? "").slice(0, 5),
              retry_rules: camp.retry_rules as Record<string, { retry: boolean; delay_minutes: number }>,
            }}
            agents={data.agents}
            lists={data.lists.map((l) => ({ id: l.id, name: l.name, total: l.total }))}
            numbers={data.numbers}
            orgWindow={`${data.org.calling_window_start.slice(0, 5)}–${data.org.calling_window_end.slice(0, 5)}`}
          />
        )
      ) : (
        <>
          <dl className="stats">
            {(["pending", "in_progress", "retry_wait", "completed", "exhausted", "skipped"] as const).map((k) => (
              <div className="stat" key={k}>
                <dt>{STATE_LABEL[k]}</dt>
                <dd>{(st[k] ?? 0).toLocaleString("en-IN")}</dd>
              </div>
            ))}
            <div className="stat">
              <dt>Live calls</dt>
              <dd style={{ color: data.counts.live ? "var(--ok)" : undefined }}>{data.counts.live}</dd>
            </div>
          </dl>

          <div className="grid-main-side" style={{ marginTop: 16 }}>
            <section className="panel">
              <div className="panel-head">
                <h2>Leads in this campaign</h2>
                <div className="pill-tabs">
                  {(["all", "fresh", "dialed"] as const).map((v) => (
                    <Link key={v} href={`/app/campaigns/${id}${qs({}, { view: v === "all" ? undefined : v })}`} aria-current={view === v ? "page" : undefined}>
                      {v === "all" ? "All" : v === "fresh" ? "Fresh" : "Already dialled"}
                    </Link>
                  ))}
                </div>
              </div>
              {data.table.total === 0 ? (
                <p className="panel-body field-hint">{total === 0 ? "No leads yet — add a lead list in Settings." : "Nothing in this view."}</p>
              ) : (
                <>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Lead</th>
                          <th>Phone</th>
                          <th>State</th>
                          <th className="num">Attempts</th>
                          <th>Next eligible</th>
                          <th>Last outcome</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.table.rows.map((r) => (
                          <tr key={r.lead_id}>
                            <td>
                              <Link className="row-link" href={`/app/leads/${r.lead_id}`}>
                                {leadName(r.first_name, r.last_name)}
                              </Link>
                            </td>
                            <td className="mono">{formatPhone(r.phone_e164)}</td>
                            <td>{STATE_LABEL[r.state] ?? r.state}</td>
                            <td className="num">{r.attempts}</td>
                            <td className="muted">{["pending", "retry_wait"].includes(r.state) ? fmtDate(r.next_eligible_at) : "—"}</td>
                            <td>{r.last_outcome ? <OutcomeChip outcome={r.last_outcome} /> : <span className="muted">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pager page={page} pageSize={50} total={data.table.total} hrefFor={(p) => `/app/campaigns/${id}${qs({ view: view === "all" ? undefined : view }, { page: p })}`} />
                </>
              )}
            </section>

            <div className="stack">
              <section className="panel">
                <div className="panel-head">
                  <h2>Preflight</h2>
                  <span className={`chip ${blocking.length ? "chip-bad" : "chip-ok"}`}>{blocking.length ? `${blocking.length} to fix` : "Ready"}</span>
                </div>
                <div className="panel-body">
                  <ul className="checklist">
                    {data.checks.map((c) => (
                      <li key={c.key}>
                        <span className={`mark ${c.ok ? "mark-ok" : c.blocking ? "mark-bad" : "mark-warn"}`}>{c.ok ? "✓" : "!"}</span>
                        <span>
                          <b>{c.label}</b>
                          <span className="d">{c.detail}</span>
                        </span>
                        <span />
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
              <section className="panel">
                <div className="panel-head">
                  <h2>Outcomes</h2>
                  <Link className="btn btn-quiet btn-sm" href={`/app/calls?campaign=${id}`}>
                    Calls →
                  </Link>
                </div>
                <div className="panel-body">
                  {data.counts.outcomes.length === 0 ? (
                    <p className="field-hint">No calls yet.</p>
                  ) : (
                    <ul className="hbar-list">
                      {data.counts.outcomes.map((o) => {
                        const sum = data.counts.outcomes.reduce((n, x) => n + x.n, 0);
                        return (
                          <li key={o.outcome}>
                            <span>{OUTCOMES[o.outcome as Outcome] ?? "In progress"}</span>
                            <span className="meter">
                              <span style={{ width: `${(o.n / sum) * 100}%` }} />
                            </span>
                            <span className="num">{o.n}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>
              <section className="panel">
                <div className="panel-body field-hint">
                  Created {fmtDate(camp.created_at as Date)}
                  {camp.started_at ? ` · started ${fmtDate(camp.started_at as Date)}` : ""}. Fresh leads are always dialled before retries.
                </div>
              </section>
            </div>
          </div>
        </>
      )}
    </>
  );
}
