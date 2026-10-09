"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { saveCampaign, setCampaignStatus } from "@cloudivoice/core/services/campaigns";
import { tenant } from "@/lib/session";

export interface CampaignState {
  error?: string;
}

export async function saveCampaignAction(_: CampaignState, form: FormData): Promise<CampaignState> {
  const id = String(form.get("id") ?? "") || undefined;
  const s = (k: string) => String(form.get(k) ?? "").trim();
  const retry: Record<string, { retry: boolean; delay_minutes: number }> = {};
  for (const o of ["no_answer", "busy", "voicemail", "failed", "callback_requested"]) {
    retry[o] = { retry: form.get(`retry_${o}`) === "on", delay_minutes: Number(form.get(`delay_${o}`) ?? 60) || 60 };
  }
  let campaignId: string;
  try {
    campaignId = await tenant(
      (tx, u) =>
        saveCampaign(
          tx,
          u.orgId,
          u.userId,
          {
            name: s("name"),
            agent_id: s("agent_id") || null,
            list_ids: form.getAll("list_ids").map(String),
            number_ids: form.getAll("number_ids").map(String),
            transfer_number: s("transfer_number"),
            intro_name: s("intro_name"),
            voicemail_message: s("voicemail_message"),
            max_concurrency: Number(s("max_concurrency")),
            calls_per_minute: Number(s("calls_per_minute")),
            max_attempts: Number(s("max_attempts")),
            window_start: s("window_start") || null,
            window_end: s("window_end") || null,
            retry_rules: retry,
          },
          id,
        ),
      "campaigns.edit",
    );
  } catch (e) {
    if (e instanceof ZodError) return { error: e.issues.map((i) => `${String(i.path[0])}: ${i.message}`).join("; ") };
    return { error: e instanceof Error ? e.message : "Could not save the campaign." };
  }
  revalidatePath("/app/campaigns");
  redirect(`/app/campaigns/${campaignId}`);
}

export async function campaignControlAction(form: FormData) {
  const id = String(form.get("id"));
  const op = String(form.get("op")) as "start" | "pause" | "resume" | "stop";
  let error: string | null = null;
  try {
    await tenant((tx, u) => setCampaignStatus(tx, u.orgId, u.userId, id, op), "campaigns.control");
  } catch (e) {
    error = e instanceof Error ? e.message : "Action failed";
  }
  revalidatePath(`/app/campaigns/${id}`);
  if (error) redirect(`/app/campaigns/${id}?error=${encodeURIComponent(error)}`);
}
