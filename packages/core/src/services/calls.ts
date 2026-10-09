import { type CallState, canTransition, isCallState, LIVE_STATES, TERMINAL_STATES } from "../callState";
import type { Tx } from "../db/client";
import { deriveOutcome, type EndReason, type Outcome, OUTCOMES, retryDecision, type RetryRules } from "../outcomes";
import { callCostLines } from "../pricing";
import { audit } from "./audit";

export interface CallRow {
  id: string;
  org_id: string;
  campaign_id: string | null;
  agent_id: string | null;
  agent_version: number | null;
  lead_id: string | null;
  direction: "outbound" | "inbound" | "test";
  from_e164: string | null;
  to_e164: string | null;
  state: CallState;
  provider_call_id: string | null;
  outcome: Outcome | null;
  outcome_confidence: number | null;
  outcome_reason: string | null;
  outcome_overridden: boolean;
  end_reason: EndReason | null;
  transfer_status: string | null;
  summary: string | null;
  qa: { score: number; notes: string } | null;
  recording_key: string | null;
  recording_status: string | null;
  duration_sec: number | null;
  cost_paise: string;
  created_at: Date;
  ringing_at: Date | null;
  answered_at: Date | null;
  ended_at: Date | null;
}

export async function createCall(
  tx: Tx,
  input: {
    orgId: string;
    direction: "outbound" | "inbound" | "test";
    agentId: string | null;
    agentVersion: number | null;
    leadId?: string | null;
    campaignId?: string | null;
    from: string | null;
    to: string | null;
    providerCallId?: string | null;
    state?: CallState;
  },
) {
  const [row] = await tx<{ id: string }[]>`
    insert into calls (org_id, direction, agent_id, agent_version, lead_id, campaign_id, from_e164, to_e164, provider_call_id, state)
    values (${input.orgId}, ${input.direction}, ${input.agentId}, ${input.agentVersion}, ${input.leadId ?? null}, ${input.campaignId ?? null},
            ${input.from}, ${input.to}, ${input.providerCallId ?? null}, ${input.state ?? "queued"})
    returning id`;
  await addEvent(tx, input.orgId, row!.id, "created", { direction: input.direction });
  return row!.id;
}

export async function addEvent(tx: Tx, orgId: string, callId: string, type: string, payload: Record<string, unknown> = {}) {
  await tx`insert into call_events (org_id, call_id, type, payload) values (${orgId}, ${callId}, ${type}, ${tx.json(payload as never)})`;
}

/**
 * Move a call to a new state if the transition is legal. Returns false for
 * late/duplicate/backwards events instead of corrupting the record.
 */
export async function transition(
  tx: Tx,
  callId: string,
  to: CallState,
  extra: { endReason?: EndReason | null; durationSec?: number | null; answeredAt?: Date | null; endedAt?: Date | null } = {},
): Promise<boolean> {
  const [call] = await tx<{ state: string; org_id: string }[]>`select state, org_id from calls where id = ${callId} for update`;
  if (!call || !isCallState(call.state)) return false;
  if (!canTransition(call.state, to)) {
    await addEvent(tx, call.org_id, callId, "transition_rejected", { from: call.state, to });
    return false;
  }
  await tx`
    update calls set
      state = ${to},
      ringing_at = case when ${to} = 'ringing' then coalesce(ringing_at, now()) else ringing_at end,
      answered_at = case when ${to} in ('answered','in_progress') then coalesce(answered_at, ${extra.answeredAt ?? null}::timestamptz, now()) else coalesce(answered_at, ${extra.answeredAt ?? null}::timestamptz) end,
      ended_at = case when ${to} in ('completed','failed') then coalesce(ended_at, ${extra.endedAt ?? null}::timestamptz, now()) else ended_at end,
      end_reason = coalesce(${extra.endReason ?? null}, end_reason),
      duration_sec = coalesce(${extra.durationSec ?? null}, duration_sec)
    where id = ${callId}`;
  await addEvent(tx, call.org_id, callId, "state", { from: call.state, to, ...(extra.endReason ? { end_reason: extra.endReason } : {}) });
  return true;
}

export async function addTranscriptLine(tx: Tx, orgId: string, callId: string, speaker: "agent" | "caller" | "system", text: string, atMs: number, language?: string | null) {
  if (!text.trim()) return;
  await tx`insert into transcript_lines (org_id, call_id, speaker, text, at_ms, language)
           values (${orgId}, ${callId}, ${speaker}, ${text.slice(0, 4000)}, ${Math.max(0, Math.round(atMs))}, ${language ?? null})`;
}

/**
 * Close out a call: derive the outcome (unless a supervisor overrode it),
 * record usage, update the lead and decide on retries. Idempotent — safe to
 * run again from the reconciliation job.
 */
export async function finalizeCall(tx: Tx, callId: string, signals: { voicemailDetected?: boolean } = {}) {
  const [call] = await tx<CallRow[]>`select * from calls where id = ${callId} for update`;
  if (!call || !TERMINAL_STATES.includes(call.state)) return null;
  const finalized = await tx`select 1 from call_events where call_id = ${callId} and type = 'finalized' limit 1`;
  if (finalized.length) return call;

  const lines = await tx<{ speaker: string; text: string }[]>`select speaker, text from transcript_lines where call_id = ${callId} order by id`;
  const tools = (await tx<{ name: string }[]>`select payload->>'name' as name from call_events where call_id = ${callId} and type = 'tool' and coalesce((payload->>'is_error')::boolean, false) = false`).map(
    (t) => t.name,
  );
  const duration = call.duration_sec ?? (call.answered_at && call.ended_at ? Math.round((+call.ended_at - +call.answered_at) / 1000) : 0);

  let outcome = call.outcome;
  if (!call.outcome_overridden) {
    const derived = deriveOutcome({
      endReason: (call.end_reason ?? "unknown") as EndReason,
      answered: Boolean(call.answered_at),
      durationSec: duration,
      callerLines: lines.filter((l) => l.speaker === "caller").map((l) => l.text),
      tools,
      voicemailDetected: signals.voicemailDetected,
      transferStatus: call.transfer_status === "transferred" ? "transferred" : null,
    });
    outcome = derived.outcome;
    await tx`update calls set outcome = ${derived.outcome}, outcome_confidence = ${derived.confidence}, outcome_reason = ${derived.reason}, duration_sec = ${duration}
             where id = ${callId}`;
  }

  // Usage (only for connected time; demo/test calls included so customers see real cost)
  if (duration > 0) {
    const lines = callCostLines(duration).filter((l) => l.amount > 0);
    for (const l of lines) {
      await tx`insert into usage_ledger (org_id, call_id, category, quantity, unit, amount_paise, description)
               values (${call.org_id}, ${callId}, ${l.category}, ${l.quantity}, ${l.unit}, ${l.amount}, 'Call usage')`;
    }
    const total = lines.reduce((n, l) => n + l.amount, 0);
    await tx`update calls set cost_paise = ${total} where id = ${callId}`;
  }

  if (call.lead_id && outcome) {
    await tx`update leads set last_outcome = ${outcome}, attempts = attempts + 1, status = 'contacted', updated_at = now() where id = ${call.lead_id}`;
  }

  if (call.campaign_id && call.lead_id && outcome) {
    const [cp] = await tx<{ max_attempts: number; retry_rules: RetryRules }[]>`select max_attempts, retry_rules from campaigns where id = ${call.campaign_id}`;
    const [cl] = await tx<{ attempts: number }[]>`select attempts from campaign_leads where campaign_id = ${call.campaign_id} and lead_id = ${call.lead_id}`;
    if (cp && cl) {
      const decision = retryDecision(outcome, cl.attempts, cp.max_attempts, cp.retry_rules);
      if (decision.retry) {
        await tx`update campaign_leads set state = 'retry_wait', next_eligible_at = ${decision.at}, last_outcome = ${outcome}, last_call_id = ${callId}, updated_at = now()
                 where campaign_id = ${call.campaign_id} and lead_id = ${call.lead_id}`;
      } else {
        const exhausted = cl.attempts >= cp.max_attempts && !["appointment_booked", "qualified", "interested", "transferred", "answered", "callback_requested"].includes(outcome);
        await tx`update campaign_leads set state = ${exhausted ? "exhausted" : "completed"}, last_outcome = ${outcome}, last_call_id = ${callId}, updated_at = now()
                 where campaign_id = ${call.campaign_id} and lead_id = ${call.lead_id}`;
      }
    }
  }
  await addEvent(tx, call.org_id, callId, "finalized", { outcome });
  return call;
}

export async function overrideOutcome(tx: Tx, orgId: string, userId: string, callId: string, outcome: Outcome, note: string) {
  if (!(outcome in OUTCOMES)) throw new Error("Unknown outcome");
  await tx`update calls set outcome = ${outcome}, outcome_overridden = true, outcome_confidence = 1,
           outcome_reason = ${note.trim() ? `Set by supervisor: ${note.trim().slice(0, 200)}` : "Set by supervisor"} where id = ${callId}`;
  const [c] = await tx<{ lead_id: string | null }[]>`select lead_id from calls where id = ${callId}`;
  if (c?.lead_id) await tx`update leads set last_outcome = ${outcome}, updated_at = now() where id = ${c.lead_id}`;
  await addEvent(tx, orgId, callId, "outcome_override", { outcome, by: userId });
  await audit(tx, orgId, userId, "call.outcome_overridden", { type: "call", id: callId }, { outcome });
}

export interface CallFilter {
  q?: string;
  campaignId?: string;
  agentId?: string;
  outcome?: string;
  direction?: string;
  from?: string;
  to?: string;
  minDuration?: number;
  numberE164?: string;
}

function whereCalls(tx: Tx, f: CallFilter) {
  const conds = [tx`true`];
  if (f.q?.trim()) {
    const d = f.q.replace(/\D/g, "");
    const like = `%${f.q.trim().toLowerCase().replace(/[%_]/g, "")}%`;
    conds.push(
      d.length >= 4
        ? tx`(c.to_e164 like ${`%${d.slice(-10)}%`} or c.from_e164 like ${`%${d.slice(-10)}%`})`
        : tx`(lower(coalesce(l.first_name,'') || ' ' || coalesce(l.last_name,'')) like ${like} or lower(coalesce(c.summary,'')) like ${like})`,
    );
  }
  if (f.campaignId) conds.push(tx`c.campaign_id = ${f.campaignId}`);
  if (f.agentId) conds.push(tx`c.agent_id = ${f.agentId}`);
  if (f.outcome) conds.push(tx`c.outcome = ${f.outcome}`);
  if (f.direction) conds.push(tx`c.direction = ${f.direction}`);
  if (f.from) conds.push(tx`c.created_at >= ${f.from}::date`);
  if (f.to) conds.push(tx`c.created_at < ${f.to}::date + 1`);
  if (f.minDuration) conds.push(tx`coalesce(c.duration_sec,0) >= ${f.minDuration}`);
  if (f.numberE164) conds.push(tx`(c.from_e164 = ${f.numberE164} or c.to_e164 = ${f.numberE164})`);
  return conds.reduce((a, c) => tx`${a} and ${c}`);
}

export async function listCalls(tx: Tx, f: CallFilter, page = 1, pageSize = 50) {
  const where = whereCalls(tx, f);
  const rows = await tx<
    (Pick<CallRow, "id" | "direction" | "from_e164" | "to_e164" | "state" | "outcome" | "outcome_reason" | "end_reason" | "duration_sec" | "created_at" | "cost_paise"> & {
      lead_name: string | null;
      campaign_name: string | null;
      agent_name: string | null;
    })[]
  >`select c.id, c.direction, c.from_e164, c.to_e164, c.state, c.outcome, c.outcome_reason, c.end_reason, c.duration_sec, c.created_at, c.cost_paise,
       nullif(trim(coalesce(l.first_name,'') || ' ' || coalesce(l.last_name,'')), '') as lead_name,
       cp.name as campaign_name, a.name as agent_name
    from calls c
    left join leads l on l.id = c.lead_id
    left join campaigns cp on cp.id = c.campaign_id
    left join agents a on a.id = c.agent_id
    where ${where}
    order by c.created_at desc limit ${pageSize} offset ${(Math.max(1, page) - 1) * pageSize}`;
  const [{ total }] = (await tx<{ total: number }[]>`select count(*)::int as total from calls c left join leads l on l.id = c.lead_id where ${where}`) as unknown as [{ total: number }];
  return { rows, total, page, pageSize };
}

export async function exportCalls(tx: Tx, f: CallFilter) {
  return tx`select c.created_at, c.direction, c.from_e164 as "from", c.to_e164 as "to",
       nullif(trim(coalesce(l.first_name,'') || ' ' || coalesce(l.last_name,'')), '') as lead,
       cp.name as campaign, a.name as agent, c.state, c.outcome, c.outcome_reason, c.end_reason, c.duration_sec, c.cost_paise / 100.0 as cost_inr, c.summary
    from calls c left join leads l on l.id = c.lead_id left join campaigns cp on cp.id = c.campaign_id left join agents a on a.id = c.agent_id
    where ${whereCalls(tx, f)} order by c.created_at desc limit 100000`;
}

export async function getCallDetail(tx: Tx, id: string) {
  const [call] = await tx<(CallRow & { lead_name: string | null; campaign_name: string | null; agent_name: string | null })[]>`
    select c.*, nullif(trim(coalesce(l.first_name,'') || ' ' || coalesce(l.last_name,'')), '') as lead_name,
           cp.name as campaign_name, a.name as agent_name
    from calls c left join leads l on l.id = c.lead_id left join campaigns cp on cp.id = c.campaign_id left join agents a on a.id = c.agent_id
    where c.id = ${id}`;
  if (!call) return null;
  const transcript = await tx<{ id: number; speaker: string; text: string; at_ms: number; language: string | null }[]>`
    select id, speaker, text, at_ms, language from transcript_lines where call_id = ${id} order by id`;
  const events = await tx<{ id: number; type: string; payload: Record<string, unknown>; created_at: Date }[]>`
    select id, type, payload, created_at from call_events where call_id = ${id} order by id`;
  return { call, transcript, events };
}

export async function liveCalls(tx: Tx) {
  return tx<
    (Pick<CallRow, "id" | "direction" | "from_e164" | "to_e164" | "state" | "created_at" | "answered_at"> & { lead_name: string | null; agent_name: string | null; campaign_name: string | null; last_line: string | null })[]
  >`select c.id, c.direction, c.from_e164, c.to_e164, c.state, c.created_at, c.answered_at,
       nullif(trim(coalesce(l.first_name,'') || ' ' || coalesce(l.last_name,'')), '') as lead_name,
       a.name as agent_name, cp.name as campaign_name,
       (select t.text from transcript_lines t where t.call_id = c.id order by t.id desc limit 1) as last_line
    from calls c left join leads l on l.id = c.lead_id left join agents a on a.id = c.agent_id left join campaigns cp on cp.id = c.campaign_id
    where c.state in ${tx([...LIVE_STATES])} and c.created_at > now() - interval '6 hours'
    order by c.created_at desc limit 200`;
}

export async function transcriptSince(tx: Tx, callId: string, afterId: number) {
  return tx<{ id: number; speaker: string; text: string; at_ms: number }[]>`
    select id, speaker, text, at_ms from transcript_lines where call_id = ${callId} and id > ${afterId} order by id limit 200`;
}
