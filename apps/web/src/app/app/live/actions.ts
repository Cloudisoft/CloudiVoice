"use server";

import { withTenant } from "@cloudivoice/core/db/client";
import { normalizePhone } from "@cloudivoice/core/phone";
import { audit } from "@cloudivoice/core/services/audit";
import { addEvent, transition } from "@cloudivoice/core/services/calls";
import { telephony, TelephonyError } from "@cloudivoice/core/telephony";
import { requirePermission } from "@/lib/session";

/** Supervisor controls: end or transfer a live call. */
export async function superviseAction(form: FormData): Promise<{ message: string }> {
  const user = await requirePermission("calls.supervise");
  const id = String(form.get("id"));
  const op = String(form.get("op"));
  const adapter = telephony();
  const call = await withTenant(user.orgId, async (tx) => {
    const [c] = await tx<{ provider_call_id: string | null; from_e164: string | null; to_e164: string | null; direction: string }[]>`
      select provider_call_id, from_e164, to_e164, direction from calls where id = ${id}`;
    return c ?? null;
  });
  if (!call) return { message: "Call not found." };
  if (!call.provider_call_id || !adapter) return { message: "This call isn’t on the phone network (browser test) — end it from the browser." };
  try {
    if (op === "end") {
      await adapter.hangup(call.provider_call_id);
      await withTenant(user.orgId, async (tx) => {
        await addEvent(tx, user.orgId, id, "supervisor_ended", { by: user.userId });
        await audit(tx, user.orgId, user.userId, "call.ended_by_supervisor", { type: "call", id });
      });
      return { message: "Ending the call…" };
    }
    if (op === "transfer") {
      const to = normalizePhone(String(form.get("to") ?? ""));
      if (!to) return { message: "Enter a valid number to transfer to." };
      const callerId = (call.direction === "inbound" ? call.to_e164 : call.from_e164) ?? "";
      const moved = await withTenant(user.orgId, async (tx) => {
        const ok = await transition(tx, id, "transferring");
        if (!ok) return false;
        await tx`update calls set transfer_status = 'requested', transfer_to = ${to.e164}, transfer_caller_id = ${callerId || null} where id = ${id}`;
        await addEvent(tx, user.orgId, id, "supervisor_transfer", { to: to.e164, by: user.userId });
        await audit(tx, user.orgId, user.userId, "call.transferred_by_supervisor", { type: "call", id });
        return true;
      });
      if (!moved) return { message: "This call can’t be transferred right now (it may have just ended or already be transferring)." };
      // Ends the agent's stream; the call then dials the number with a ringback for the caller.
      try {
        await adapter.transfer(call.provider_call_id, id);
      } catch (e) {
        await withTenant(user.orgId, async (tx) => {
          await tx`update calls set transfer_status = 'failed', transfer_to = null where id = ${id}`;
          await transition(tx, id, "in_progress");
        });
        if (e instanceof TelephonyError && e.status === 404) return { message: "This call has already ended." };
        throw e;
      }
      return { message: `Transferring to ${to.e164}… the caller hears ringing until they pick up.` };
    }
  } catch (e) {
    return { message: e instanceof TelephonyError ? e.customerMessage : "The action couldn’t be completed." };
  }
  return { message: "Unknown action." };
}
