import { z } from "zod";
import type { Tx } from "../db/client";
import { normalizePhone } from "../phone";
import { telephony } from "../telephony";
import { liveStackStatus } from "../env";
import { audit } from "./audit";
import { isWithinCallingWindow } from "../schedule";

export const campaignSchema = z.object({
  name: z.string().trim().min(2).max(80),
  agent_id: z.string().uuid().nullable(),
  list_ids: z.array(z.string().uuid()).max(20).default([]),
  number_ids: z.array(z.string().uuid()).max(50).default([]),
  transfer_number: z.string().trim().max(20).default(""),
  intro_name: z.string().trim().max(40).default(""),
  voicemail_message: z.string().trim().max(600).default(""),
  max_concurrency: z.coerce.number().int().min(1).max(100).default(2),
  calls_per_minute: z.coerce.number().int().min(1).max(120).default(10),
  max_attempts: z.coerce.number().int().min(1).max(10).default(3),
  window_start: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
  window_end: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
  retry_rules: z
    .record(z.string(), z.object({ retry: z.boolean(), delay_minutes: z.coerce.number().int().min(5).max(10080) }))
    .optional(),
});

export type CampaignInput = z.infer<typeof campaignSchema>;

export async function saveCampaign(tx: Tx, orgId: string, userId: string, input: CampaignInput, id?: string) {
  const c = campaignSchema.parse(input);
  let transfer = "";
  if (c.transfer_number) {
    const p = normalizePhone(c.transfer_number);
    if (!p) throw new Error("The transfer number doesn't look like a valid phone number.");
    transfer = p.e164;
  }
  let campaignId = id;
  if (id) {
    const [cur] = await tx<{ status: string }[]>`select status from campaigns where id = ${id}`;
    if (!cur) throw new Error("Campaign not found");
    if (cur.status === "running") throw new Error("Pause the campaign before editing it.");
    await tx`update campaigns set name = ${c.name}, agent_id = ${c.agent_id}, number_ids = ${c.number_ids}::uuid[],
             transfer_number = ${transfer || null}, intro_name = ${c.intro_name || null}, voicemail_message = ${c.voicemail_message || null},
             max_concurrency = ${c.max_concurrency}, calls_per_minute = ${c.calls_per_minute}, max_attempts = ${c.max_attempts},
             window_start = ${c.window_start}, window_end = ${c.window_end}
             ${c.retry_rules ? tx`, retry_rules = ${tx.json(c.retry_rules as never)}` : tx``}
             where id = ${id}`;
    await tx`delete from campaign_lists where campaign_id = ${id}`;
  } else {
    const [row] = await tx<{ id: string }[]>`
      insert into campaigns (org_id, name, agent_id, number_ids, transfer_number, intro_name, voicemail_message, max_concurrency, calls_per_minute, max_attempts, window_start, window_end)
      values (${orgId}, ${c.name}, ${c.agent_id}, ${c.number_ids}::uuid[], ${transfer || null}, ${c.intro_name || null}, ${c.voicemail_message || null},
              ${c.max_concurrency}, ${c.calls_per_minute}, ${c.max_attempts}, ${c.window_start}, ${c.window_end})
      returning id`;
    campaignId = row!.id;
  }
  for (const listId of c.list_ids) {
    await tx`insert into campaign_lists (campaign_id, list_id, org_id) values (${campaignId!}, ${listId}, ${orgId}) on conflict do nothing`;
  }
  await syncCampaignLeads(tx, orgId, campaignId!);
  await audit(tx, orgId, userId, id ? "campaign.updated" : "campaign.created", { type: "campaign", id: campaignId! }, { name: c.name });
  return campaignId!;
}

/** Add any new list members to the campaign's dial queue (DNC excluded). */
export async function syncCampaignLeads(tx: Tx, orgId: string, campaignId: string) {
  const r = await tx`
    insert into campaign_leads (campaign_id, lead_id, org_id, state)
    select ${campaignId}, m.lead_id, ${orgId}, case when l.dnc then 'skipped' else 'pending' end
    from campaign_lists cl join lead_list_members m on m.list_id = cl.list_id join leads l on l.id = m.lead_id
    where cl.campaign_id = ${campaignId}
    on conflict do nothing`;
  return r.count;
}

export interface PreflightCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  blocking: boolean;
}

/** Everything that must be true before a campaign may start dialling. */
export async function preflight(tx: Tx, campaignId: string): Promise<PreflightCheck[]> {
  const [c] = await tx<{
    agent_id: string | null;
    number_ids: string[];
    transfer_number: string | null;
    window_start: string | null;
    window_end: string | null;
  }[]>`select agent_id, number_ids, transfer_number, window_start, window_end from campaigns where id = ${campaignId}`;
  if (!c) throw new Error("Campaign not found");
  const [org] = await tx<{ timezone: string; calling_window_start: string; calling_window_end: string; calling_days: number[] }[]>`
    select timezone, calling_window_start, calling_window_end, calling_days from organizations`;
  const checks: PreflightCheck[] = [];
  const stack = liveStackStatus();

  const [agent] = c.agent_id ? await tx<{ status: string; name: string }[]>`select status, name from agents where id = ${c.agent_id}` : [];
  checks.push({
    key: "agent",
    label: "AI agent",
    ok: Boolean(agent && agent.status === "active"),
    detail: !agent ? "Choose an agent for this campaign." : agent.status !== "active" ? `“${agent.name}” is not active. Activate it on the Agents page.` : `“${agent.name}” is active.`,
    blocking: true,
  });

  const numbers = c.number_ids.length
    ? await tx<{ e164: string; status: string; voice_outbound: boolean }[]>`select e164, status, voice_outbound from phone_numbers where id in ${tx(c.number_ids)}`
    : [];
  const usable = numbers.filter((n) => n.status === "active" && n.voice_outbound);
  checks.push({
    key: "numbers",
    label: "Caller numbers",
    ok: usable.length > 0,
    detail: usable.length ? `${usable.length} outbound-capable number${usable.length > 1 ? "s" : ""} in the pool.` : "Add at least one active, outbound-capable number.",
    blocking: true,
  });

  checks.push({
    key: "transfer",
    label: "Transfer number",
    ok: !c.transfer_number || Boolean(normalizePhone(c.transfer_number)),
    detail: c.transfer_number ? `Calls will be handed to ${c.transfer_number} when a person is requested.` : "No transfer number — callers who ask for a person will be offered a callback.",
    blocking: false,
  });

  const [{ due }] = (await tx<{ due: number }[]>`
    select count(*)::int as due from campaign_leads where campaign_id = ${campaignId} and state in ('pending','retry_wait')`) as unknown as [{ due: number }];
  checks.push({ key: "leads", label: "Leads to call", ok: due > 0, detail: due ? `${due.toLocaleString("en-IN")} leads waiting.` : "No leads waiting. Add a lead list or reset leads for redial.", blocking: true });

  const window = isWithinCallingWindow(new Date(), {
    timezone: org!.timezone,
    start: c.window_start ?? org!.calling_window_start,
    end: c.window_end ?? org!.calling_window_end,
    days: org!.calling_days,
  });
  checks.push({
    key: "hours",
    label: "Calling hours",
    ok: window.open,
    detail: window.open ? "Inside calling hours now." : `Outside calling hours — dialling will begin ${window.nextOpenText}.`,
    blocking: false,
  });

  checks.push({
    key: "telephony",
    label: "Telephony connection",
    ok: Boolean(telephony()),
    detail: telephony() ? "Connected." : "Not configured yet. Ask an admin to set up the telephony connection.",
    blocking: true,
  });
  checks.push({
    key: "voice",
    label: "Voice engine",
    ok: stack.speech && stack.llm,
    detail: stack.speech && stack.llm ? "Speech and reasoning engines are ready." : "The voice engine is not fully configured.",
    blocking: true,
  });
  return checks;
}

export async function setCampaignStatus(tx: Tx, orgId: string, userId: string, campaignId: string, action: "start" | "pause" | "resume" | "stop") {
  const [c] = await tx<{ status: string }[]>`select status from campaigns where id = ${campaignId} for update`;
  if (!c) throw new Error("Campaign not found");
  const next = { start: "running", resume: "running", pause: "paused", stop: "stopped" }[action];
  const allowed: Record<string, string[]> = {
    start: ["draft", "stopped", "completed"],
    resume: ["paused"],
    pause: ["running"],
    stop: ["running", "paused", "draft"],
  };
  if (!allowed[action]!.includes(c.status)) throw new Error(`Can't ${action} a campaign that is ${c.status}.`);
  if (next === "running") {
    const checks = await preflight(tx, campaignId);
    const failing = checks.filter((x) => x.blocking && !x.ok);
    if (failing.length) throw new Error(`Preflight failed: ${failing.map((f) => f.label).join(", ")}.`);
    await syncCampaignLeads(tx, orgId, campaignId);
  }
  // Pausing/stopping only stops new calls; live calls finish naturally.
  await tx`update campaigns set status = ${next},
           started_at = case when ${next} = 'running' then coalesce(started_at, now()) else started_at end,
           stopped_at = case when ${next} = 'stopped' then now() else stopped_at end
           where id = ${campaignId}`;
  await audit(tx, orgId, userId, `campaign.${action}`, { type: "campaign", id: campaignId });
}

export async function listCampaigns(tx: Tx) {
  return tx<
    { id: string; name: string; status: string; agent_name: string | null; created_at: Date; started_at: Date | null; total: number; pending: number; in_progress: number; completed: number }[]
  >`select c.id, c.name, c.status, a.name as agent_name, c.created_at, c.started_at,
      count(cl.lead_id)::int as total,
      count(cl.lead_id) filter (where cl.state in ('pending','retry_wait'))::int as pending,
      count(cl.lead_id) filter (where cl.state = 'in_progress')::int as in_progress,
      count(cl.lead_id) filter (where cl.state in ('completed','exhausted'))::int as completed
    from campaigns c left join agents a on a.id = c.agent_id left join campaign_leads cl on cl.campaign_id = c.id
    group by c.id, a.name order by c.created_at desc`;
}

export async function getCampaign(tx: Tx, id: string) {
  const [c] = await tx`select c.*, a.name as agent_name from campaigns c left join agents a on a.id = c.agent_id where c.id = ${id}`;
  if (!c) return null;
  const lists = await tx<{ id: string; name: string }[]>`select ll.id, ll.name from campaign_lists cl join lead_lists ll on ll.id = cl.list_id where cl.campaign_id = ${id}`;
  return { campaign: c, lists };
}

/** Live counts by state and by outcome. Single grouped query per breakdown. */
export async function campaignCounts(tx: Tx, id: string) {
  const states = await tx<{ state: string; n: number }[]>`select state, count(*)::int as n from campaign_leads where campaign_id = ${id} group by state`;
  const outcomes = await tx<{ outcome: string; n: number }[]>`
    select coalesce(outcome, 'pending') as outcome, count(*)::int as n from calls where campaign_id = ${id} group by 1 order by 2 desc`;
  const [live] = await tx<{ n: number }[]>`select count(*)::int as n from calls where campaign_id = ${id} and state in ('queued','ringing','answered','in_progress','transferring')`;
  return { states: Object.fromEntries(states.map((s) => [s.state, s.n])) as Record<string, number>, outcomes, live: live?.n ?? 0 };
}

export async function campaignLeadTable(tx: Tx, id: string, view: "fresh" | "dialed" | "all", page = 1, pageSize = 50) {
  const cond = view === "fresh" ? tx`cl.attempts = 0` : view === "dialed" ? tx`cl.attempts > 0` : tx`true`;
  const rows = await tx<
    { lead_id: string; first_name: string | null; last_name: string | null; phone_e164: string; state: string; attempts: number; next_eligible_at: Date; last_outcome: string | null }[]
  >`select cl.lead_id, l.first_name, l.last_name, l.phone_e164, cl.state, cl.attempts, cl.next_eligible_at, cl.last_outcome
    from campaign_leads cl join leads l on l.id = cl.lead_id
    where cl.campaign_id = ${id} and ${cond}
    order by cl.attempts asc, cl.next_eligible_at asc, cl.lead_id limit ${pageSize} offset ${(page - 1) * pageSize}`;
  const [{ total }] = (await tx<{ total: number }[]>`select count(*)::int as total from campaign_leads cl where cl.campaign_id = ${id} and ${cond}`) as unknown as [{ total: number }];
  return { rows, total };
}
