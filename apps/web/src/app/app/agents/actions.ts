"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { type AgentConfig, agentConfigSchema } from "@cloudivoice/core/agentConfig";
import { createAgent, deleteAgent, rollbackAgent, saveAgentVersion, setAgentStatus } from "@cloudivoice/core/services/agents";
import { DialError, placeOutboundCall } from "@cloudivoice/core/services/dialer";
import { withTenant } from "@cloudivoice/core/db/client";
import { normalizePhone } from "@cloudivoice/core/phone";
import { tenant, requirePermission } from "@/lib/session";

export interface AgentFormState {
  error?: string;
  ok?: string;
  fieldErrors?: Record<string, string>;
}

function readConfig(form: FormData): Partial<AgentConfig> {
  const s = (k: string) => String(form.get(k) ?? "").trim();
  const n = (k: string) => Number(form.get(k));
  const transfer = s("transfer_number");
  return {
    persona_name: s("persona_name"),
    company_name: s("company_name"),
    use_case: s("use_case") as AgentConfig["use_case"],
    primary_language: s("primary_language"),
    fallback_language: s("fallback_language"),
    code_switching: form.get("code_switching") === "on",
    voice: s("voice"),
    pace: n("pace"),
    tone: s("tone") as AgentConfig["tone"],
    formality: s("formality") as AgentConfig["formality"],
    opening_line: s("opening_line"),
    instructions: s("instructions"),
    goals: s("goals")
      .split("\n")
      .map((g) => g.trim())
      .filter(Boolean),
    qualification_criteria: s("qualification_criteria"),
    transfer_number: transfer ? (normalizePhone(transfer)?.e164 ?? "invalid") : "",
    max_duration_sec: Math.round(n("max_duration_min") * 60),
    silence_checkin_sec: n("silence_checkin_sec"),
    max_silence_checkins: n("max_silence_checkins"),
    max_clarifications: n("max_clarifications"),
    voicemail_message: s("voicemail_message"),
    recording_disclosure: form.get("recording_disclosure") === "on",
    knowledge_enabled: form.get("knowledge_enabled") === "on",
  };
}

function validate(cfg: Partial<AgentConfig>): Record<string, string> | null {
  if (cfg.transfer_number === "invalid") return { transfer_number: "Enter a valid phone number, e.g. 98765 43210." };
  const r = agentConfigSchema.safeParse(cfg);
  if (r.success) return null;
  const out: Record<string, string> = {};
  for (const i of r.error.issues) out[String(i.path[0])] ??= i.message;
  return out;
}

export async function saveAgentAction(_: AgentFormState, form: FormData): Promise<AgentFormState> {
  const user = await requirePermission("agents.edit");
  const id = String(form.get("id") ?? "");
  const name = String(form.get("name") ?? "").trim();
  if (name.length < 2) return { fieldErrors: { name: "Give your agent a name." } };
  const cfg = readConfig(form);
  const fe = validate(cfg);
  if (fe) return { fieldErrors: fe, error: "Please fix the highlighted fields." };
  let agentId = id;
  try {
    await withTenant(user.orgId, async (tx) => {
      if (id) await saveAgentVersion(tx, user.orgId, user.userId, id, name, cfg, String(form.get("note") ?? "").trim() || undefined);
      else agentId = await createAgent(tx, user.orgId, user.userId, name, cfg);
    });
  } catch (e) {
    if (e instanceof ZodError) return { error: "Some settings are invalid." };
    return { error: e instanceof Error ? e.message : "Could not save the agent." };
  }
  revalidatePath("/app/agents");
  if (!id) redirect(`/app/agents/${agentId}?created=1`);
  revalidatePath(`/app/agents/${id}`);
  return { ok: "Saved as a new version." };
}

export async function setStatusAction(form: FormData) {
  const id = String(form.get("id"));
  const status = form.get("status") === "active" ? "active" : "inactive";
  await tenant((tx, u) => setAgentStatus(tx, u.orgId, u.userId, id, status), "agents.edit");
  revalidatePath(`/app/agents/${id}`);
  revalidatePath("/app/agents");
}

export async function rollbackAction(form: FormData) {
  const id = String(form.get("id"));
  const version = Number(form.get("version"));
  await tenant((tx, u) => rollbackAgent(tx, u.orgId, u.userId, id, version), "agents.edit");
  revalidatePath(`/app/agents/${id}`);
}

export async function deleteAgentAction(form: FormData) {
  const id = String(form.get("id"));
  await tenant((tx, u) => deleteAgent(tx, u.orgId, u.userId, id), "agents.edit");
  revalidatePath("/app/agents");
  redirect("/app/agents");
}

export async function testCallAction(_: AgentFormState, form: FormData): Promise<AgentFormState> {
  const user = await requirePermission("calls.test");
  const agentId = String(form.get("id"));
  const to = String(form.get("to") ?? "");
  const fromId = String(form.get("from_id") ?? "");
  if (!normalizePhone(to)) return { error: "Enter the phone number to call, e.g. 98765 43210." };
  const from = await withTenant(user.orgId, async (tx) => {
    const [n] = await tx<{ e164: string }[]>`select e164 from phone_numbers where id = ${fromId} and status = 'active' and voice_outbound`;
    return n?.e164 ?? null;
  });
  if (!from) return { error: "Choose an active caller number." };
  try {
    const callId = await placeOutboundCall(user.orgId, { agentId, to, fromE164: from, direction: "test", machineDetection: false });
    return { ok: `Calling now… follow it live in the call record (${callId.slice(0, 8)}).` };
  } catch (e) {
    return { error: e instanceof DialError ? e.message : "The test call couldn't be started." };
  }
}
