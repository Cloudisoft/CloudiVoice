"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@cloudivoice/core/services/audit";
import { resetLeadsForRedial } from "@cloudivoice/core/services/leads";
import { tenant } from "@/lib/session";

export interface ResetState {
  ok?: string;
  error?: string;
}

export async function createListAction(form: FormData) {
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  if (!name) return;
  await tenant(async (tx, u) => {
    const [l] = await tx<{ id: string }[]>`insert into lead_lists (org_id, name) values (${u.orgId}, ${name}) returning id`;
    await audit(tx, u.orgId, u.userId, "list.created", { type: "lead_list", id: l!.id });
  }, "leads.edit");
  revalidatePath("/app/lists");
}

export async function deleteListAction(form: FormData) {
  const id = String(form.get("id"));
  await tenant(async (tx, u) => {
    await tx`delete from lead_lists where id = ${id}`;
    await audit(tx, u.orgId, u.userId, "list.deleted", { type: "lead_list", id });
  }, "leads.delete");
  revalidatePath("/app/lists");
}

export async function resetListAction(_: ResetState, form: FormData): Promise<ResetState> {
  const listId = String(form.get("list_id"));
  const scope = String(form.get("scope") ?? "all");
  const outcomes = scope === "all" ? undefined : form.getAll("outcomes").map(String);
  if (scope !== "all" && !outcomes?.length) return { error: "Pick at least one outcome to reset." };
  const n = await tenant((tx, u) => resetLeadsForRedial(tx, u.orgId, u.userId, { listId, outcomes }), "campaigns.control");
  revalidatePath("/app/lists");
  return { ok: n ? `${n.toLocaleString("en-IN")} leads are back in line to be called.` : "No leads matched — permanent outcomes are never reset." };
}

export async function removeDncAction(form: FormData) {
  const phone = String(form.get("phone"));
  await tenant(async (tx, u) => {
    await tx`delete from dnc_entries where phone_e164 = ${phone}`;
    await tx`update leads set dnc = false where phone_e164 = ${phone}`;
    await audit(tx, u.orgId, u.userId, "dnc.removed", { type: "dnc", id: phone });
  }, "settings.manage");
  revalidatePath("/app/lists");
}
