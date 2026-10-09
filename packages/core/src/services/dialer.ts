/**
 * Outbound dialling: test calls, campaigns and scheduled callbacks.
 * Rules baked in from production experience:
 *  - fresh leads first (fewest attempts, then earliest eligible time)
 *  - one worker per loop via a lease; rows locked with SKIP LOCKED
 *  - concurrency limits per campaign and per organization, plus pacing
 *  - calling hours in the lead's local time zone; DNC checked before every call
 *  - pausing stops new calls only; live calls finish
 */
import { db, withSystem, withTenant, type Tx } from "../db/client";
import { env } from "../env";
import { normalizePhone } from "../phone";
import { isWithinCallingWindow } from "../schedule";
import { requireTelephony, TelephonyError } from "../telephony";
import { addEvent, createCall, finalizeCall, transition } from "./calls";
import { isDnc } from "./leads";
import { pickCallerNumber } from "./numbers";
import { acquireLease } from "./system";

export class DialError extends Error {}

export async function liveCallCount(tx: Tx, campaignId?: string) {
  const [r] = await tx<{ n: number }[]>`
    select count(*)::int as n from calls
    where state in ('queued','ringing','answered','in_progress','transferring')
      and created_at > now() - interval '3 hours'
      ${campaignId ? tx`and campaign_id = ${campaignId}` : tx``}`;
  return r?.n ?? 0;
}

/**
 * Create the call record, then ask the telephony connection to dial.
 * The record is committed first so a crash never leaves an untracked call.
 */
export async function placeOutboundCall(
  orgId: string,
  input: { agentId: string; to: string; fromE164: string; leadId?: string | null; campaignId?: string | null; direction?: "outbound" | "test"; machineDetection?: boolean },
): Promise<string> {
  const to = normalizePhone(input.to);
  if (!to) throw new DialError("That phone number doesn't look valid.");
  const adapter = requireTelephony();

  const { callId, maxDuration } = await withTenant(orgId, async (tx) => {
    if (await isDnc(tx, to.e164)) throw new DialError("This number is on your do-not-call list.");
    const [agent] = await tx<{ current_version: number; status: string; max: number | null }[]>`
      select a.current_version, a.status, (v.config->>'max_duration_sec')::int as max
      from agents a join agent_versions v on v.agent_id = a.id and v.version = a.current_version where a.id = ${input.agentId}`;
    if (!agent) throw new DialError("Agent not found.");
    const [org] = await tx<{ max_concurrency: number }[]>`select max_concurrency from organizations`;
    if ((await liveCallCount(tx)) >= Math.min(org!.max_concurrency, env.orgMaxConcurrency * 10)) {
      throw new DialError("You're at your concurrent call limit. Try again when a call finishes.");
    }
    const id = await createCall(tx, {
      orgId,
      direction: input.direction ?? "outbound",
      agentId: input.agentId,
      agentVersion: agent.current_version,
      leadId: input.leadId,
      campaignId: input.campaignId,
      from: input.fromE164,
      to: to.e164,
    });
    return { callId: id, maxDuration: agent.max ?? 900 };
  });

  try {
    const placed = await adapter.placeCall({
      callId,
      from: input.fromE164,
      to: to.e164,
      ringTimeoutSec: 35,
      timeLimitSec: maxDuration + 60,
      machineDetection: input.machineDetection ?? input.direction !== "test",
    });
    await withTenant(orgId, async (tx) => {
      await tx`update calls set provider_call_id = coalesce(provider_call_id, ${placed.providerCallId}) where id = ${callId}`;
      await addEvent(tx, orgId, callId, "dial_requested", {});
    });
  } catch (e) {
    const message = e instanceof TelephonyError ? e.customerMessage : "The call could not be started.";
    console.error(`[dialer] call ${callId} failed to start:`, e instanceof TelephonyError ? e.technical : e);
    await withTenant(orgId, async (tx) => {
      await transition(tx, callId, "failed", { endReason: "network_error" });
      await addEvent(tx, orgId, callId, "dial_failed", { message });
      await finalizeCall(tx, callId);
    });
    throw new DialError(message);
  }
  return callId;
}

/** One pass of the campaign dialer. Safe to call every few seconds. */
export async function dialerTick(holder = env.workerId) {
  if (!(await acquireLease("dialer", holder, 30))) return { skipped: true, placed: 0 };
  const campaigns = await db()<{ id: string; org_id: string }[]>`select id, org_id from campaigns where status = 'running'`;
  let placed = 0;
  for (const c of campaigns) {
    try {
      placed += await dialCampaign(c.org_id, c.id);
    } catch (e) {
      console.error(`[dialer] campaign ${c.id}:`, e);
    }
  }
  placed += await dialDueCallbacks();
  return { skipped: false, placed };
}

async function dialCampaign(orgId: string, campaignId: string): Promise<number> {
  const plan = await withTenant(orgId, async (tx) => {
    const [c] = await tx<{
      agent_id: string | null;
      number_ids: string[];
      max_concurrency: number;
      calls_per_minute: number;
      window_start: string | null;
      window_end: string | null;
      status: string;
    }[]>`select agent_id, number_ids, max_concurrency, calls_per_minute, window_start, window_end, status from campaigns where id = ${campaignId}`;
    if (!c || c.status !== "running" || !c.agent_id) return null;
    const [org] = await tx<{ timezone: string; calling_window_start: string; calling_window_end: string; calling_days: number[]; max_concurrency: number }[]>`
      select timezone, calling_window_start, calling_window_end, calling_days, max_concurrency from organizations`;

    const live = await liveCallCount(tx, campaignId);
    const orgLive = await liveCallCount(tx);
    const [{ recent }] = (await tx<{ recent: number }[]>`
      select count(*)::int as recent from calls where campaign_id = ${campaignId} and created_at > now() - interval '60 seconds'`) as unknown as [{ recent: number }];
    const slots = Math.min(c.max_concurrency - live, org!.max_concurrency - orgLive, c.calls_per_minute - recent, 5);
    if (slots <= 0) return { leads: [], campaign: c };

    // Fresh leads dial first; SKIP LOCKED means two workers can never pick the same lead.
    const due = await tx<{ lead_id: string; phone_e164: string; state: string | null; timezone: string | null; dnc: boolean }[]>`
      select cl.lead_id, l.phone_e164, l.state, l.timezone, l.dnc
      from campaign_leads cl join leads l on l.id = cl.lead_id
      where cl.campaign_id = ${campaignId} and cl.state in ('pending','retry_wait') and cl.next_eligible_at <= now()
      order by cl.attempts asc, cl.next_eligible_at asc, cl.lead_id
      limit ${slots * 3}
      for update of cl skip locked`;

    const picked: { lead_id: string; phone_e164: string; from: string }[] = [];
    for (const lead of due) {
      if (picked.length >= slots) break;
      if (lead.dnc || (await isDnc(tx, lead.phone_e164))) {
        await tx`update campaign_leads set state = 'skipped', last_outcome = 'dnc', updated_at = now() where campaign_id = ${campaignId} and lead_id = ${lead.lead_id}`;
        continue;
      }
      const window = isWithinCallingWindow(new Date(), {
        timezone: lead.timezone || org!.timezone,
        start: c.window_start ?? org!.calling_window_start,
        end: c.window_end ?? org!.calling_window_end,
        days: org!.calling_days,
      });
      if (!window.open) {
        if (Number.isFinite(window.minutesUntilOpen)) {
          await tx`update campaign_leads set next_eligible_at = now() + ${`${window.minutesUntilOpen} minutes`}::interval
                   where campaign_id = ${campaignId} and lead_id = ${lead.lead_id}`;
        }
        continue;
      }
      const number = await pickCallerNumber(tx, c.number_ids, lead.state);
      if (!number) break;
      await tx`update campaign_leads set state = 'in_progress', attempts = attempts + 1, updated_at = now()
               where campaign_id = ${campaignId} and lead_id = ${lead.lead_id}`;
      picked.push({ lead_id: lead.lead_id, phone_e164: lead.phone_e164, from: number.e164 });
    }

    if (picked.length === 0 && live === 0) {
      const [{ open }] = (await tx<{ open: number }[]>`
        select count(*)::int as open from campaign_leads where campaign_id = ${campaignId} and state in ('pending','retry_wait','in_progress')`) as unknown as [{ open: number }];
      if (open === 0) await tx`update campaigns set status = 'completed', stopped_at = now() where id = ${campaignId} and status = 'running'`;
    }
    return { leads: picked, campaign: c };
  });
  if (!plan) return 0;

  let placed = 0;
  for (const lead of plan.leads) {
    try {
      const callId = await placeOutboundCall(orgId, {
        agentId: plan.campaign.agent_id!,
        to: lead.phone_e164,
        fromE164: lead.from,
        leadId: lead.lead_id,
        campaignId,
      });
      await withTenant(orgId, (tx) => tx`update campaign_leads set last_call_id = ${callId} where campaign_id = ${campaignId} and lead_id = ${lead.lead_id}`);
      placed++;
    } catch (e) {
      // finalizeCall already re-queued the lead per retry rules when a call row exists;
      // if we never got that far, put the lead back.
      await withTenant(orgId, (tx) =>
        tx`update campaign_leads set state = 'retry_wait', next_eligible_at = now() + interval '10 minutes', updated_at = now()
           where campaign_id = ${campaignId} and lead_id = ${lead.lead_id} and state = 'in_progress'`,
      );
      console.error(`[dialer] lead ${lead.lead_id}:`, e instanceof Error ? e.message : e);
    }
  }
  return placed;
}

async function dialDueCallbacks(): Promise<number> {
  const due = await withSystem((tx) =>
    tx<{ id: string; org_id: string; lead_id: string; campaign_id: string | null }[]>`
      update callbacks set status = 'dialing'
      where id in (select id from callbacks where status = 'scheduled' and scheduled_for <= now() order by scheduled_for limit 5 for update skip locked)
      returning id, org_id, lead_id, campaign_id`,
  );
  let placed = 0;
  for (const cb of due) {
    try {
      const target = await withTenant(cb.org_id, async (tx) => {
        const [lead] = await tx<{ phone_e164: string; state: string | null }[]>`select phone_e164, state from leads where id = ${cb.lead_id}`;
        const [cp] = cb.campaign_id
          ? await tx<{ agent_id: string | null; number_ids: string[] }[]>`select agent_id, number_ids from campaigns where id = ${cb.campaign_id}`
          : [];
        const agentId =
          cp?.agent_id ?? (await tx<{ id: string }[]>`select id from agents where status = 'active' order by updated_at desc limit 1`)[0]?.id;
        const numberIds = cp?.number_ids?.length ? cp.number_ids : (await tx<{ id: string }[]>`select id from phone_numbers where status = 'active'`).map((r) => r.id);
        const from = await pickCallerNumber(tx, numberIds, lead?.state ?? null);
        return lead && agentId && from ? { to: lead.phone_e164, agentId, from: from.e164 } : null;
      });
      if (!target) throw new Error("No agent or caller number available for callback");
      const callId = await placeOutboundCall(cb.org_id, { agentId: target.agentId, to: target.to, fromE164: target.from, leadId: cb.lead_id, campaignId: cb.campaign_id });
      await withTenant(cb.org_id, (tx) => tx`update callbacks set status = 'done', call_id = ${callId} where id = ${cb.id}`);
      placed++;
    } catch (e) {
      await withTenant(cb.org_id, (tx) => tx`update callbacks set status = 'failed' where id = ${cb.id}`);
      console.error(`[dialer] callback ${cb.id}:`, e instanceof Error ? e.message : e);
    }
  }
  return placed;
}
