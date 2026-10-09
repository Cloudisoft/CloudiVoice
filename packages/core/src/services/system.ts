import { createHash } from "node:crypto";
import { db, withSystem, type Sql } from "../db/client";
import { env } from "../env";

// ---------------------------------------------------------------------------
// Webhooks: stored first, processed once, replayable.
// ---------------------------------------------------------------------------
export async function storeWebhook(source: string, kind: string, dedupeKey: string, payload: Record<string, unknown>) {
  const [row] = await db()<{ id: number }[]>`
    insert into webhook_events (source, kind, dedupe_key, payload) values (${source}, ${kind}, ${dedupeKey}, ${db().json(payload as never)})
    on conflict (dedupe_key) do nothing returning id`;
  return row?.id ?? null; // null = duplicate delivery
}

export async function markWebhook(id: number, error: string | null) {
  await db()`update webhook_events set processed_at = case when ${error}::text is null then now() else processed_at end,
             attempts = attempts + 1, error = ${error} where id = ${id}`;
}

export async function failedWebhooks(limit = 50) {
  return db()<{ id: number; source: string; kind: string; received_at: Date; attempts: number; error: string | null }[]>`
    select id, source, kind, received_at, attempts, error from webhook_events
    where processed_at is null and received_at < now() - interval '1 minute' order by id desc limit ${limit}`;
}

export async function getWebhook(id: number) {
  const [row] = await db()<{ id: number; source: string; kind: string; payload: Record<string, unknown> }[]>`
    select id, source, kind, payload from webhook_events where id = ${id}`;
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Worker leases: only one worker runs a given loop at a time, so a restart
// or a second replica can never double-dial.
// ---------------------------------------------------------------------------
export async function acquireLease(name: string, holder: string, ttlSeconds: number, sql: Sql = db()): Promise<boolean> {
  const rows = await sql`
    insert into worker_leases (name, holder, expires_at) values (${name}, ${holder}, now() + ${`${ttlSeconds} seconds`}::interval)
    on conflict (name) do update set holder = excluded.holder, expires_at = excluded.expires_at
      where worker_leases.expires_at < now() or worker_leases.holder = excluded.holder
    returning holder`;
  return rows.length > 0;
}

export async function releaseLease(name: string, holder: string) {
  await db()`delete from worker_leases where name = ${name} and holder = ${holder}`;
}

// ---------------------------------------------------------------------------
// Rate limiting (fixed window, stored in Postgres so it works across replicas)
// ---------------------------------------------------------------------------
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<{ ok: boolean; remaining: number }> {
  const [row] = await db()<{ count: number }[]>`
    insert into rate_limits (key, count, window_ends_at) values (${key}, 1, now() + ${`${windowSeconds} seconds`}::interval)
    on conflict (key) do update set
      count = case when rate_limits.window_ends_at < now() then 1 else rate_limits.count + 1 end,
      window_ends_at = case when rate_limits.window_ends_at < now() then excluded.window_ends_at else rate_limits.window_ends_at end
    returning count`;
  const count = row?.count ?? 1;
  return { ok: count <= limit, remaining: Math.max(0, limit - count) };
}

export function hashIp(ip: string) {
  return createHash("sha256").update(`${env.appSecret}:${ip}`).digest("hex").slice(0, 32);
}

// ---------------------------------------------------------------------------
// Public demo usage ceilings
// ---------------------------------------------------------------------------
export async function demoAllowance(ipHash: string): Promise<{ ok: boolean; reason?: string }> {
  const [{ today, mine }] = (await db()<{ today: number; mine: number }[]>`
    select coalesce(sum(case when started_at > now() - interval '1 day' then greatest(seconds, case when ended_at is null then 60 else 0 end) end), 0)::int as today,
           count(*) filter (where ip_hash = ${ipHash} and started_at > now() - interval '1 day')::int as mine
    from demo_sessions where started_at > now() - interval '1 day'`) as unknown as [{ today: number; mine: number }];
  if (mine >= env.demoSessionsPerIpPerDay) return { ok: false, reason: "You've reached today's live demo limit. Create a free account to keep testing." };
  if (today >= env.demoDailyCeilingSeconds) return { ok: false, reason: "Live demos are at capacity for today. Please try again tomorrow or create a free account." };
  return { ok: true };
}

export async function startDemoSession(ipHash: string, language: string, scenario: string) {
  const [row] = await db()<{ id: string }[]>`insert into demo_sessions (ip_hash, language, scenario) values (${ipHash}, ${language}, ${scenario}) returning id`;
  return row!.id;
}

export async function endDemoSession(id: string, seconds: number, reason: string) {
  await db()`update demo_sessions set ended_at = now(), seconds = ${Math.round(seconds)}, end_reason = ${reason} where id = ${id} and ended_at is null`;
}

// ---------------------------------------------------------------------------
// System health
// ---------------------------------------------------------------------------
export async function systemHealth() {
  return withSystem(async (tx) => {
    const [w] = await tx<{ backlog: number; failed: number }[]>`
      select count(*) filter (where processed_at is null and received_at < now() - interval '1 minute')::int as backlog,
             count(*) filter (where processed_at is null and error is not null)::int as failed
      from webhook_events where received_at > now() - interval '7 days'`;
    const [c] = await tx<{ stuck: number; last_success: Date | null; failed_24h: number }[]>`
      select count(*) filter (where state in ('queued','ringing') and created_at < now() - interval '5 minutes')::int as stuck,
             max(ended_at) filter (where state = 'completed' and answered_at is not null) as last_success,
             count(*) filter (where state = 'failed' and created_at > now() - interval '1 day')::int as failed_24h
      from calls where created_at > now() - interval '30 days'`;
    const leases = await tx<{ name: string; holder: string; expires_at: Date }[]>`select * from worker_leases order by name`;
    return { webhooks: w!, calls: c!, leases };
  });
}
