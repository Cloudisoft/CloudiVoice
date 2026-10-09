"use server";

import { revalidatePath } from "next/cache";
import { buyNumber, importCarrierNumbers, updateNumber } from "@cloudivoice/core/services/numbers";
import { requireTelephony, TelephonyError } from "@cloudivoice/core/telephony";
import { tenant } from "@/lib/session";

export interface NumState {
  ok?: string;
  error?: string;
  results?: { e164: string; region: string | null; numberType: string | null }[];
}

export async function importNumbersAction(_: NumState): Promise<NumState> {
  try {
    const r = await tenant((tx, u) => importCarrierNumbers(tx, u.orgId, u.userId), "numbers.manage");
    revalidatePath("/app/numbers");
    return { ok: r.added ? `Added ${r.added} number${r.added > 1 ? "s" : ""}.` : r.seen ? "All numbers on your connection are already listed." : "No numbers found on your telephony connection yet." };
  } catch (e) {
    return { error: e instanceof TelephonyError ? e.customerMessage : "Couldn’t reach the telephony connection." };
  }
}

export async function searchNumbersAction(_: NumState, form: FormData): Promise<NumState> {
  await tenant(async () => null, "numbers.manage");
  try {
    const pattern = String(form.get("pattern") ?? "").replace(/\D/g, "").slice(0, 8) || undefined;
    const type = String(form.get("type") ?? "") || undefined;
    const results = await requireTelephony().searchNumbers({ countryIso: "IN", pattern, type });
    return results.length ? { results: results.map((r) => ({ e164: r.e164, region: r.region, numberType: r.numberType })) } : { error: "No numbers available for that search. Try a different area code or type." };
  } catch (e) {
    return { error: e instanceof TelephonyError ? e.customerMessage : "Number search is unavailable right now." };
  }
}

export async function buyNumberAction(_: NumState, form: FormData): Promise<NumState> {
  const e164 = String(form.get("e164") ?? "");
  try {
    await tenant((tx, u) => buyNumber(tx, u.orgId, u.userId, e164), "numbers.manage");
    revalidatePath("/app/numbers");
    return { ok: `${e164} is now yours. Assign it to an agent below.` };
  } catch (e) {
    return {
      error:
        e instanceof TelephonyError
          ? `${e.customerMessage} Indian numbers may require business verification documents before purchase.`
          : "The number couldn’t be purchased.",
    };
  }
}

export async function updateNumberAction(form: FormData) {
  const id = String(form.get("id"));
  const agent = String(form.get("inbound_agent_id") ?? "");
  await tenant(
    (tx, u) =>
      updateNumber(tx, u.orgId, u.userId, id, {
        label: String(form.get("label") ?? ""),
        inbound_agent_id: agent || null,
        status: form.get("status") === "inactive" ? "inactive" : "active",
        voice_inbound: form.get("voice_inbound") === "on",
        voice_outbound: form.get("voice_outbound") === "on",
      }),
    "numbers.manage",
  );
  revalidatePath("/app/numbers");
}
