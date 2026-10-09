import Link from "next/link";
import { liveStackStatus } from "@cloudivoice/core/env";
import { OUTCOMES, type Outcome } from "@cloudivoice/core/outcomes";
import { formatPhone } from "@cloudivoice/core/phone";
import { formatInr } from "@cloudivoice/core/pricing";
import { overview } from "@cloudivoice/core/services/analytics";
import { Icon } from "@/components/ui/Icon";
import { EmptyState, fmtDate, fmtDuration, OutcomeChip, PageHeader, StateChip } from "@/components/ui/kit";
import { tenant } from "@/lib/session";

export const metadata = { title: "Overview" };

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const sp = await searchParams;
  const { data, setup, user } = await tenant(async (tx, user) => {
    const data = await overview(tx, 7);
    const [s] = await tx<{ agents: number; active_agents: number; numbers: number; leads: number; campaigns: number; calls: number }[]>`
      select (select count(*)::int from agents) as agents,
             (select count(*)::int from agents where status = 'active') as active_agents,
             (select count(*)::int from phone_numbers where status = 'active') as numbers,
             (select count(*)::int from leads) as leads,
             (select count(*)::int from campaigns) as campaigns,
             (select count(*)::int from calls) as calls`;
    return { data, setup: s!, user };
  });
  const stack = liveStackStatus();
  const t = data.totals;
  const connectRate = t.calls ? Math.round((t.connected / t.calls) * 100) : null;
  const maxDay = Math.max(1, ...data.daily.map((d) => d.calls));
  const balance = Number(data.balance.credits) - Number(data.balance.spent);
  const totalOutcomes = data.outcomes.reduce((n, o) => n + o.n, 0);

  const steps = [
    { done: setup.agents > 0, title: "Create your first agent", body: "Pick a use case, language and voice.", href: "/app/agents/new", cta: "Create agent" },
    { done: setup.active_agents > 0, title: "Test and activate it", body: "Talk to it in your browser or get a test call.", href: "/app/agents", cta: "Open agents" },
    { done: setup.numbers > 0, title: "Connect a phone number", body: "Use an eligible number for inbound and outbound calls.", href: "/app/numbers", cta: "Phone numbers" },
    { done: setup.leads > 0, title: "Import your leads", body: "Upload CSV or Excel. Numbers are cleaned automatically.", href: "/app/leads/import", cta: "Import leads" },
    { done: setup.campaigns > 0, title: "Launch a campaign", body: "Preflight checks make sure everything is ready.", href: "/app/campaigns/new", cta: "New campaign" },
  ];
  const remaining = steps.filter((s) => !s.done).length;

  return (
    <>
      <PageHeader
        title={`Namaste, ${user.name.split(" ")[0]}`}
        sub="Here’s how your voice agents performed over the last 7 days."
        actions={
          <>
            <Link href="/app/calls" className="btn btn-ghost btn-sm">
              Call records
            </Link>
            <Link href="/app/agents/new" className="btn btn-accent btn-sm">
              <Icon name="plus" /> New agent
            </Link>
          </>
        }
      />
      {sp.denied && (
        <div className="notice notice-warn" style={{ marginBottom: 16 }}>
          Your role doesn’t have access to that page. Ask an admin if you need it.
        </div>
      )}

      {remaining > 0 && (
        <section className="panel" aria-labelledby="gs-title" style={{ marginBottom: 16 }}>
          <div className="panel-head">
            <h2 id="gs-title">Get to your first real call</h2>
            <span className="chip chip-accent">
              {steps.length - remaining}/{steps.length} done
            </span>
          </div>
          <div className="panel-body">
            <ul className="checklist">
              {steps.map((s) => (
                <li key={s.title}>
                  <span className={`mark ${s.done ? "mark-ok" : "mark-warn"}`}>{s.done ? "✓" : "•"}</span>
                  <span>
                    <b>{s.title}</b>
                    <span className="d">{s.body}</span>
                  </span>
                  {!s.done && (
                    <Link href={s.href} className="btn btn-ghost btn-sm">
                      {s.cta}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <dl className="stats">
        <div className="stat">
          <dt>Calls today</dt>
          <dd>{t.today.toLocaleString("en-IN")}</dd>
        </div>
        <div className="stat">
          <dt>Calls · 7 days</dt>
          <dd>{t.calls.toLocaleString("en-IN")}</dd>
        </div>
        <div className="stat">
          <dt>Connect rate</dt>
          <dd>
            {connectRate === null ? "—" : `${connectRate}%`}
            <span className="sub">{t.connected.toLocaleString("en-IN")} connected</span>
          </dd>
        </div>
        <div className="stat">
          <dt>Transfers</dt>
          <dd>{t.transferred.toLocaleString("en-IN")}</dd>
        </div>
        <div className="stat">
          <dt>Avg duration</dt>
          <dd>{fmtDuration(t.avg_duration)}</dd>
        </div>
        <div className="stat">
          <dt>Usage · 7 days</dt>
          <dd>
            {formatInr(Number(t.cost_paise ?? 0))}
            <span className="sub">{t.minutes.toLocaleString("en-IN")} min</span>
          </dd>
        </div>
        <div className="stat">
          <dt>Credit balance</dt>
          <dd style={{ color: balance < 0 ? "var(--bad)" : undefined }}>{formatInr(balance)}</dd>
        </div>
      </dl>

      <div className="grid-main-side" style={{ marginTop: 16 }}>
        <section className="panel" aria-labelledby="vol-title">
          <div className="panel-head">
            <h2 id="vol-title">Call volume</h2>
            <span className="legend">
              <span>
                <i style={{ background: "#ff9a1a" }} />
                Connected
              </span>
              <span>
                <i style={{ background: "rgba(159,180,255,.4)" }} />
                Not connected
              </span>
            </span>
          </div>
          <div className="panel-body">
            {t.calls === 0 ? (
              <EmptyState icon="chart" title="No calls yet" body="Once your agent makes or answers calls, daily volume and connect rates appear here." />
            ) : (
              <div className="bars" role="img" aria-label="Calls per day for the last 7 days">
                {data.daily.map((d) => (
                  <div className="b" key={d.day} title={`${d.day}: ${d.calls} calls, ${d.connected} connected`}>
                    <div className="col" style={{ height: `${(d.calls / maxDay) * 100}%` }}>
                      <div className="fill" style={{ height: d.calls ? `${(d.connected / d.calls) * 100}%` : 0 }} />
                    </div>
                    <span className="lbl">{new Date(d.day).toLocaleDateString("en-IN", { weekday: "short" })}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="panel" aria-labelledby="out-title">
          <div className="panel-head">
            <h2 id="out-title">Outcomes</h2>
          </div>
          <div className="panel-body">
            {totalOutcomes === 0 ? (
              <p className="field-hint">Outcomes are set automatically after each call, with a confidence score and a reason in plain words.</p>
            ) : (
              <ul className="hbar-list">
                {data.outcomes.slice(0, 8).map((o) => (
                  <li key={o.outcome}>
                    <span>{OUTCOMES[o.outcome as Outcome] ?? "In progress"}</span>
                    <span className="meter">
                      <span style={{ width: `${(o.n / totalOutcomes) * 100}%` }} />
                    </span>
                    <span className="num">{o.n}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <div className="grid-main-side" style={{ marginTop: 16 }}>
        <section className="panel" aria-labelledby="recent-title">
          <div className="panel-head">
            <h2 id="recent-title">Recent activity</h2>
            <Link href="/app/calls" className="btn btn-quiet btn-sm">
              View all
            </Link>
          </div>
          {data.recent.length === 0 ? (
            <EmptyState
              icon="phone"
              title="Your call log is empty"
              body="Place a test call from any agent to see the full record — transcript, outcome and cost."
              actions={
                <Link className="btn btn-ghost btn-sm" href="/app/agents">
                  Test an agent
                </Link>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Contact</th>
                    <th>Direction</th>
                    <th>Status</th>
                    <th>Outcome</th>
                    <th className="num">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((c) => (
                    <tr key={c.id}>
                      <td className="muted">{fmtDate(c.created_at)}</td>
                      <td>
                        <Link href={`/app/calls/${c.id}`} className="row-link">
                          {c.lead_name ?? formatPhone(c.direction === "inbound" ? c.from_e164 : c.to_e164) ?? "Browser test"}
                        </Link>
                      </td>
                      <td className="muted">{c.direction}</td>
                      <td>
                        <StateChip state={c.state} />
                      </td>
                      <td>
                        <OutcomeChip outcome={c.outcome} />
                      </td>
                      <td className="num">{fmtDuration(c.duration_sec)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel" aria-labelledby="health-title">
          <div className="panel-head">
            <h2 id="health-title">Integration health</h2>
          </div>
          <div className="panel-body">
            <ul className="checklist">
              {[
                { ok: stack.telephony, name: "Telephony connection", ok_d: "Connected", bad_d: "Not configured — calls can’t be placed yet." },
                { ok: stack.speech, name: "Speech engine", ok_d: "Ready", bad_d: "Not configured." },
                { ok: stack.llm, name: "Reasoning engine", ok_d: "Ready", bad_d: "Not configured." },
              ].map((h) => (
                <li key={h.name}>
                  <span className={`mark ${h.ok ? "mark-ok" : "mark-bad"}`}>{h.ok ? "✓" : "!"}</span>
                  <span>
                    <b>{h.name}</b>
                    <span className="d">{h.ok ? h.ok_d : h.bad_d}</span>
                  </span>
                  <span />
                </li>
              ))}
            </ul>
            <Link href="/app/settings/health" className="btn btn-quiet btn-sm" style={{ marginTop: 8 }}>
              System health →
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
