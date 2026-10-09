import type { Tx } from "../db/client";

export async function audit(
  tx: Tx,
  orgId: string,
  actorUserId: string | null,
  action: string,
  entity?: { type: string; id?: string | null },
  details: Record<string, unknown> = {},
) {
  await tx`insert into audit_logs (org_id, actor_user_id, action, entity_type, entity_id, details)
           values (${orgId}, ${actorUserId}, ${action}, ${entity?.type ?? null}, ${entity?.id ?? null}, ${tx.json(details as never)})`;
}

export async function listAudit(tx: Tx, limit = 100, before?: number) {
  return tx<
    { id: number; action: string; entity_type: string | null; entity_id: string | null; details: Record<string, unknown>; created_at: Date; actor_name: string | null }[]
  >`
    select a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at, u.name as actor_name
    from audit_logs a left join users u on u.id = a.actor_user_id
    where ${before ? tx`a.id < ${before}` : tx`true`}
    order by a.id desc limit ${limit}`;
}
