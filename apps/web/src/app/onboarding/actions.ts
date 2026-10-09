"use server";

import { redirect } from "next/navigation";
import { type AgentConfig, agentConfigSchema, parseAgentConfig } from "@cloudivoice/core/agentConfig";
import { getDemoScenario } from "@cloudivoice/core/demoScenarios";
import { languageStatus } from "@cloudivoice/core/languages";
import { normalizePhone } from "@cloudivoice/core/phone";
import { createAgent, setAgentStatus } from "@cloudivoice/core/services/agents";
import { setOnboardingStep, updateOrgSettings } from "@cloudivoice/core/services/org";
import type { Tx } from "@cloudivoice/core/db/client";
import { tenant } from "@/lib/session";
import { STEPS, type Step } from "./steps";


async function firstAgent(tx: Tx) {
  const [a] = await tx<{ id: string; current_version: number }[]>`select id, current_version from agents order by created_at limit 1`;
  return a ?? null;
}

/** During onboarding, edits refine the first version instead of creating many versions. */
async function patchAgent(tx: Tx, agentId: string, version: number, patch: Partial<AgentConfig>, name?: string) {
  const [v] = await tx<{ config: unknown }[]>`select config from agent_versions where agent_id = ${agentId} and version = ${version}`;
  const next = agentConfigSchema.parse({ ...parseAgentConfig(v?.config), ...patch });
  await tx`update agent_versions set config = ${tx.json(next as never)} where agent_id = ${agentId} and version = ${version}`;
  await tx`update agents set use_case = ${next.use_case}, updated_at = now() ${name ? tx`, name = ${name}` : tx``} where id = ${agentId}`;
}

function go(step: Step, carry: FormData) {
  const qs = new URLSearchParams({ step });
  for (const k of ["scenario", "lang"]) {
    const v = String(carry.get(k) ?? "");
    if (v) qs.set(k, v);
  }
  redirect(`/onboarding?${qs}`);
}

export async function businessStep(form: FormData) {
  const s = (k: string) => String(form.get(k) ?? "").trim();
  await tenant(async (tx, u) => {
    await updateOrgSettings(tx, u.orgId, u.userId, { name: s("name") || u.orgName, industry: s("industry") || null, website: s("website") || null, team_size: s("team_size") || null, timezone: s("timezone") || "Asia/Kolkata" });
    await setOnboardingStep(tx, u.orgId, "voice");
  }, "org.manage");
  go("voice", form);
}

export async function voiceStep(form: FormData) {
  const lang = String(form.get("primary_language") ?? "hi-IN");
  const primary = languageStatus(lang) === "available" ? lang : "hi-IN";
  const voice = String(form.get("voice") ?? "priya");
  const tone = String(form.get("tone") ?? "warm") as AgentConfig["tone"];
  const scenario = getDemoScenario(String(form.get("scenario") ?? ""));
  await tenant(async (tx, u) => {
    const existing = await firstAgent(tx);
    if (existing) await patchAgent(tx, existing.id, existing.current_version, { primary_language: primary, fallback_language: primary === "hi-IN" ? "en-IN" : "hi-IN", voice, tone });
    else {
      const base = scenario ? scenario.config(primary) : parseAgentConfig({});
      await createAgent(tx, u.orgId, u.userId, scenario ? `${scenario.label} agent` : "My first agent", {
        ...base,
        company_name: u.orgName,
        primary_language: primary,
        fallback_language: primary === "hi-IN" ? "en-IN" : "hi-IN",
        voice,
        tone,
        max_duration_sec: 900,
        knowledge_enabled: true,
      });
    }
    await tx`update organizations set default_language = ${primary}`;
    await setOnboardingStep(tx, u.orgId, "agent");
  }, "org.manage");
  go("agent", form);
}

export async function agentStep(form: FormData) {
  const s = (k: string) => String(form.get(k) ?? "").trim();
  await tenant(async (tx, u) => {
    const a = await firstAgent(tx);
    if (a) await patchAgent(tx, a.id, a.current_version, { use_case: s("use_case") as AgentConfig["use_case"], persona_name: s("persona_name") || "Ananya", company_name: s("company_name") || u.orgName, opening_line: s("opening_line") }, s("name") || undefined);
    await setOnboardingStep(tx, u.orgId, "instructions");
  }, "org.manage");
  go("instructions", form);
}

export async function instructionsStep(form: FormData) {
  const s = (k: string) => String(form.get(k) ?? "").trim();
  const transfer = s("transfer_number") ? (normalizePhone(s("transfer_number"))?.e164 ?? "") : "";
  await tenant(async (tx, u) => {
    const a = await firstAgent(tx);
    if (a)
      await patchAgent(tx, a.id, a.current_version, {
        instructions: s("instructions").slice(0, 8000),
        goals: s("goals").split("\n").map((g) => g.trim()).filter(Boolean).slice(0, 10),
        qualification_criteria: s("qualification_criteria").slice(0, 2000),
        transfer_number: transfer,
      });
    await setOnboardingStep(tx, u.orgId, "knowledge");
  }, "org.manage");
  go("knowledge", form);
}

export async function advanceStep(form: FormData) {
  const to = String(form.get("to")) as Step;
  if (!STEPS.includes(to)) return;
  await tenant((tx, u) => setOnboardingStep(tx, u.orgId, to), "org.manage");
  go(to, form);
}

export async function finishOnboarding(form: FormData) {
  await tenant(async (tx, u) => {
    const a = await firstAgent(tx);
    if (a && form.get("activate") === "on") await setAgentStatus(tx, u.orgId, u.userId, a.id, "active");
    await setOnboardingStep(tx, u.orgId, "done", true);
  }, "org.manage");
  redirect("/app");
}
