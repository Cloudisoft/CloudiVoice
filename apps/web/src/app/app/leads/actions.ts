"use server";

import { revalidatePath } from "next/cache";
import { addDnc, bulkAddToList, bulkDelete, bulkDnc, guessMapping, importLeads, leadIdsForFilter, type LeadFilter, parseSheet } from "@cloudivoice/core/services/leads";
import { normalizePhone } from "@cloudivoice/core/phone";
import { audit } from "@cloudivoice/core/services/audit";
import { tenant } from "@/lib/session";

export interface PreviewState {
  error?: string;
  headers?: string[];
  rows?: string[][];
  total?: number;
  mapping?: Record<string, string>;
}

const MAX_UPLOAD = 15 * 1024 * 1024;

function fileFrom(form: FormData) {
  const f = form.get("file");
  return f instanceof File && f.size > 0 ? f : null;
}

export async function previewImportAction(_: PreviewState, form: FormData): Promise<PreviewState> {
  const file = fileFrom(form);
  if (!file) return { error: "Choose a CSV or Excel (.xlsx) file." };
  if (file.size > MAX_UPLOAD) return { error: "Files must be 15 MB or smaller." };
  await tenant(async () => null, "leads.edit");
  try {
    const sheet = await parseSheet(new Uint8Array(await file.arrayBuffer()), file.name);
    if (!sheet.headers.length) return { error: "The file looks empty. Make sure the first row has column names." };
    return { headers: sheet.headers, rows: sheet.rows.slice(0, 5), total: sheet.rows.length, mapping: guessMapping(sheet.headers) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "We couldn't read that file." };
  }
}

export interface ImportState {
  error?: string;
  result?: { imported: number; updated: number; duplicatesInFile: number; invalidPhones: number; dncSkipped: number; invalidSamples: string[]; listId: string | null };
}

export async function runImportAction(_: ImportState, form: FormData): Promise<ImportState> {
  const file = fileFrom(form);
  if (!file) return { error: "The file is missing — choose it again." };
  const mapping = JSON.parse(String(form.get("mapping") ?? "{}")) as Record<string, string>;
  const listId = String(form.get("list_id") ?? "") || null;
  const listName = String(form.get("list_name") ?? "").trim() || null;
  if (!listId && !listName) return { error: "Choose a list or name a new one." };
  try {
    const sheet = await parseSheet(new Uint8Array(await file.arrayBuffer()), file.name);
    const result = await tenant((tx, u) => importLeads(tx, u.orgId, u.userId, sheet, mapping, { listId, listName, updateExisting: form.get("update") === "on" }), "leads.edit");
    revalidatePath("/app/leads");
    revalidatePath("/app/lists");
    return { result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Import failed." };
  }
}

function filterFrom(form: FormData): LeadFilter {
  const g = (k: string) => String(form.get(k) ?? "") || undefined;
  return { q: g("q"), listId: g("list"), outcome: g("outcome"), status: g("status") };
}

export async function bulkAction(form: FormData) {
  const op = String(form.get("op"));
  const all = form.get("all") === "1";
  const perm = op === "delete" ? "leads.delete" : "leads.edit";
  await tenant(async (tx, u) => {
    const ids = all ? await leadIdsForFilter(tx, filterFrom(form)) : form.getAll("ids").map(String);
    if (!ids.length) return;
    if (op === "delete") await bulkDelete(tx, u.orgId, u.userId, ids);
    else if (op === "dnc") await bulkDnc(tx, u.orgId, u.userId, ids);
    else if (op === "list") {
      const listId = String(form.get("target_list") ?? "");
      if (listId) await bulkAddToList(tx, u.orgId, u.userId, ids, listId);
    }
  }, perm);
  revalidatePath("/app/leads");
}

export async function updateLeadAction(form: FormData) {
  const id = String(form.get("id"));
  const phone = normalizePhone(String(form.get("phone") ?? ""));
  await tenant(async (tx, u) => {
    await tx`update leads set
      first_name = ${String(form.get("first_name") ?? "").trim() || null},
      last_name = ${String(form.get("last_name") ?? "").trim() || null},
      email = ${String(form.get("email") ?? "").trim().toLowerCase() || null},
      city = ${String(form.get("city") ?? "").trim() || null},
      state = ${String(form.get("state") ?? "").trim() || null},
      ${phone ? tx`phone_e164 = ${phone.e164}, phone_digits = ${phone.national},` : tx``}
      updated_at = now()
      where id = ${id}`;
    await audit(tx, u.orgId, u.userId, "lead.updated", { type: "lead", id });
  }, "leads.edit");
  revalidatePath(`/app/leads/${id}`);
}

export async function leadDncAction(form: FormData) {
  const id = String(form.get("id"));
  await tenant((tx, u) => bulkDnc(tx, u.orgId, u.userId, [id], "Marked from lead page"), "leads.edit");
  revalidatePath(`/app/leads/${id}`);
}

export async function addDncAction(form: FormData) {
  await tenant(async (tx, u) => {
    const e164 = await addDnc(tx, u.orgId, String(form.get("phone") ?? ""), String(form.get("reason") ?? "Added manually").slice(0, 200));
    await audit(tx, u.orgId, u.userId, "dnc.added", { type: "dnc", id: e164 });
  }, "leads.edit");
  revalidatePath("/app/lists");
}
