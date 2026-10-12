/**
 * Private object storage for call recordings.
 *
 * Supabase Storage (private bucket) when SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are set; otherwise the local STORAGE_DIR.
 * Objects are only ever read server-side after a permission check.
 */
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { env } from "./env";

export interface StoredObject {
  body: ReadableStream<Uint8Array>;
  status: 200 | 206;
  headers: Record<string, string>;
}

export function usingSupabaseStorage() {
  return Boolean(env.supabaseUrl && env.supabaseServiceKey);
}

function safeKey(key: string) {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..") || key.startsWith("/")) throw new Error("Invalid storage key");
  return key;
}

const sb = (path: string, init: RequestInit = {}) =>
  fetch(`${env.supabaseUrl}/storage/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.supabaseServiceKey}`, apikey: env.supabaseServiceKey!, ...(init.headers ?? {}) },
  });

let bucketReady: Promise<void> | null = null;
/** Create the private bucket once (idempotent). */
function ensureBucket() {
  bucketReady ??= (async () => {
    const res = await sb(`/bucket/${env.storageBucket}`);
    if (res.ok) return;
    const created = await sb("/bucket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: env.storageBucket, name: env.storageBucket, public: false }),
    });
    if (!created.ok && created.status !== 409) throw new Error(`storage bucket: ${created.status} ${await created.text()}`);
  })().catch((e) => {
    bucketReady = null;
    throw e;
  });
  return bucketReady;
}

const root = () => resolve(env.storageDir);

export async function putObject(key: string, bytes: Uint8Array, contentType: string) {
  safeKey(key);
  if (usingSupabaseStorage()) {
    await ensureBucket();
    const res = await sb(`/object/${env.storageBucket}/${key}`, {
      method: "POST",
      headers: { "Content-Type": contentType, "x-upsert": "true", "Cache-Control": "private, max-age=0" },
      body: Buffer.from(bytes),
    });
    if (!res.ok) throw new Error(`storage upload: ${res.status} ${await res.text()}`);
    return;
  }
  const path = join(root(), key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

/** Read an object, honouring an HTTP Range header (so audio players can seek). Null if missing. */
export async function getObject(key: string, range?: string | null): Promise<StoredObject | null> {
  safeKey(key);
  if (usingSupabaseStorage()) {
    const res = await sb(`/object/authenticated/${env.storageBucket}/${key}`, { headers: range ? { Range: range } : {} });
    if (!res.ok || !res.body) return null;
    const headers: Record<string, string> = { "Accept-Ranges": "bytes" };
    for (const h of ["content-type", "content-length", "content-range"]) {
      const v = res.headers.get(h);
      if (v) headers[h] = v;
    }
    return { body: res.body, status: res.status === 206 ? 206 : 200, headers };
  }
  const path = resolve(join(root(), key));
  if (!path.startsWith(root() + "/")) return null;
  try {
    const s = await stat(path);
    return {
      body: Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>,
      status: 200,
      headers: { "content-length": String(s.size) },
    };
  } catch {
    return null;
  }
}

export async function removeObjects(keys: string[]) {
  if (!keys.length) return;
  keys.forEach(safeKey);
  if (usingSupabaseStorage()) {
    const res = await sb(`/object/${env.storageBucket}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: keys }),
    });
    if (!res.ok) throw new Error(`storage delete: ${res.status}`);
    return;
  }
  await Promise.all(keys.map((k) => rm(join(root(), k), { force: true })));
}
