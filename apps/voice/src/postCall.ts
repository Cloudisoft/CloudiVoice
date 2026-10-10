import { summarizeCall } from "@cloudivoice/core/brain";
import { withTenant } from "@cloudivoice/core/db/client";
import { log } from "./log";
import { backfillRecordings } from "./jobs";

/**
 * Everything that should appear in Call Records the moment a call ends:
 * summary + QA score now, the recording as soon as the carrier hands it over.
 */
export async function summarizeAndStore(orgId: string, callId: string) {
  try {
    const lines = await withTenant(orgId, (tx) => tx<{ speaker: string; text: string }[]>`select speaker, text from transcript_lines where call_id = ${callId} order by id`);
    const s = await summarizeCall(lines);
    if (s) await withTenant(orgId, (tx) => tx`update calls set summary = ${s.summary}, qa = ${tx.json({ score: s.score, notes: s.notes })} where id = ${callId}`);
  } catch (e) {
    log.warn("summary failed", { callId, err: String(e) });
  }
}

let fetching: Promise<void> | null = null;
let again = false;
/** Download finished recordings right away (single-flight; the periodic job is the safety net). */
export function fetchRecordingsNow() {
  if (fetching) {
    again = true;
    return;
  }
  fetching = backfillRecordings()
    .catch((e) => log.warn("recording fetch failed", { err: String(e) }))
    .finally(() => {
      fetching = null;
      if (again) {
        again = false;
        fetchRecordingsNow();
      }
    });
}
