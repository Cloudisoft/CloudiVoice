import Link from "next/link";
import { endReasonText, OUTCOMES } from "@cloudivoice/core/outcomes";
import { formatPhone } from "@cloudivoice/core/phone";
import { formatInr } from "@cloudivoice/core/pricing";
import { listCalls } from "@cloudivoice/core/services/calls";
import { AutoRefresh } from "@/components/ui/AutoRefresh";
import { Icon } from "@/components/ui/Icon";
import { EmptyState, fmtDate, fmtDuration, OutcomeChip, PageHeader, Pager, qs, StateChip } from "@/components/ui/kit";
import { hasPermission, tenant } from "@/lib/session";

export const metadata = { title: "Call Records" };

export default async function CallsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const f = { q: sp.q, campaignId: sp.campaign, agentId: sp.agent, outcome: sp.outcome, direction: sp.direction, from: sp.from, to: sp.to };
  const { data, campaigns, agents, user } = await tenant(async (tx, user) => ({
    data: await listCalls(tx, f, page, 50),
    campaigns: await tx<{ id: string; name: string }[]>`select id, name from campaigns order by created_at desc`,
    agents: await tx<{ id: string; name: string }[]>`select id, name from agents order by name`,
    user,
  }), "calls.view");
  const base = { q: sp.q, campaign: sp.campaign, agent: sp.agent, outcome: sp.outcome, direction: sp.direction, from: sp.from, to: sp.to };
  const filtered = Object.values(base).some(Boolean);
  // New and in-progress calls show up (and settle) without a manual reload.
  const active = page === 1 && data.rows.some((c) => !["completed", "failed"].includes(c.state) || Date.now() - new Date(c.created_at).getTime() < 10 * 60_000);
  return (
    <>
      {active && <AutoRefresh seconds={4} />}
      <PageHeader
        title="Call Records"
        sub="Every call with its timeline, transcript, outcome, cost and the reason it ended — in plain words."
        actions={
          hasPermission(user, "leads.export") &&
          data.total > 0 && (
            <a className="btn btn-ghost btn-sm" href={`/api/calls/export${qs(base, {})}`}>
              <Icon name="download" /> Export CSV
            </a>
          )
        }
      />
      <section className="panel">
        <form className="filters" role="search">
          <input type="search" name="q" className="input" placeholder="Search number, name, summary…" defaultValue={sp.q} aria-label="Search calls" />
          <select name="campaign" className="select" defaultValue={sp.campaign ?? ""} aria-label="Campaign">
            <option value="">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select name="agent" className="select" defaultValue={sp.agent ?? ""} aria-label="Agent">
            <option value="">All agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select name="outcome" className="select" defaultValue={sp.outcome ?? ""} aria-label="Outcome">
            <option value="">Any outcome</option>
            {Object.entries(OUTCOMES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select name="direction" className="select" defaultValue={sp.direction ?? ""} aria-label="Direction">
            <option value="">All directions</option>
            <option value="outbound">Outbound</option>
            <option value="inbound">Inbound</option>
            <option value="test">Tests</option>
          </select>
          <input type="date" name="from" className="input" defaultValue={sp.from} aria-label="From date" />
          <input type="date" name="to" className="input" defaultValue={sp.to} aria-label="To date" />
          <button className="btn btn-ghost btn-sm">Filter</button>
          {filtered && (
            <Link href="/app/calls" className="btn btn-quiet btn-sm">
              Clear
            </Link>
          )}
        </form>
        {data.total === 0 ? (
          <EmptyState icon="records" title={filtered ? "No calls match" : "No calls yet"} body={filtered ? "Try different filters." : "Test an agent from your browser or phone and the full record appears here."} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Contact</th>
                    <th>Agent / campaign</th>
                    <th>Status</th>
                    <th>Outcome</th>
                    <th>How it ended</th>
                    <th className="num">Duration</th>
                    <th className="num">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link className="row-link" href={`/app/calls/${c.id}`}>
                          {fmtDate(c.created_at)}
                        </Link>
                        <div className="field-hint">{c.direction}</div>
                      </td>
                      <td>
                        <span className="strong">{c.lead_name ?? (c.direction === "test" && !c.to_e164 ? "Browser test" : "No name on file")}</span>
                        <div className="field-hint mono">{formatPhone(c.direction === "inbound" ? c.from_e164 : c.to_e164)}</div>
                      </td>
                      <td>
                        {c.agent_name ?? "—"}
                        {c.campaign_name && <div className="field-hint">{c.campaign_name}</div>}
                      </td>
                      <td>
                        <StateChip state={c.state} />
                      </td>
                      <td>
                        <OutcomeChip outcome={c.outcome} />
                      </td>
                      <td className="muted" style={{ maxWidth: 240 }}>
                        {endReasonText(c.end_reason) || "—"}
                      </td>
                      <td className="num">{fmtDuration(c.duration_sec)}</td>
                      <td className="num">{Number(c.cost_paise) ? formatInr(Number(c.cost_paise), { decimals: true }) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={50} total={data.total} hrefFor={(p) => `/app/calls${qs(base, { page: p })}`} />
          </>
        )}
      </section>
    </>
  );
}
