import type { Tx } from "../db/client";
import { audit } from "./audit";

export const KNOWLEDGE_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "text/plain": "Text",
  "text/markdown": "Markdown",
  "text/csv": "CSV",
};
export const MAX_KNOWLEDGE_BYTES = 10 * 1024 * 1024;

export class KnowledgeError extends Error {}

/** Extract plain text from an uploaded document. */
export async function extractText(bytes: Uint8Array, mime: string, filename: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await pdfText(pdf, { mergePages: true });
      const out = Array.isArray(text) ? text.join("\n") : text;
      if (!out.trim()) throw new KnowledgeError("This PDF has no selectable text (it may be scanned images). Upload a text-based PDF or a Word file.");
      return out;
    } catch (e) {
      if (e instanceof KnowledgeError) throw e;
      throw new KnowledgeError("We couldn't read this PDF. It may be password-protected or damaged.");
    }
  }
  if (mime.includes("wordprocessingml") || lower.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    try {
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return value;
    } catch {
      throw new KnowledgeError("We couldn't read this Word file. Save it again as .docx and retry.");
    }
  }
  if (mime.startsWith("text/") || /\.(txt|md|csv)$/.test(lower)) {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  throw new KnowledgeError("Unsupported file type. Upload PDF, DOCX or TXT.");
}

/** Split text into overlapping ~900-character chunks on paragraph/sentence boundaries. */
export function chunkText(text: string, size = 900, overlap = 150): string[] {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const pieces = clean.split(/(?<=[.!?।])\s+|\n\n/);
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if ((current + " " + piece).length > size && current) {
      chunks.push(current.trim());
      current = current.slice(Math.max(0, current.length - overlap)) + " " + piece;
    } else {
      current = current ? `${current} ${piece}` : piece;
    }
    while (current.length > size * 1.5) {
      chunks.push(current.slice(0, size).trim());
      current = current.slice(size - overlap);
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export async function ingestDocument(
  tx: Tx,
  orgId: string,
  userId: string,
  file: { name: string; type: string; bytes: Uint8Array },
  agentId: string | null,
) {
  if (file.bytes.length > MAX_KNOWLEDGE_BYTES) throw new KnowledgeError("Files must be 10 MB or smaller.");
  const [doc] = await tx<{ id: string }[]>`
    insert into knowledge_documents (org_id, agent_id, filename, mime_type, size_bytes, status)
    values (${orgId}, ${agentId}, ${file.name.slice(0, 200)}, ${file.type || "application/octet-stream"}, ${file.bytes.length}, 'processing')
    returning id`;
  try {
    const text = await extractText(file.bytes, file.type, file.name);
    const chunks = chunkText(text);
    if (chunks.length === 0) throw new KnowledgeError("No readable text was found in this file.");
    for (let i = 0; i < chunks.length; i += 200) {
      const batch = chunks.slice(i, i + 200).map((content, j) => ({ org_id: orgId, document_id: doc!.id, idx: i + j, content }));
      await tx`insert into knowledge_chunks ${tx(batch, "org_id", "document_id", "idx", "content")}`;
    }
    await tx`update knowledge_documents set status = 'ready', chunk_count = ${chunks.length} where id = ${doc!.id}`;
    await audit(tx, orgId, userId, "knowledge.uploaded", { type: "knowledge_document", id: doc!.id }, { filename: file.name, chunks: chunks.length });
    return { id: doc!.id, chunks: chunks.length };
  } catch (e) {
    const message = e instanceof KnowledgeError ? e.message : "Processing failed. Try again or upload a different format.";
    await tx`update knowledge_documents set status = 'failed', error = ${message} where id = ${doc!.id}`;
    return { id: doc!.id, chunks: 0, error: message };
  }
}

export async function listDocuments(tx: Tx) {
  return tx<
    { id: string; filename: string; mime_type: string; size_bytes: number; status: string; error: string | null; chunk_count: number; created_at: Date; agent_name: string | null }[]
  >`select d.*, a.name as agent_name from knowledge_documents d left join agents a on a.id = d.agent_id order by d.created_at desc`;
}

export async function deleteDocument(tx: Tx, orgId: string, userId: string, id: string) {
  await tx`delete from knowledge_documents where id = ${id}`;
  await audit(tx, orgId, userId, "knowledge.deleted", { type: "knowledge_document", id });
}

/** Retrieval for the lookup_knowledge tool (Postgres full-text, language-agnostic). */
export async function searchKnowledge(tx: Tx, query: string, agentId: string | null, limit = 4) {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1)
    .slice(0, 12);
  if (terms.length === 0) return [];
  const tsq = terms.map((t) => t.replace(/'/g, "")).join(" | ");
  return tx<{ content: string; filename: string; rank: number }[]>`
    select c.content, d.filename, ts_rank(c.tsv, to_tsquery('simple', ${tsq})) as rank
    from knowledge_chunks c join knowledge_documents d on d.id = c.document_id
    where d.status = 'ready' and c.tsv @@ to_tsquery('simple', ${tsq})
      and (${agentId}::uuid is null or d.agent_id is null or d.agent_id = ${agentId})
    order by rank desc limit ${limit}`;
}
