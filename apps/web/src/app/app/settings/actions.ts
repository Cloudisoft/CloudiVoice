"use server";

import { revalidatePath } from "next/cache";
import { env } from "@cloudivoice/core/env";
import { createInvitation, ROLES, type Role, signOutEverywhere } from "@cloudivoice/core/services/auth";
import { audit } from "@cloudivoice/core/services/audit";
import { changeRole, removeMember, setConnectionHealth, updateOrgSettings } from "@cloudivoice/core/services/org";
import { replayWebhook } from "@cloudivoice/core/services/telephonyEvents";
import { checkSpeechHealth } from "@cloudivoice/core/speech";
import { telephony, TelephonyError } from "@cloudivoice/core/telephony";
import { withTenant } from "@cloudivoice/core/db/client";
import { sendMail } from "@/lib/mail";
import { clearSessionCookie, requireOrgUser, requirePermission, tenant } from "@/lib/session";
import { isPlatformAdmin } from "@/lib/platform";
import { redirect } from "next/navigation";

export interface SettingsState {
  ok?: string;
  error?: string;
  devLink?: string;
}

export async function updateOrgAction(_: SettingsState, form: FormData): Promise<SettingsState> {
  const s = (k: string) => String(form.get(k) ?? "").trim();
  try {
    await tenant(
      (tx, u) =>
        updateOrgSettings(tx, u.orgId, u.userId, {
          name: s("name"),
          industry: s("industry") || null,
          website: s("website") || null,
          timezone: s("timezone"),
          default_language: s("default_language"),
          calling_window_start: s("calling_window_start"),
          calling_window_end: s("calling_window_end"),
          calling_days: form.getAll("calling_days").map(Number),
          record_calls: form.get("record_calls") === "on",
          recording_disclosure: s("recording_disclosure"),
          retention_days: Number(s("retention_days")),
          max_concurrency: Number(s("max_concurrency")),
          monthly_spend_limit_rupees: s("monthly_spend_limit") ? Number(s("monthly_spend_limit")) : null,
        }),
      "settings.manage",
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message.replace(/^\[.*?\]\s*/s, "") || "Could not save settings." : "Could not save settings." };
  }
  revalidatePath("/app/settings");
  return { ok: "Settings saved." };
}

export async function inviteAction(_: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requirePermission("team.manage");
  const email = String(form.get("email") ?? "");
  const role = String(form.get("role") ?? "viewer") as Role;
  if (!ROLES.includes(role)) return { error: "Choose a role." };
  try {
    const token = await createInvitation(user.orgId, user.userId, email, role);
    const link = `${env.appUrl}/invite/${token}`;
    const r = await sendMail(email, `${user.name} invited you to ${user.orgName} on CloudiVoice`, `${user.name} has invited you to join ${user.orgName} as ${role}. This link expires in 7 days.`, link);
    revalidatePath("/app/settings/team");
    return { ok: r.sent ? `Invitation sent to ${email}.` : `Invitation created for ${email}.`, devLink: r.devLink };
  } catch (e) {
    return { error: e instanceof Error && e.name !== "ZodError" ? e.message : "Enter a valid email address." };
  }
}

export async function changeRoleAction(form: FormData) {
  await tenant((tx, u) => changeRole(tx, u.orgId, u.userId, String(form.get("user_id")), String(form.get("role"))), "team.manage");
  revalidatePath("/app/settings/team");
}

export async function removeMemberAction(form: FormData) {
  await tenant((tx, u) => removeMember(tx, u.orgId, u.userId, String(form.get("user_id"))), "team.manage");
  revalidatePath("/app/settings/team");
}

export async function revokeInviteAction(form: FormData) {
  await tenant(async (tx, u) => {
    await tx`delete from invitations where id = ${String(form.get("id"))}`;
    await audit(tx, u.orgId, u.userId, "team.invite_revoked", { type: "invitation", id: String(form.get("id")) });
  }, "team.manage");
  revalidatePath("/app/settings/team");
}

export async function checkConnectionsAction(_: SettingsState): Promise<SettingsState> {
  const user = await requirePermission("integrations.manage");
  const results: string[] = [];
  const adapter = telephony();
  let telOk = false;
  let telErr: string | undefined;
  if (adapter) {
    try {
      await adapter.listNumbers();
      telOk = true;
    } catch (e) {
      telErr = e instanceof TelephonyError ? e.customerMessage : "Unreachable";
    }
  } else telErr = "Not configured";
  results.push(`Telephony: ${telOk ? "healthy" : telErr}`);
  const speech = env.speechApiKey ? await checkSpeechHealth() : { ok: false, error: "Not configured" };
  results.push(`Speech: ${speech.ok ? "healthy" : speech.error}`);
  await withTenant(user.orgId, async (tx) => {
    for (const [kind, ok, err] of [["telephony", telOk, telErr], ["speech", speech.ok, speech.error]] as const) {
      await tx`insert into provider_connections (org_id, kind, provider_key, display_name, status, last_checked_at, last_error)
               values (${user.orgId}, ${kind}, 'platform', ${kind === "telephony" ? "Telephony connection" : "Speech engine"}, ${ok ? "healthy" : "failed"}, now(), ${err ?? null})
               on conflict (org_id, kind) do update set status = excluded.status, last_checked_at = now(), last_error = excluded.last_error`;
    }
    await setConnectionHealth(tx, "reasoning", Boolean(env.anthropicApiKey), env.anthropicApiKey ? undefined : "Not configured");
  });
  revalidatePath("/app/settings/connections");
  return { ok: results.join(" · ") };
}

export async function replayWebhookAction(form: FormData) {
  const user = await requireOrgUser();
  if (!isPlatformAdmin(user.email)) return;
  try {
    await replayWebhook(Number(form.get("id")));
  } catch {
    /* error recorded on the row */
  }
  revalidatePath("/app/settings/health");
}

export async function signOutEverywhereAction() {
  const user = await requireOrgUser();
  await signOutEverywhere(user.userId);
  await clearSessionCookie();
  redirect("/login");
}
