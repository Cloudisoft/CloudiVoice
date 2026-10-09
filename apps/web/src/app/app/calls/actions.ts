"use server";

import { revalidatePath } from "next/cache";
import type { Outcome } from "@cloudivoice/core/outcomes";
import { overrideOutcome } from "@cloudivoice/core/services/calls";
import { tenant } from "@/lib/session";

export async function overrideOutcomeAction(form: FormData) {
  const id = String(form.get("id"));
  await tenant((tx, u) => overrideOutcome(tx, u.orgId, u.userId, id, String(form.get("outcome")) as Outcome, String(form.get("note") ?? "")), "calls.override");
  revalidatePath(`/app/calls/${id}`);
}
