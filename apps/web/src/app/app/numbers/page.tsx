import { formatPhone } from "@cloudivoice/core/phone";
import { coverageReport, listNumbers } from "@cloudivoice/core/services/numbers";
import { telephony } from "@cloudivoice/core/telephony";
import { EmptyState, PageHeader } from "@/components/ui/kit";
import { hasPermission, tenant } from "@/lib/session";
import { updateNumberAction } from "./actions";
import { ImportNumbers, SearchNumbers } from "./NumberTools";

export const metadata = { title: "Phone Numbers" };

export default async function NumbersPage() {
  const { numbers, agents, coverage, user } = await tenant(async (tx, user) => ({
    numbers: await listNumbers(tx),
    agents: await tx<{ id: string; name: string; status: string }[]>`select id, name, status from agents order by name`,
    coverage: await coverageReport(tx),
    user,
  }));
  const connected = Boolean(telephony());
  const canManage = hasPermission(user, "numbers.manage");
  const uncovered = coverage.filter((c) => !c.covered && c.state !== "Unknown");

  return (
    <>
      <PageHeader title="Phone Numbers" sub="Numbers your agents call from and answer on. Connect rates are tracked per number so one bad line can’t sink a campaign." />
      {!connected && (
        <div className="notice notice-warn" style={{ marginBottom: 16 }}>
          The telephony connection isn’t configured for this workspace yet, so numbers can’t be added. An administrator can set it up — see Settings → Connections.
        </div>
      )}
      <div className="grid-main-side">
        <section className="panel">
          <div className="panel-head">
            <h2>Your numbers</h2>
          </div>
          {numbers.length === 0 ? (
            <EmptyState icon="phone" title="No numbers yet" body="Sync numbers already on your telephony connection, or search for a new Indian number on the right." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Inbound agent</th>
                    <th>Capabilities</th>
                    <th className="num">Connect · 7d</th>
                    <th>Campaigns</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {numbers.map((n) => {
                    const rate = n.calls_7d ? Math.round((n.connected_7d / n.calls_7d) * 100) : null;
                    return (
                      <tr key={n.id}>
                        <td colSpan={6} style={{ padding: 0 }}>
                          <form action={updateNumberAction} style={{ display: "grid", gridTemplateColumns: "minmax(150px,1.2fr) minmax(160px,1.2fr) minmax(170px,1fr) 90px minmax(120px,1fr) 80px", alignItems: "center", gap: 0 }}>
                            <input type="hidden" name="id" value={n.id} />
                            <div style={{ padding: "11px 14px" }}>
                              <div className="mono strong" style={{ color: "var(--text)" }}>
                                {formatPhone(n.e164)}
                              </div>
                              <input name="label" className="input" defaultValue={n.label ?? ""} placeholder="Label" aria-label="Label" disabled={!canManage} style={{ minHeight: 30, height: 30, marginTop: 6, fontSize: 13 }} />
                            </div>
                            <div style={{ padding: "11px 14px" }}>
                              <select name="inbound_agent_id" className="select select-compact" defaultValue={n.inbound_agent_id ?? ""} disabled={!canManage || !n.voice_inbound} aria-label="Inbound agent">
                                <option value="">No inbound agent</option>
                                {agents.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.name}
                                    {a.status !== "active" ? " (inactive)" : ""}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div style={{ padding: "11px 14px", display: "grid", gap: 4 }}>
                              <label className="check" style={{ fontSize: 13 }}>
                                <input type="checkbox" name="voice_inbound" defaultChecked={n.voice_inbound} disabled={!canManage} /> Inbound
                              </label>
                              <label className="check" style={{ fontSize: 13 }}>
                                <input type="checkbox" name="voice_outbound" defaultChecked={n.voice_outbound} disabled={!canManage} /> Outbound
                              </label>
                              <select name="status" className="select select-compact" defaultValue={n.status} disabled={!canManage} aria-label="Status">
                                <option value="active">Active</option>
                                <option value="inactive">Switched off</option>
                              </select>
                            </div>
                            <div className="num" style={{ padding: "11px 14px", textAlign: "right" }}>
                              {rate === null ? <span className="muted">—</span> : <span style={{ color: rate < 25 && n.calls_7d >= 20 ? "var(--bad)" : undefined }}>{rate}%</span>}
                              <div className="field-hint">{n.calls_7d} calls</div>
                            </div>
                            <div style={{ padding: "11px 14px", fontSize: 13 }}>{n.campaigns?.join(", ") ?? <span className="muted">—</span>}</div>
                            <div style={{ padding: "11px 14px" }}>{canManage && <button className="btn btn-quiet btn-sm">Save</button>}</div>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <div className="stack">
          {canManage && connected && (
            <section className="panel">
              <div className="panel-head">
                <h2>Add numbers</h2>
              </div>
              <div className="panel-body stack">
                <ImportNumbers />
                <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "6px 0" }} />
                <SearchNumbers />
              </div>
            </section>
          )}
          <section className="panel">
            <div className="panel-head">
              <h2>Local presence coverage</h2>
            </div>
            <div className="panel-body">
              {coverage.length === 0 ? (
                <p className="field-hint">Import leads with a state column to see which regions have a matching local number.</p>
              ) : (
                <>
                  <p className="field-hint" style={{ marginTop: 0 }}>
                    Leads are called from a number in their region when one exists; otherwise numbers rotate through the pool.
                  </p>
                  <ul className="hbar-list">
                    {coverage.slice(0, 10).map((c) => (
                      <li key={c.state}>
                        <span>{c.state}</span>
                        <span className={`chip ${c.covered ? "chip-ok" : "chip-warn"}`} style={{ justifySelf: "start" }}>
                          {c.covered ? "Local number" : "No local number"}
                        </span>
                        <span className="num">{c.leads}</span>
                      </li>
                    ))}
                  </ul>
                  {uncovered.length > 0 && <p className="field-hint">{uncovered.length} region(s) have leads but no local number yet.</p>}
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
