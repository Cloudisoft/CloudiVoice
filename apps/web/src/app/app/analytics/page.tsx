import Link from "next/link";
import { formatPhone } from "@cloudivoice/core/phone";
import { formatInr } from "@cloudivoice/core/pricing";
import { campaignReport, numberReport, qaList } from "@cloudivoice/core/services/analytics";
import { EmptyState, fmtDate, fmtDuration, OutcomeChip, PageHeader } from "@/components/ui/kit";
import { tenant } from "@/lib/session";

export const metadata = { title: "Analytics & QA" };

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export default async function AnalyticsPage() {
  const { campaigns, numbers, qa } = await tenant(async (tx) => ({ campaigns: await campaignReport(tx), numbers: await numberReport(tx), qa: await qaList(tx, 40) }), "calls.view");
  const scored = qa.filter((q) => q.qa);
  const avgQa = scored.length ? Math.round(scored.reduce((n, q) => n + (q.qa?.score ?? 0), 0) / scored.length) : null;
  const lowConfidence = qa.filter((q) => !q.outcome_overridden && (q.outcome_confidence ?? 1) < 0.7);

  return (
    <>
      <PageHeader title="Analytics & QA" sub="Campaign and number performance, AI quality scores against your rubric, and outcomes worth a second look." />
      <dl className="stats" style={{ marginBottom: 16 }}>
        <div className="stat">
          <dt>Average QA score</dt>
          <dd>{avgQa ?? "—"}<span className="sub">{scored.length} scored calls</span></dd>
        </div>
        <div className="stat">
          <dt>Low-confidence outcomes</dt>
          <dd>{lowConfidence.length}<span className="sub">worth reviewing</span></dd>
        </div>
        <div className="stat">
          <dt>Supervisor overrides</dt>
          <dd>{qa.filter((q) => q.outcome_overridden).length}</dd>
        </div>
      </dl>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <h2>Campaigns</h2>
        </div>
        {campaigns.length === 0 ? (
          <EmptyState icon="campaign" title="No campaign data yet" body="Run a campaign to compare connect rates, positive outcomes and cost per campaign." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th className="num">Calls</th>
                  <th className="num">Connect rate</th>
                  <th className="num">Positive</th>
                  <th className="num">Transfers</th>
                  <th className="num">Avg duration</th>
                  <th className="num">Avg QA</th>
                  <th className="num">Cost</th>
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
                    <td className="num">{c.calls}</td>
                    <td className="num">{pct(c.connected, c.calls)}</td>
                    <td className="num">{pct(c.positive, c.connected)}</td>
                    <td className="num">{c.transferred}</td>
                    <td className="num">{fmtDuration(c.avg_duration)}</td>
                    <td className="num">{c.avg_qa ?? "—"}</td>
                    <td className="num">{formatInr(Number(c.cost_paise))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <h2>Caller numbers · 30 days</h2>
          </div>
          {numbers.length === 0 ? (
            <p className="panel-body field-hint">No numbers yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th className="num">Calls</th>
                    <th className="num">Connect</th>
                    <th className="num">Never connected</th>
                  </tr>
                </thead>
                <tbody>
                  {numbers.map((n) => {
                    const bad = n.calls >= 20 && n.connected / n.calls < 0.25;
                    return (
                      <tr key={n.e164}>
                        <td className="mono">
                          {formatPhone(n.e164)} {bad && <span className="chip chip-bad">Check this number</span>}
                        </td>
                        <td className="num">{n.calls}</td>
                        <td className="num">{pct(n.connected, n.calls)}</td>
                        <td className="num">{n.never_connected}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>QA review queue</h2>
          </div>
          {qa.length === 0 ? (
            <p className="panel-body field-hint">Answered calls are scored automatically after they end.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Call</th>
                    <th>Outcome</th>
                    <th className="num">Confidence</th>
                    <th className="num">QA</th>
                  </tr>
                </thead>
                <tbody>
                  {[...lowConfidence, ...qa.filter((q) => !lowConfidence.includes(q))].slice(0, 20).map((q) => (
                    <tr key={q.id}>
                      <td>
                        <Link className="row-link" href={`/app/calls/${q.id}`}>
                          {fmtDate(q.created_at)}
                        </Link>
                        <div className="field-hint">{q.agent_name ?? "—"}</div>
                      </td>
                      <td title={q.outcome_reason ?? ""}>
                        <OutcomeChip outcome={q.outcome} />
                        {q.outcome_overridden && <div className="field-hint">overridden</div>}
                      </td>
                      <td className="num" style={{ color: (q.outcome_confidence ?? 1) < 0.7 ? "var(--warn)" : undefined }}>
                        {q.outcome_confidence != null ? `${Math.round(q.outcome_confidence * 100)}%` : "—"}
                      </td>
                      <td className="num">{q.qa?.score ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      <p className="field-hint" style={{ marginTop: 14 }}>
        Every automatic outcome carries a confidence score and a plain-language reason. Overrides by managers are kept and never replaced by later automatic updates.
      </p>
    </>
  );
}
