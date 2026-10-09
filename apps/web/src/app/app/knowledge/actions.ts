"use server";

import { revalidatePath } from "next/cache";
import { deleteDocument, ingestDocument, MAX_KNOWLEDGE_BYTES } from "@cloudivoice/core/services/knowledge";
import { tenant } from "@/lib/session";

export interface UploadState {
  error?: string;
  ok?: string;
}

export async function uploadKnowledgeAction(_: UploadState, form: FormData): Promise<UploadState> {
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { error: "Choose at least one PDF, DOCX or TXT file." };
  const agentId = String(form.get("agent_id") ?? "") || null;
  const results: string[] = [];
  const errors: string[] = [];
  for (const f of files.slice(0, 10)) {
    if (f.size > MAX_KNOWLEDGE_BYTES) {
      errors.push(`${f.name}: larger than 10 MB.`);
      continue;
    }
    const bytes = new Uint8Array(await f.arrayBuffer());
    const r = await tenant((tx, u) => ingestDocument(tx, u.orgId, u.userId, { name: f.name, type: f.type, bytes }, agentId), "knowledge.edit");
    if (r.error) errors.push(`${f.name}: ${r.error}`);
    else results.push(`${f.name} (${r.chunks} sections)`);
  }
  revalidatePath("/app/knowledge");
  return {
    ok: results.length ? `Indexed ${results.join(", ")}.` : undefined,
    error: errors.length ? errors.join(" ") : undefined,
  };
}

export async function deleteKnowledgeAction(form: FormData) {
  const id = String(form.get("id"));
  await tenant((tx, u) => deleteDocument(tx, u.orgId, u.userId, id), "knowledge.edit");
  revalidatePath("/app/knowledge");
}
