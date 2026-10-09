import { z } from "zod";
import { decryptSecret, encryptSecret, maskSecret } from "../crypto";
import type { Tx } from "../db/client";
import { audit } from "./audit";

export interface OrgRow {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  team_size: string | null;
  timezone: string;
  default_language: string;
  calling_window_start: string;
  calling_window_end: string;
  calling_days: number[];
  record_calls: boolean;
  recording_disclosure: string;
  retention_days: number;
  max_concurrency: number;
  monthly_spend_limit_paise: string | null;
  onboarding_step: string;
  onboarding_completed_at: Date | null;
  created_at: Date;
}

export async function getOrg(tx: Tx) {
  const [org] = await tx<OrgRow[]>`select * from organizations`;
  return org!;
}

export const orgSettingsSchema = z.object({
  name: z.string().trim().min(2).max(80),
  industry: z.string().trim().max(60).nullable().optional(),
  website: z.string().trim().max(200).nullable().optional(),
  team_size: z.string().trim().max(20).nullable().optional(),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone"),
  default_language: z.string().max(10),
  calling_window_start: z.string().regex(/^\d{2}:\d{2}$/),
  calling_window_end: z.string().regex(/^\d{2}:\d{2}$/),
  calling_days: z.array(z.coerce.number().int().min(1).max(7)).min(1),
  record_calls: z.boolean(),
  recording_disclosure: z.string().trim().max(300),
  retention_days: z.coerce.number().int().min(1).max(3650),
  max_concurrency: z.coerce.number().int().min(1).max(500),
  monthly_spend_limit_rupees: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
});

export async function updateOrgSettings(tx: Tx, orgId: string, userId: string, input: Partial<z.infer<typeof orgSettingsSchema>>) {
  const current = await getOrg(tx);
  const merged = orgSettingsSchema.parse({
    ...current,
    calling_window_start: current.calling_window_start.slice(0, 5),
    calling_window_end: current.calling_window_end.slice(0, 5),
    monthly_spend_limit_rupees: current.monthly_spend_limit_paise ? Number(current.monthly_spend_limit_paise) / 100 : null,
    ...input,
  });
  if (merged.calling_window_end <= merged.calling_window_start) throw new Error("Calling hours must end after they start.");
  await tx`update organizations set name = ${merged.name}, industry = ${merged.industry ?? null}, website = ${merged.website ?? null},
           team_size = ${merged.team_size ?? null}, timezone = ${merged.timezone}, default_language = ${merged.default_language},
           calling_window_start = ${merged.calling_window_start}, calling_window_end = ${merged.calling_window_end},
           calling_days = ${merged.calling_days}::int[], record_calls = ${merged.record_calls},
           recording_disclosure = ${merged.recording_disclosure}, retention_days = ${merged.retention_days},
           max_concurrency = ${merged.max_concurrency},
           monthly_spend_limit_paise = ${merged.monthly_spend_limit_rupees != null ? Math.round(merged.monthly_spend_limit_rupees * 100) : null}
           where id = ${orgId}`;
  await audit(tx, orgId, userId, "settings.updated", { type: "organization", id: orgId }, input as Record<string, unknown>);
}

export async function setOnboardingStep(tx: Tx, orgId: string, step: string, completed = false) {
  await tx`update organizations set onboarding_step = ${step},
           onboarding_completed_at = case when ${completed} then coalesce(onboarding_completed_at, now()) else onboarding_completed_at end
           where id = ${orgId}`;
}

export async function listMembers(tx: Tx) {
  return tx<{ user_id: string; name: string; email: string; role: string; created_at: Date; last_login_at: Date | null }[]>`
    select m.user_id, u.name, u.email, m.role, m.created_at, u.last_login_at
    from memberships m join users u on u.id = m.user_id order by m.created_at`;
}

export async function listPendingInvites(tx: Tx) {
  return tx<{ id: string; email: string; role: string; created_at: Date; expires_at: Date }[]>`
    select id, email, role, created_at, expires_at from invitations where accepted_at is null and expires_at > now() order by created_at desc`;
}

export async function changeRole(tx: Tx, orgId: string, actorId: string, userId: string, role: string) {
  if (!["admin", "manager", "operator", "viewer"].includes(role)) throw new Error("Unknown role");
  if (role !== "admin") {
    const [{ n }] = (await tx<{ n: number }[]>`select count(*)::int as n from memberships where role = 'admin' and user_id <> ${userId}`) as unknown as [{ n: number }];
    if (n === 0) throw new Error("An organization needs at least one admin.");
  }
  await tx`update memberships set role = ${role} where user_id = ${userId}`;
  await audit(tx, orgId, actorId, "team.role_changed", { type: "user", id: userId }, { role });
}

export async function removeMember(tx: Tx, orgId: string, actorId: string, userId: string) {
  const [{ n }] = (await tx<{ n: number }[]>`select count(*)::int as n from memberships where role = 'admin' and user_id <> ${userId}`) as unknown as [{ n: number }];
  const [target] = await tx<{ role: string }[]>`select role from memberships where user_id = ${userId}`;
  if (target?.role === "admin" && n === 0) throw new Error("You can't remove the last admin.");
  await tx`delete from memberships where user_id = ${userId}`;
  await audit(tx, orgId, actorId, "team.removed", { type: "user", id: userId });
}

// ---------------------------------------------------------------------------
// Integrations — customer-facing names are always neutral.
// ---------------------------------------------------------------------------
export async function listConnections(tx: Tx) {
  const rows = await tx<{ id: string; kind: string; display_name: string; credentials_encrypted: string | null; status: string; last_checked_at: Date | null; last_error: string | null; config: Record<string, unknown> }[]>`
    select id, kind, display_name, credentials_encrypted, status, last_checked_at, last_error, config from provider_connections order by kind`;
  return rows.map((r) => {
    let masked: string | null = null;
    if (r.credentials_encrypted) {
      try {
        const creds = JSON.parse(decryptSecret(r.credentials_encrypted)) as Record<string, string>;
        masked = maskSecret(Object.values(creds).at(-1) ?? "");
      } catch {
        masked = "••••";
      }
    }
    return { id: r.id, kind: r.kind, displayName: r.display_name, status: r.status, lastCheckedAt: r.last_checked_at, lastError: r.last_error, masked };
  });
}

export async function saveConnection(tx: Tx, orgId: string, userId: string, kind: "telephony" | "speech" | "reasoning", providerKey: string, creds: Record<string, string>) {
  const display = { telephony: "Telephony connection", speech: "Speech engine", reasoning: "Reasoning engine" }[kind];
  await tx`insert into provider_connections (org_id, kind, provider_key, display_name, credentials_encrypted, status)
           values (${orgId}, ${kind}, ${providerKey}, ${display}, ${encryptSecret(JSON.stringify(creds))}, 'unverified')
           on conflict (org_id, kind) do update set credentials_encrypted = excluded.credentials_encrypted, provider_key = excluded.provider_key,
             status = 'unverified', last_error = null`;
  await audit(tx, orgId, userId, "integration.updated", { type: "provider_connection" }, { kind });
}

export async function setConnectionHealth(tx: Tx, kind: string, ok: boolean, error?: string) {
  await tx`update provider_connections set status = ${ok ? "healthy" : "failed"}, last_checked_at = now(), last_error = ${error ?? null} where kind = ${kind}`;
}
