import type { Tx } from "../db/client";
import { requireTelephony } from "../telephony";
import { audit } from "./audit";

export async function listNumbers(tx: Tx) {
  return tx<
    {
      id: string;
      e164: string;
      label: string | null;
      region: string | null;
      number_type: string | null;
      voice_inbound: boolean;
      voice_outbound: boolean;
      status: string;
      inbound_agent_id: string | null;
      inbound_agent_name: string | null;
      campaigns: string[] | null;
      calls_7d: number;
      connected_7d: number;
    }[]
  >`select n.id, n.e164, n.label, n.region, n.number_type, n.voice_inbound, n.voice_outbound, n.status, n.inbound_agent_id,
       a.name as inbound_agent_name,
       (select array_agg(c.name) from campaigns c where n.id = any(c.number_ids)) as campaigns,
       (select count(*)::int from calls c where c.from_e164 = n.e164 and c.direction = 'outbound' and c.created_at > now() - interval '7 days') as calls_7d,
       (select count(*)::int from calls c where c.from_e164 = n.e164 and c.direction = 'outbound' and c.answered_at is not null and c.created_at > now() - interval '7 days') as connected_7d
    from phone_numbers n left join agents a on a.id = n.inbound_agent_id
    order by n.created_at`;
}

/** Pull numbers already on the telephony connection into the dashboard. */
export async function importCarrierNumbers(tx: Tx, orgId: string, userId: string) {
  const numbers = await requireTelephony().listNumbers();
  let added = 0;
  for (const n of numbers) {
    const r = await tx`
      insert into phone_numbers (org_id, e164, provider_ref, region, number_type, voice_inbound, voice_outbound)
      values (${orgId}, ${n.e164}, ${n.providerRef}, ${n.region}, ${n.numberType}, ${n.voiceEnabled}, ${n.voiceEnabled})
      on conflict (org_id, e164) do nothing`;
    added += r.count;
  }
  await audit(tx, orgId, userId, "numbers.imported", { type: "phone_number" }, { added, seen: numbers.length });
  return { added, seen: numbers.length };
}

export async function buyNumber(tx: Tx, orgId: string, userId: string, e164: string) {
  const n = await requireTelephony().buyNumber(e164);
  const [row] = await tx<{ id: string }[]>`
    insert into phone_numbers (org_id, e164, provider_ref, region, number_type)
    values (${orgId}, ${n.e164}, ${n.providerRef}, ${n.region}, ${n.numberType}) returning id`;
  await audit(tx, orgId, userId, "numbers.purchased", { type: "phone_number", id: row!.id }, { e164 });
  return row!.id;
}

export async function updateNumber(
  tx: Tx,
  orgId: string,
  userId: string,
  id: string,
  patch: { label?: string | null; inbound_agent_id?: string | null; status?: "active" | "inactive"; voice_inbound?: boolean; voice_outbound?: boolean },
) {
  await tx`update phone_numbers set
      label = ${patch.label === undefined ? tx`label` : patch.label?.slice(0, 60) || null},
      inbound_agent_id = ${patch.inbound_agent_id === undefined ? tx`inbound_agent_id` : patch.inbound_agent_id},
      status = coalesce(${patch.status ?? null}, status),
      voice_inbound = coalesce(${patch.voice_inbound ?? null}, voice_inbound),
      voice_outbound = coalesce(${patch.voice_outbound ?? null}, voice_outbound)
    where id = ${id}`;
  await audit(tx, orgId, userId, "numbers.updated", { type: "phone_number", id }, patch);
}

/**
 * Pick a caller number for a lead: same telecom circle/region if we have
 * one (local presence), otherwise rotate through the pool by least recent use.
 */
export async function pickCallerNumber(tx: Tx, numberIds: string[], leadState: string | null): Promise<{ id: string; e164: string } | null> {
  if (!numberIds.length) return null;
  const rows = await tx<{ id: string; e164: string; region: string | null; last_used: Date | null }[]>`
    select n.id, n.e164, n.region,
      (select max(c.created_at) from calls c where c.from_e164 = n.e164) as last_used
    from phone_numbers n
    where n.id in ${tx(numberIds)} and n.status = 'active' and n.voice_outbound`;
  if (!rows.length) return null;
  const byUse = (a: { last_used: Date | null }, b: { last_used: Date | null }) => (+(a.last_used ?? 0)) - (+(b.last_used ?? 0));
  if (leadState) {
    const local = rows.filter((r) => r.region && r.region.toLowerCase().includes(leadState.toLowerCase())).sort(byUse);
    if (local[0]) return local[0];
  }
  return rows.sort(byUse)[0]!;
}

/** Lead states/cities that have no matching local number yet. */
export async function coverageReport(tx: Tx) {
  return tx<{ state: string; leads: number; covered: boolean }[]>`
    select coalesce(nullif(l.state, ''), 'Unknown') as state, count(*)::int as leads,
      exists (select 1 from phone_numbers n where n.status = 'active' and n.region is not null and lower(n.region) like '%' || lower(l.state) || '%') as covered
    from leads l where not l.dnc group by l.state order by leads desc limit 40`;
}
