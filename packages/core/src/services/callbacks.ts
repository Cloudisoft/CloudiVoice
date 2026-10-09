import type { Tx } from "../db/client";
import { audit } from "./audit";

export async function scheduleCallback(
  tx: Tx,
  input: { orgId: string; leadId: string; campaignId?: string | null; callId?: string | null; when: Date; reason?: string; createdBy: "ai" | string },
) {
  if (Number.isNaN(input.when.getTime())) throw new Error("Invalid callback time");
  const [row] = await tx<{ id: string }[]>`
    insert into callbacks (org_id, lead_id, campaign_id, call_id, scheduled_for, reason, created_by)
    values (${input.orgId}, ${input.leadId}, ${input.campaignId ?? null}, ${input.callId ?? null}, ${input.when}, ${input.reason?.slice(0, 300) ?? null}, ${input.createdBy})
    returning id`;
  return row!.id;
}

export async function listCallbacks(tx: Tx, status: "upcoming" | "past" = "upcoming") {
  return tx<{ id: string; scheduled_for: Date; status: string; reason: string | null; created_by: string; lead_id: string; lead_name: string | null; phone_e164: string; campaign_name: string | null }[]>`
    select cb.id, cb.scheduled_for, cb.status, cb.reason, cb.created_by, cb.lead_id,
      nullif(trim(coalesce(l.first_name,'') || ' ' || coalesce(l.last_name,'')), '') as lead_name, l.phone_e164, cp.name as campaign_name
    from callbacks cb join leads l on l.id = cb.lead_id left join campaigns cp on cp.id = cb.campaign_id
    where ${status === "upcoming" ? tx`cb.status in ('scheduled','dialing')` : tx`cb.status not in ('scheduled','dialing')`}
    order by cb.scheduled_for ${status === "upcoming" ? tx`asc` : tx`desc`} limit 200`;
}

export async function cancelCallback(tx: Tx, orgId: string, userId: string, id: string) {
  await tx`update callbacks set status = 'cancelled' where id = ${id} and status = 'scheduled'`;
  await audit(tx, orgId, userId, "callback.cancelled", { type: "callback", id });
}

export async function rescheduleCallback(tx: Tx, orgId: string, userId: string, id: string, when: Date) {
  await tx`update callbacks set scheduled_for = ${when}, status = 'scheduled' where id = ${id} and status in ('scheduled','failed')`;
  await audit(tx, orgId, userId, "callback.rescheduled", { type: "callback", id }, { when: when.toISOString() });
}
