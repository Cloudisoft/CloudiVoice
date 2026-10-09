import { listAudit } from "@cloudivoice/core/services/audit";
import { fmtDate } from "@/components/ui/kit";
import { tenant } from "@/lib/session";

export const metadata = { title: "Audit log" };

export default async function AuditPage() {
  const rows = await tenant((tx) => listAudit(tx, 200), "audit.view");
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Audit log</h2>
        <span className="field-hint">Latest 200 actions</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="muted">{fmtDate(r.created_at)}</td>
                <td>{r.actor_name ?? "System"}</td>
                <td className="mono strong">{r.action}</td>
                <td className="muted mono" style={{ fontSize: 12, maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {Object.keys(r.details ?? {}).length ? JSON.stringify(r.details) : (r.entity_type ?? "")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
