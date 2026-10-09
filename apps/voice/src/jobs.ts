import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { db, withTenant } from "@cloudivoice/core/db/client";
import { env } from "@cloudivoice/core/env";
import { addEvent } from "@cloudivoice/core/services/calls";
import { telephony } from "@cloudivoice/core/telephony";
import { log } from "./log";

const root = () => resolve(env.storageDir);

/**
 * Copy finished recordings into private storage as MP3. Retries failed
 * downloads and recovers rows left half-done by a restart.
 */
export async function backfillRecordings() {
  const adapter = telephony();
  if (!adapter) return;
  const pending = await db()<{ id: string; org_id: string; url: string }[]>`
    select c.id, c.org_id, e.payload->>'url' as url
    from calls c join lateral (
      select payload from call_events where call_id = c.id and type = 'recording_source' order by id desc limit 1
    ) e on true
    where c.recording_status in ('pending','failed') and c.recording_key is null and c.created_at > now() - interval '7 days'
    limit 20`;
  for (const r of pending) {
    try {
      const bytes = await adapter.downloadRecording(r.url);
      const key = join("recordings", r.org_id, `${r.id}.mp3`);
      const path = join(root(), key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
      await withTenant(r.org_id, async (tx) => {
        await tx`update calls set recording_key = ${key}, recording_status = 'stored' where id = ${r.id}`;
        await addEvent(tx, r.org_id, r.id, "recording_stored", { bytes: bytes.length });
      });
    } catch (e) {
      log.warn("recording backfill failed", { callId: r.id, err: String(e) });
      await withTenant(r.org_id, (tx) => tx`update calls set recording_status = 'failed' where id = ${r.id}`);
    }
  }
}

/** Delete transcripts and recordings older than each organization's retention period. */
export async function enforceRetention() {
  const orgs = await db()<{ id: string; retention_days: number }[]>`select id, retention_days from organizations`;
  for (const org of orgs) {
    await withTenant(org.id, async (tx) => {
      const old = await tx<{ id: string; recording_key: string | null }[]>`
        select id, recording_key from calls where created_at < now() - ${`${org.retention_days} days`}::interval
          and (recording_key is not null or exists (select 1 from transcript_lines t where t.call_id = calls.id))
        limit 1000`;
      for (const c of old) {
        if (c.recording_key) await rm(join(root(), c.recording_key), { force: true });
      }
      if (old.length) {
        const ids = old.map((c) => c.id);
        await tx`delete from transcript_lines where call_id in ${tx(ids)}`;
        await tx`update calls set recording_key = null, recording_status = 'deleted', summary = null where id in ${tx(ids)}`;
        log.info("retention applied", { orgId: org.id, calls: ids.length });
      }
    });
  }
}
