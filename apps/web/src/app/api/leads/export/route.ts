import { withTenant } from "@cloudivoice/core/db/client";
import { can } from "@cloudivoice/core/services/auth";
import { audit } from "@cloudivoice/core/services/audit";
import { leadIdsForFilter, leadsToCsv } from "@cloudivoice/core/services/leads";
import { currentUser } from "@/lib/session";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user?.orgId || !user.role || !can(user.role, "leads.export")) return new Response("Forbidden", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const filter = { q: sp.get("q") ?? undefined, listId: sp.get("list") ?? undefined, outcome: sp.get("outcome") ?? undefined, status: sp.get("status") ?? undefined };
  const csv = await withTenant(user.orgId, async (tx) => {
    const ids = await leadIdsForFilter(tx, filter);
    const rows = ids.length
      ? await tx`select first_name, last_name, phone_e164 as phone, email, city, state, pincode, status, last_outcome, attempts, dnc, created_at from leads where id in ${tx(ids)} order by created_at desc`
      : [];
    await audit(tx, user.orgId!, user.userId, "leads.exported", { type: "lead" }, { count: rows.length });
    return leadsToCsv(rows.map((r) => ({ ...r })));
  });
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
