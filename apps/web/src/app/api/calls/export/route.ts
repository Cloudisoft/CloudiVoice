import Papa from "papaparse";
import { withTenant } from "@cloudivoice/core/db/client";
import { endReasonText, OUTCOMES, type Outcome } from "@cloudivoice/core/outcomes";
import { can } from "@cloudivoice/core/services/auth";
import { audit } from "@cloudivoice/core/services/audit";
import { exportCalls } from "@cloudivoice/core/services/calls";
import { currentUser } from "@/lib/session";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user?.orgId || !user.role || !can(user.role, "leads.export")) return new Response("Forbidden", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const g = (k: string) => sp.get(k) ?? undefined;
  const rows = await withTenant(user.orgId, async (tx) => {
    const r = await exportCalls(tx, { q: g("q"), campaignId: g("campaign"), agentId: g("agent"), outcome: g("outcome"), direction: g("direction"), from: g("from"), to: g("to") });
    await audit(tx, user.orgId!, user.userId, "calls.exported", { type: "call" }, { count: r.length });
    return r;
  });
  const csv = Papa.unparse(
    rows.map((r) => ({
      ...r,
      outcome: r.outcome ? (OUTCOMES[r.outcome as Outcome] ?? r.outcome) : "",
      end_reason: endReasonText(r.end_reason as string),
    })),
  );
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="calls-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
