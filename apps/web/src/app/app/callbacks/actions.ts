"use server";

import { revalidatePath } from "next/cache";
import { cancelCallback, rescheduleCallback, scheduleCallback } from "@cloudivoice/core/services/callbacks";
import { audit } from "@cloudivoice/core/services/audit";
import { tenant } from "@/lib/session";

function parseLocal(value: string, tz: string): Date {
  // datetime-local gives "YYYY-MM-DDTHH:mm" in the organization's time zone.
  const asUtc = new Date(`${value}:00Z`);
  const offset = new Date(asUtc.toLocaleString("en-US", { timeZone: tz })).getTime() - new Date(asUtc.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(asUtc.getTime() - offset);
}

export async function cancelCallbackAction(form: FormData) {
  await tenant((tx, u) => cancelCallback(tx, u.orgId, u.userId, String(form.get("id"))), "campaigns.control");
  revalidatePath("/app/callbacks");
}

export async function rescheduleCallbackAction(form: FormData) {
  await tenant(async (tx, u) => {
    const [org] = await tx<{ timezone: string }[]>`select timezone from organizations`;
    await rescheduleCallback(tx, u.orgId, u.userId, String(form.get("id")), parseLocal(String(form.get("when")), org!.timezone));
  }, "campaigns.control");
  revalidatePath("/app/callbacks");
}

export async function newCallbackAction(form: FormData) {
  await tenant(async (tx, u) => {
    const [org] = await tx<{ timezone: string }[]>`select timezone from organizations`;
    const leadId = String(form.get("lead_id"));
    const id = await scheduleCallback(tx, { orgId: u.orgId, leadId, when: parseLocal(String(form.get("when")), org!.timezone), reason: String(form.get("reason") ?? ""), createdBy: u.userId });
    await audit(tx, u.orgId, u.userId, "callback.scheduled", { type: "callback", id });
  }, "campaigns.control");
  revalidatePath("/app/callbacks");
}
