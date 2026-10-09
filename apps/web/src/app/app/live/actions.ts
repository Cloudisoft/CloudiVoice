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
      await withTenant(user.orgId, async (tx) => {
        await transition(tx, id, "transferring");
        await tx`update calls set transfer_status = 'requested' where id = ${id}`;
        await addEvent(tx, user.orgId, id, "supervisor_transfer", { to: to.e164, by: user.userId });
        await audit(tx, user.orgId, user.userId, "call.transferred_by_supervisor", { type: "call", id });
      });
      await adapter.transfer(call.provider_call_id, to.e164, callerId, id);
      return { message: `Transferring to ${to.e164}…` };
    }
  } catch (e) {
    return { message: e instanceof TelephonyError ? e.customerMessage : "The action couldn’t be completed." };
  }
  return { message: "Unknown action." };
}
