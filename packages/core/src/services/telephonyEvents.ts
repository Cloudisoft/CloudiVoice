/**
 * Processing for telephony webhooks. Every webhook is stored before it is
 * processed (see system.storeWebhook) and this function is idempotent, so
 * failed events can be replayed from the dashboard.
 */
import { db, withTenant } from "../db/client";
import type { EndReason } from "../outcomes";
import { telephony } from "../telephony";
import { addEvent, finalizeCall, transition } from "./calls";
import { getWebhook, markWebhook } from "./system";

export type TelephonyEventKind = "ring" | "answer" | "hangup" | "machine" | "recording" | "stream_status" | "transfer_result";

async function findCall(params: Record<string, string>, callIdHint?: string | null) {
  const providerId = params.CallUUID || params.RequestUUID || null;
  const rows = await db()<{ id: string; org_id: string; state: string; provider_call_id: string | null }[]>`
    select id, org_id, state, provider_call_id from calls
    where ${callIdHint && /^[0-9a-f-]{36}$/i.test(callIdHint) ? db()`id = ${callIdHint}` : db()`false`}
       or (${providerId}::text is not null and provider_call_id in (${params.CallUUID ?? ""}, ${params.RequestUUID ?? ""}))
    limit 1`;
  return rows[0] ?? null;
}

export async function processTelephonyEvent(kind: TelephonyEventKind, params: Record<string, string>, callIdHint?: string | null): Promise<void> {
  const call = await findCall(params, callIdHint);
  if (!call) return; // Unknown call (e.g. inbound before routing); nothing to do.
  const adapter = telephony();

  await withTenant(call.org_id, async (tx) => {
    // The request id becomes the call's permanent id once answered.
    if (params.CallUUID && call.provider_call_id !== params.CallUUID) {
      await tx`update calls set provider_call_id = ${params.CallUUID} where id = ${call.id}
               and not exists (select 1 from calls where provider_call_id = ${params.CallUUID})`;
    }
    switch (kind) {
      case "ring":
        await transition(tx, call.id, "ringing");
        break;
      case "answer":
        await transition(tx, call.id, "answered");
        break;
      case "machine": {
        const isMachine = /true|machine/i.test(params.Machine ?? params.MachineDetected ?? "");
        await addEvent(tx, call.org_id, call.id, "machine_detection", { machine: isMachine });
        if (isMachine) await transition(tx, call.id, "voicemail");
        break;
      }
      case "hangup": {
        const reason: EndReason = adapter ? adapter.endReasonFromWebhook(params) : "unknown";
        const duration = Number(params.Duration ?? params.BillDuration ?? "0") || 0;
        const [cur] = await tx<{ state: string; transfer_status: string | null }[]>`select state, transfer_status from calls where id = ${call.id}`;
        const finalReason: EndReason = cur?.state === "transferred" || cur?.transfer_status === "transferred" ? "transferred" : reason;
        const failed = ["invalid_number", "network_error"].includes(finalReason) && duration === 0;
        if (cur?.state === "transferred") await transition(tx, call.id, "completed", { endReason: finalReason, durationSec: duration });
        else await transition(tx, call.id, failed ? "failed" : "completed", { endReason: finalReason, durationSec: duration });
        // A hangup can arrive after the stream already closed the call; still fill gaps.
        await tx`update calls set end_reason = coalesce(end_reason, ${finalReason}), duration_sec = greatest(coalesce(duration_sec, 0), ${duration}) where id = ${call.id}`;
        const voicemail = (await tx`select 1 from call_events where call_id = ${call.id} and type = 'machine_detection' and (payload->>'machine')::boolean`).length > 0;
        await finalizeCall(tx, call.id, { voicemailDetected: voicemail });
        break;
      }
      case "recording": {
        const url = params.RecordUrl || params.record_url;
        if (url) {
          await tx`update calls set recording_status = 'pending', recording_key = null where id = ${call.id}`;
          await addEvent(tx, call.org_id, call.id, "recording_available", { source: "carrier" });
          await tx`insert into call_events (org_id, call_id, type, payload) values (${call.org_id}, ${call.id}, 'recording_source', ${tx.json({ url })})`;
        }
        break;
      }
      case "transfer_result": {
        const status = (params.DialStatus ?? params.DialBLegStatus ?? "").toLowerCase();
        const ok = status === "completed" || status === "answer" || status === "answered";
        await tx`update calls set transfer_status = ${ok ? "transferred" : status === "no-answer" || status === "noanswer" ? "no_answer" : "failed"} where id = ${call.id}`;
        if (ok) await transition(tx, call.id, "transferred");
        await addEvent(tx, call.org_id, call.id, "transfer_result", { status: ok ? "transferred" : status || "failed" });
        break;
      }
      case "stream_status":
        await addEvent(tx, call.org_id, call.id, "media_stream", { event: params.Event ?? "", reason: params.StatusReason ?? "" });
        break;
    }
  });
}

export async function replayWebhook(id: number) {
  const hook = await getWebhook(id);
  if (!hook) throw new Error("Webhook not found");
  const { params, callId } = hook.payload as { params: Record<string, string>; callId?: string | null };
  try {
    await processTelephonyEvent(hook.kind as TelephonyEventKind, params, callId);
    await markWebhook(id, null);
  } catch (e) {
    await markWebhook(id, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/**
 * Reconciliation: calls whose end event never arrived are asked about
 * directly so nothing stays "in progress" forever; calls stuck ringing past
 * the limit are closed and retried; finished-but-unfinalized calls are repaired.
 */
export async function reconcileCalls() {
  const adapter = telephony();
  const stuck = await db()<{ id: string; org_id: string; state: string; provider_call_id: string | null; created_at: Date }[]>`
    select id, org_id, state, provider_call_id, created_at from calls
    where (state in ('queued','ringing') and created_at < now() - interval '3 minutes')
       or (state in ('answered','in_progress','voicemail','transferring') and created_at < now() - interval '70 minutes')
    order by created_at limit 50`;
  let fixed = 0;
  for (const c of stuck) {
    try {
      const status = adapter && c.provider_call_id ? await adapter.getCallStatus(c.provider_call_id) : null;
      if (status && status.state !== "completed" && status.state !== "unknown") continue; // genuinely live
      await withTenant(c.org_id, async (tx) => {
        if (status?.state === "completed") {
          await transition(tx, c.id, "completed", { endReason: status.endReason ?? "unknown", durationSec: status.durationSec, answeredAt: status.answeredAt, endedAt: status.endedAt });
        } else {
          const neverRang = c.state === "queued" || c.state === "ringing";
          await transition(tx, c.id, "completed", { endReason: neverRang ? "dial_timeout" : "unknown" });
        }
        await addEvent(tx, c.org_id, c.id, "reconciled", { provider_state: status?.state ?? "none" });
        await finalizeCall(tx, c.id);
      });
      fixed++;
    } catch (e) {
      console.error(`[reconcile] ${c.id}:`, e instanceof Error ? e.message : e);
    }
  }
  // Repair: terminal calls that never got finalized (e.g. crash between steps).
  const unfinalized = await db()<{ id: string; org_id: string }[]>`
    select c.id, c.org_id from calls c
    where c.state in ('completed','failed') and c.ended_at < now() - interval '2 minutes'
      and not exists (select 1 from call_events e where e.call_id = c.id and e.type = 'finalized')
    limit 50`;
  for (const c of unfinalized) {
    await withTenant(c.org_id, (tx) => finalizeCall(tx, c.id));
    fixed++;
  }
  // Retry unprocessed webhooks (bounded attempts).
  const pending = await db()<{ id: number }[]>`
    select id from webhook_events where processed_at is null and attempts < 5 and received_at < now() - interval '30 seconds' order by id limit 50`;
  for (const w of pending) {
    try {
      await replayWebhook(w.id);
    } catch {
      /* recorded on the row */
    }
  }
  return { fixed, retriedWebhooks: pending.length };
}
