import { withTenant } from "@cloudivoice/core/db/client";
import { formatPhone } from "@cloudivoice/core/phone";
import { can } from "@cloudivoice/core/services/auth";
import { liveCalls, transcriptSince } from "@cloudivoice/core/services/calls";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Live calls + incremental transcript for the monitor (polled every 2 s). */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user?.orgId || !user.role || !can(user.role, "calls.view")) return Response.json({ error: "Forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const callId = sp.get("call");
  const after = Number(sp.get("after") ?? 0) || 0;
  const data = await withTenant(user.orgId, async (tx) => {
    const calls = (await liveCalls(tx)).map((c) => ({
      id: c.id,
      direction: c.direction,
      state: c.state,
      who: c.lead_name ?? formatPhone(c.direction === "inbound" ? c.from_e164 : c.to_e164) ?? "Browser test",
      agent: c.agent_name,
      campaign: c.campaign_name,
      startedAt: (c.answered_at ?? c.created_at).toISOString(),
      lastLine: c.last_line,
    }));
    const lines = callId && /^[0-9a-f-]{36}$/.test(callId) ? await transcriptSince(tx, callId, after) : [];
    return { calls, lines };
  });
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}
