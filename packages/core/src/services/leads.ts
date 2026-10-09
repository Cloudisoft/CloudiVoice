import Papa from "papaparse";
import type { Tx } from "../db/client";
import { PERMANENT_OUTCOMES } from "../outcomes";
import { normalizePhone, phoneSearchKey } from "../phone";
import { audit } from "./audit";

export const LEAD_FIELDS = ["phone", "first_name", "last_name", "full_name", "email", "city", "state", "pincode", "language"] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];

export interface ParsedSheet {
  headers: string[];
  rows: string[][];
}

const MAX_ROWS = 50_000;

/** Parse CSV or XLSX into headers + string rows. */
export async function parseSheet(bytes: Uint8Array, filename: string): Promise<ParsedSheet> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx")) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return { headers: [], rows: [] };
    const all: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = (row.values as unknown[]).slice(1).map((v) => cellText(v));
      all.push(values);
    });
    const [headers = [], ...rows] = all;
    return { headers: headers.map((h) => h.trim()), rows: rows.slice(0, MAX_ROWS) };
  }
  if (lower.endsWith(".xls")) throw new Error("Old .xls files are not supported. Save as .xlsx or .csv and upload again.");
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  const [headers = [], ...rows] = parsed.data;
  return { headers: headers.map((h) => String(h).trim()), rows: rows.slice(0, MAX_ROWS).map((r) => r.map((c) => String(c ?? ""))) };
}

function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.text) return String(o.text);
    if (o.result != null) return String(o.result);
    if (v instanceof Date) return v.toISOString();
  }
  // Excel stores long numbers as floats; avoid "9.87654321E9".
  if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v);
}

/** Guess a column mapping from header names (English + common Hindi labels). */
export function guessMapping(headers: string[]): Record<string, LeadField | "custom" | "ignore"> {
  const map: Record<string, LeadField | "custom" | "ignore"> = {};
  for (const h of headers) {
    const k = h.toLowerCase().replace(/[^a-zऀ-ॿ]+/g, " ").trim();
    let f: LeadField | "custom" = "custom";
    if (/(phone|mobile|contact|number|cell|whatsapp|मोबाइल|फ़ोन|फोन)/.test(k)) f = "phone";
    else if (/^(first|first name|fname|given)/.test(k)) f = "first_name";
    else if (/^(last|last name|lname|surname)/.test(k)) f = "last_name";
    else if (/^(name|full name|customer|candidate|नाम)/.test(k)) f = "full_name";
    else if (/mail/.test(k)) f = "email";
    else if (/(city|town|शहर)/.test(k)) f = "city";
    else if (/(state|राज्य)/.test(k)) f = "state";
    else if (/(pin|zip|postal)/.test(k)) f = "pincode";
    else if (/(language|lang|भाषा)/.test(k)) f = "language";
    map[h] = Object.values(map).includes(f) && f !== "custom" ? "custom" : f;
  }
  return map;
}

export interface ImportResult {
  imported: number;
  updated: number;
  duplicatesInFile: number;
  invalidPhones: number;
  dncSkipped: number;
  invalidSamples: string[];
}

export async function importLeads(
  tx: Tx,
  orgId: string,
  userId: string,
  sheet: ParsedSheet,
  mapping: Record<string, string>,
  opts: { listId?: string | null; listName?: string | null; updateExisting?: boolean },
): Promise<ImportResult & { listId: string | null }> {
  const idx = (f: string) => sheet.headers.findIndex((h) => mapping[h] === f);
  const phoneIdx = idx("phone");
  if (phoneIdx < 0) throw new Error("Choose which column contains the phone number.");
  const customCols = sheet.headers
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => mapping[h] === "custom")
    .map(({ h, i }) => ({ key: h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || `field_${i}`, i }));

  let listId = opts.listId ?? null;
  if (!listId && opts.listName?.trim()) {
    const [l] = await tx<{ id: string }[]>`insert into lead_lists (org_id, name) values (${orgId}, ${opts.listName.trim().slice(0, 80)}) returning id`;
    listId = l!.id;
  }
  const dnc = new Set((await tx<{ phone_e164: string }[]>`select phone_e164 from dnc_entries`).map((r) => r.phone_e164));

  const res: ImportResult = { imported: 0, updated: 0, duplicatesInFile: 0, invalidPhones: 0, dncSkipped: 0, invalidSamples: [] };
  const seen = new Set<string>();
  const get = (row: string[], f: string) => {
    const i = idx(f);
    return i >= 0 ? (row[i] ?? "").trim() || null : null;
  };
  const records: Record<string, unknown>[] = [];
  for (const row of sheet.rows) {
    const raw = row[phoneIdx] ?? "";
    const phone = normalizePhone(raw);
    if (!phone) {
      res.invalidPhones++;
      if (res.invalidSamples.length < 5 && raw.trim()) res.invalidSamples.push(raw.trim());
      continue;
    }
    if (seen.has(phone.e164)) {
      res.duplicatesInFile++;
      continue;
    }
    seen.add(phone.e164);
    let first = get(row, "first_name");
    let last = get(row, "last_name");
    const full = get(row, "full_name");
    if (full && !first) {
      const parts = full.split(/\s+/);
      first = parts[0] ?? null;
      last = last ?? (parts.slice(1).join(" ") || null);
    }
    const custom: Record<string, string> = {};
    for (const c of customCols) {
      const v = (row[c.i] ?? "").trim();
      if (v) custom[c.key] = v.slice(0, 500);
    }
    records.push({
      org_id: orgId,
      first_name: first?.slice(0, 80) ?? null,
      last_name: last?.slice(0, 80) ?? null,
      email: get(row, "email")?.toLowerCase().slice(0, 120) ?? null,
      phone_e164: phone.e164,
      phone_digits: phone.national,
      city: get(row, "city")?.slice(0, 80) ?? null,
      state: get(row, "state")?.slice(0, 80) ?? null,
      pincode: get(row, "pincode")?.replace(/\D/g, "").slice(0, 6) || null,
      language: get(row, "language")?.slice(0, 10) ?? null,
      custom,
      dnc: dnc.has(phone.e164),
    });
    if (dnc.has(phone.e164)) res.dncSkipped++;
  }

  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500).map((r) => ({ ...r, custom: tx.json(r.custom as never) }));
    const rows = opts.updateExisting
      ? await tx<{ id: string; inserted: boolean }[]>`
          insert into leads ${tx(batch as never, "org_id", "first_name", "last_name", "email", "phone_e164", "phone_digits", "city", "state", "pincode", "language", "custom", "dnc")}
          on conflict (org_id, phone_e164) do update set
            first_name = coalesce(excluded.first_name, leads.first_name),
            last_name = coalesce(excluded.last_name, leads.last_name),
            email = coalesce(excluded.email, leads.email),
            city = coalesce(excluded.city, leads.city),
            state = coalesce(excluded.state, leads.state),
            pincode = coalesce(excluded.pincode, leads.pincode),
            language = coalesce(excluded.language, leads.language),
            custom = leads.custom || excluded.custom,
            updated_at = now()
          returning id, (xmax = 0) as inserted`
      : await tx<{ id: string; inserted: boolean }[]>`
          with ins as (
            insert into leads ${tx(batch as never, "org_id", "first_name", "last_name", "email", "phone_e164", "phone_digits", "city", "state", "pincode", "language", "custom", "dnc")}
            on conflict (org_id, phone_e164) do nothing
            returning id, true as inserted
          )
          select id, inserted from ins
          union all
          select l.id, false from leads l
          where l.phone_e164 in ${tx(records.slice(i, i + 500).map((b) => b.phone_e164 as string))} and not exists (select 1 from ins where ins.id = l.id)`;
    for (const r of rows) r.inserted ? res.imported++ : res.updated++;
    if (listId && rows.length) {
      const members = rows.map((r) => ({ list_id: listId!, lead_id: r.id, org_id: orgId }));
      await tx`insert into lead_list_members ${tx(members, "list_id", "lead_id", "org_id")} on conflict do nothing`;
    }
  }
  await audit(tx, orgId, userId, "leads.imported", { type: "lead_list", id: listId }, { ...res });
  return { ...res, listId };
}

export interface LeadFilter {
  q?: string;
  listId?: string;
  outcome?: string;
  status?: string;
  minAttempts?: number;
  maxAttempts?: number;
  createdFrom?: string;
  createdTo?: string;
  dnc?: boolean;
}

function whereLeads(tx: Tx, f: LeadFilter) {
  const conds = [tx`true`];
  if (f.q?.trim()) {
    const q = f.q.trim();
    const digits = phoneSearchKey(q);
    const like = `%${q.toLowerCase().replace(/[%_]/g, "")}%`;
    conds.push(
      digits
        ? tx`(l.phone_digits like ${`%${digits}%`} or lower(coalesce(l.first_name,'') || ' ' || coalesce(l.last_name,'')) like ${like} or lower(l.email) like ${like})`
        : tx`(lower(coalesce(l.first_name,'') || ' ' || coalesce(l.last_name,'')) like ${like} or lower(l.email) like ${like} or lower(l.city) like ${like})`,
    );
  }
  if (f.listId) conds.push(tx`exists (select 1 from lead_list_members m where m.lead_id = l.id and m.list_id = ${f.listId})`);
  if (f.outcome) conds.push(f.outcome === "none" ? tx`l.last_outcome is null` : tx`l.last_outcome = ${f.outcome}`);
  if (f.status) conds.push(tx`l.status = ${f.status}`);
  if (f.minAttempts != null) conds.push(tx`l.attempts >= ${f.minAttempts}`);
  if (f.maxAttempts != null) conds.push(tx`l.attempts <= ${f.maxAttempts}`);
  if (f.createdFrom) conds.push(tx`l.created_at >= ${f.createdFrom}::date`);
  if (f.createdTo) conds.push(tx`l.created_at < ${f.createdTo}::date + 1`);
  if (f.dnc != null) conds.push(tx`l.dnc = ${f.dnc}`);
  return conds.reduce((acc, c) => tx`${acc} and ${c}`);
}

export async function listLeads(tx: Tx, f: LeadFilter, page = 1, pageSize = 50) {
  const where = whereLeads(tx, f);
  const offset = (Math.max(1, page) - 1) * pageSize;
  const rows = await tx<
    { id: string; first_name: string | null; last_name: string | null; email: string | null; phone_e164: string; city: string | null; status: string; last_outcome: string | null; attempts: number; dnc: boolean; created_at: Date }[]
  >`select l.id, l.first_name, l.last_name, l.email, l.phone_e164, l.city, l.status, l.last_outcome, l.attempts, l.dnc, l.created_at
    from leads l where ${where} order by l.created_at desc, l.id limit ${pageSize} offset ${offset}`;
  const [{ total }] = (await tx<{ total: number }[]>`select count(*)::int as total from leads l where ${where}`) as unknown as [{ total: number }];
  return { rows, total, page, pageSize };
}

export async function leadIdsForFilter(tx: Tx, f: LeadFilter) {
  return (await tx<{ id: string }[]>`select l.id from leads l where ${whereLeads(tx, f)} limit 50000`).map((r) => r.id);
}

export async function getLead(tx: Tx, id: string) {
  const [lead] = await tx`select * from leads where id = ${id}`;
  if (!lead) return null;
  const calls = await tx`
    select c.id, c.direction, c.state, c.outcome, c.outcome_reason, c.end_reason, c.duration_sec, c.created_at,
           c.summary, c.recording_key is not null as has_recording, cp.name as campaign_name
    from calls c left join campaigns cp on cp.id = c.campaign_id
    where c.lead_id = ${id} order by c.created_at desc limit 100`;
  const lists = await tx`select ll.id, ll.name from lead_list_members m join lead_lists ll on ll.id = m.list_id where m.lead_id = ${id}`;
  const callbacks = await tx`select id, scheduled_for, status, reason from callbacks where lead_id = ${id} order by scheduled_for desc limit 20`;
  return { lead, calls, lists, callbacks };
}

export async function listLeadLists(tx: Tx) {
  return tx<{ id: string; name: string; created_at: Date; total: number; fresh: number; dialed: number }[]>`
    select ll.id, ll.name, ll.created_at,
      count(m.lead_id)::int as total,
      count(m.lead_id) filter (where l.attempts = 0)::int as fresh,
      count(m.lead_id) filter (where l.attempts > 0)::int as dialed
    from lead_lists ll
    left join lead_list_members m on m.list_id = ll.id
    left join leads l on l.id = m.lead_id
    group by ll.id order by ll.created_at desc`;
}

export async function bulkAddToList(tx: Tx, orgId: string, userId: string, ids: string[], listId: string) {
  if (!ids.length) return 0;
  const rows = ids.map((lead_id) => ({ list_id: listId, lead_id, org_id: orgId }));
  const r = await tx`insert into lead_list_members ${tx(rows, "list_id", "lead_id", "org_id")} on conflict do nothing`;
  await audit(tx, orgId, userId, "leads.added_to_list", { type: "lead_list", id: listId }, { count: ids.length });
  return r.count;
}

export async function bulkDelete(tx: Tx, orgId: string, userId: string, ids: string[]) {
  if (!ids.length) return 0;
  const r = await tx`delete from leads where id in ${tx(ids)}`;
  await audit(tx, orgId, userId, "leads.deleted", { type: "lead" }, { count: r.count });
  return r.count;
}

export async function bulkDnc(tx: Tx, orgId: string, userId: string, ids: string[], reason = "Marked by user") {
  if (!ids.length) return 0;
  const phones = await tx<{ phone_e164: string }[]>`update leads set dnc = true, updated_at = now() where id in ${tx(ids)} returning phone_e164`;
  if (phones.length) {
    const rows = phones.map((p) => ({ org_id: orgId, phone_e164: p.phone_e164, reason }));
    await tx`insert into dnc_entries ${tx(rows, "org_id", "phone_e164", "reason")} on conflict do nothing`;
    await tx`update campaign_leads set state = 'skipped', updated_at = now() where lead_id in ${tx(ids)} and state in ('pending','retry_wait')`;
  }
  await audit(tx, orgId, userId, "leads.dnc", { type: "lead" }, { count: phones.length });
  return phones.length;
}

export async function addDnc(tx: Tx, orgId: string, phoneRaw: string, reason: string) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) throw new Error("That phone number doesn't look valid.");
  await tx`insert into dnc_entries (org_id, phone_e164, reason) values (${orgId}, ${phone.e164}, ${reason}) on conflict do nothing`;
  await tx`update leads set dnc = true, updated_at = now() where phone_e164 = ${phone.e164}`;
  await tx`update campaign_leads cl set state = 'skipped', updated_at = now()
           from leads l where l.id = cl.lead_id and l.phone_e164 = ${phone.e164} and cl.state in ('pending','retry_wait')`;
  return phone.e164;
}

export async function isDnc(tx: Tx, e164: string) {
  const [r] = await tx`select 1 from dnc_entries where phone_e164 = ${e164}`;
  return Boolean(r);
}

/**
 * Reset leads so they are dialled again. Never resets permanent outcomes
 * (DNC, not in service, disconnected, not interested, wrong number).
 */
export async function resetLeadsForRedial(
  tx: Tx,
  orgId: string,
  userId: string,
  target: { listId: string; outcomes?: string[]; leadIds?: string[] },
) {
  const conds = [tx`m.list_id = ${target.listId}`, tx`not l.dnc`, tx`(l.last_outcome is null or l.last_outcome not in ${tx([...PERMANENT_OUTCOMES])})`];
  if (target.outcomes?.length) conds.push(tx`l.last_outcome in ${tx(target.outcomes)}`);
  if (target.leadIds?.length) conds.push(tx`l.id in ${tx(target.leadIds)}`);
  const where = conds.reduce((a, c) => tx`${a} and ${c}`);
  const ids = (await tx<{ id: string }[]>`select l.id from leads l join lead_list_members m on m.lead_id = l.id where ${where}`).map((r) => r.id);
  if (!ids.length) return 0;
  await tx`update leads set attempts = 0, status = 'new', updated_at = now() where id in ${tx(ids)}`;
  await tx`update campaign_leads set state = 'pending', attempts = 0, next_eligible_at = now(), updated_at = now()
           where lead_id in ${tx(ids)} and state in ('completed','exhausted','retry_wait')`;
  await audit(tx, orgId, userId, "leads.reset_for_redial", { type: "lead_list", id: target.listId }, { count: ids.length, outcomes: target.outcomes ?? "all" });
  return ids.length;
}

export function leadsToCsv(rows: Record<string, unknown>[]) {
  return Papa.unparse(rows);
}
