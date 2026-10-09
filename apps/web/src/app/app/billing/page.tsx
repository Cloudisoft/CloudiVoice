import { aiPerMinute, formatInr, pricing } from "@cloudivoice/core/pricing";
import { usageSummary } from "@cloudivoice/core/services/analytics";
import { fmtDate, PageHeader } from "@/components/ui/kit";
import { tenant } from "@/lib/session";

export const metadata = { title: "Usage & Billing" };

const CATEGORY: Record<string, string> = {
  telephony: "Telephony",
  speech_to_text: "Speech-to-text",
  reasoning: "Reasoning",
  text_to_speech: "Text-to-speech",
  platform: "Platform",
  storage: "Storage",
  number_rental: "Number rental",
  credit: "Credits",
};

export default async function BillingPage() {
  const { usage, org } = await tenant(async (tx) => ({
    usage: await usageSummary(tx),
    org: (await tx<{ monthly_spend_limit_paise: string | null; max_concurrency: number }[]>`select monthly_spend_limit_paise, max_concurrency from organizations`)[0]!,
  }), "billing.view");
  const p = pricing();
  const monthSpend = usage.byCategory.filter((c) => c.category !== "credit").reduce((n, c) => n + Number(c.amount), 0);
  const limit = org.monthly_spend_limit_paise ? Number(org.monthly_spend_limit_paise) : null;
  return (
    <>
      <PageHeader title="Usage & Billing" sub="Every call is itemised by component. Amounts in rupees, excluding GST." />
      <dl className="stats">
        <div className="stat">
          <dt>Credit balance</dt>
          <dd style={{ color: usage.balance < 0 ? "var(--bad)" : undefined }}>{formatInr(usage.balance)}</dd>
        </div>
        <div className="stat">
          <dt>Spent this month</dt>
          <dd>{formatInr(monthSpend)}</dd>
        </div>
        <div className="stat">
          <dt>Monthly limit</dt>
          <dd>
            {limit ? formatInr(limit) : "Not set"}
            {limit && <span className="sub">{Math.round((monthSpend / limit) * 100)}% used</span>}
          </dd>
        </div>
        <div className="stat">
          <dt>Concurrent calls</dt>
          <dd>{org.max_concurrency}</dd>
        </div>
      </dl>
      <div className="grid-main-side" style={{ marginTop: 16 }}>
        <section className="panel">
          <div className="panel-head">
            <h2>Ledger</h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Item</th>
                  <th className="num">Quantity</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {usage.ledger.map((l) => (
                  <tr key={l.id}>
                    <td className="muted">{fmtDate(l.created_at)}</td>
                    <td>
                      {CATEGORY[l.category] ?? l.category}
                      {l.description && <span className="field-hint"> · {l.description}</span>}
                    </td>
                    <td className="num">
                      {Number(l.quantity).toLocaleString("en-IN", { maximumFractionDigits: 2 })} {l.unit}
                    </td>
                    <td className="num" style={{ color: Number(l.amount_paise) < 0 ? "var(--ok)" : undefined }}>
                      {Number(l.amount_paise) < 0 ? `+${formatInr(-Number(l.amount_paise), { decimals: true })}` : formatInr(Number(l.amount_paise), { decimals: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>This month by component</h2>
            </div>
            <div className="panel-body">
              {usage.byCategory.filter((c) => c.category !== "credit").length === 0 ? (
                <p className="field-hint">No usage yet this month.</p>
              ) : (
                <ul className="hbar-list">
                  {usage.byCategory
                    .filter((c) => c.category !== "credit")
                    .map((c) => (
                      <li key={c.category}>
                        <span>{CATEGORY[c.category] ?? c.category}</span>
                        <span className="meter">
                          <span style={{ width: `${monthSpend ? (Number(c.amount) / monthSpend) * 100 : 0}%` }} />
                        </span>
                        <span className="num">{formatInr(Number(c.amount))}</span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Your rates</h2>
            </div>
            <dl className="kv panel-body">
              <dt>Telephony</dt>
              <dd>{formatInr(p.perMinute.telephony, { decimals: true })}/min</dd>
              <dt>AI agent (all layers)</dt>
              <dd>{formatInr(aiPerMinute(p), { decimals: true })}/min</dd>
              <dt>Phone number</dt>
              <dd>{formatInr(p.numberRentalMonthly)}/month</dd>
              <dt>Billing</dt>
              <dd>Per second of connected time</dd>
            </dl>
            <p className="panel-body field-hint" style={{ paddingTop: 0 }}>
              To add credits or change plans, contact Cloudisoft billing. Set a monthly spend limit under Settings.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
