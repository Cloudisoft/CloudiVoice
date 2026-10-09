import { type AgentConfig, agentConfigSchema, parseAgentConfig, type UseCase } from "../agentConfig";
import type { Tx } from "../db/client";
import { audit } from "./audit";

export interface AgentRow {
  id: string;
  name: string;
  use_case: UseCase;
  status: "draft" | "active" | "inactive";
  current_version: number;
  created_at: Date;
  updated_at: Date;
}

export async function listAgents(tx: Tx) {
  return tx<(AgentRow & { calls_7d: number; primary_language: string })[]>`
    select a.*, coalesce(v.config->>'primary_language', 'hi-IN') as primary_language,
      (select count(*)::int from calls c where c.agent_id = a.id and c.created_at > now() - interval '7 days') as calls_7d
    from agents a
    left join agent_versions v on v.agent_id = a.id and v.version = a.current_version
    order by a.updated_at desc`;
}

export async function getAgent(tx: Tx, id: string) {
  const [agent] = await tx<AgentRow[]>`select * from agents where id = ${id}`;
  if (!agent) return null;
  const [version] = await tx<{ config: unknown; version: number; created_at: Date; note: string | null }[]>`
    select config, version, created_at, note from agent_versions where agent_id = ${id} and version = ${agent.current_version}`;
  return { ...agent, config: parseAgentConfig(version?.config) };
}

export async function listVersions(tx: Tx, agentId: string) {
  return tx<{ version: number; note: string | null; created_at: Date; author: string | null }[]>`
    select v.version, v.note, v.created_at, u.name as author
    from agent_versions v left join users u on u.id = v.created_by
    where v.agent_id = ${agentId} order by v.version desc`;
}

export async function createAgent(tx: Tx, orgId: string, userId: string, name: string, config: Partial<AgentConfig>) {
  const cfg = agentConfigSchema.parse(config);
  const [agent] = await tx<{ id: string }[]>`
    insert into agents (org_id, name, use_case) values (${orgId}, ${name.trim().slice(0, 80)}, ${cfg.use_case}) returning id`;
  await tx`insert into agent_versions (org_id, agent_id, version, config, note, created_by)
           values (${orgId}, ${agent!.id}, 1, ${tx.json(cfg as never)}, 'Initial version', ${userId})`;
  await audit(tx, orgId, userId, "agent.created", { type: "agent", id: agent!.id }, { name });
  return agent!.id;
}

/** Every save is a new version so changes can be rolled back. */
export async function saveAgentVersion(tx: Tx, orgId: string, userId: string, agentId: string, name: string, config: Partial<AgentConfig>, note?: string) {
  const cfg = agentConfigSchema.parse(config);
  const [row] = await tx<{ current_version: number }[]>`select current_version from agents where id = ${agentId} for update`;
  if (!row) throw new Error("Agent not found");
  const [{ max }] = (await tx<{ max: number }[]>`select coalesce(max(version), 0)::int as max from agent_versions where agent_id = ${agentId}`) as unknown as [{ max: number }];
  const next = max + 1;
  await tx`insert into agent_versions (org_id, agent_id, version, config, note, created_by)
           values (${orgId}, ${agentId}, ${next}, ${tx.json(cfg as never)}, ${note?.slice(0, 200) ?? null}, ${userId})`;
  await tx`update agents set name = ${name.trim().slice(0, 80)}, use_case = ${cfg.use_case}, current_version = ${next}, updated_at = now() where id = ${agentId}`;
  await audit(tx, orgId, userId, "agent.version_saved", { type: "agent", id: agentId }, { version: next });
  return next;
}

export async function rollbackAgent(tx: Tx, orgId: string, userId: string, agentId: string, version: number) {
  const [v] = await tx<{ config: unknown }[]>`select config from agent_versions where agent_id = ${agentId} and version = ${version}`;
  if (!v) throw new Error("Version not found");
  const [agent] = await tx<{ name: string }[]>`select name from agents where id = ${agentId}`;
  return saveAgentVersion(tx, orgId, userId, agentId, agent!.name, parseAgentConfig(v.config), `Rolled back to v${version}`);
}

export async function setAgentStatus(tx: Tx, orgId: string, userId: string, agentId: string, status: "active" | "inactive") {
  await tx`update agents set status = ${status}, updated_at = now() where id = ${agentId}`;
  await audit(tx, orgId, userId, status === "active" ? "agent.activated" : "agent.deactivated", { type: "agent", id: agentId });
}

export async function deleteAgent(tx: Tx, orgId: string, userId: string, agentId: string) {
  const [{ n }] = (await tx<{ n: number }[]>`select count(*)::int as n from campaigns where agent_id = ${agentId} and status in ('running','paused')`) as unknown as [{ n: number }];
  if (n > 0) throw new Error("This agent is used by a running or paused campaign. Stop the campaign first.");
  await tx`delete from agents where id = ${agentId}`;
  await audit(tx, orgId, userId, "agent.deleted", { type: "agent", id: agentId });
}
