import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { signPayload, verifyPayload } from "@cloudivoice/core/crypto";
import { withTenant } from "@cloudivoice/core/db/client";
import { env } from "@cloudivoice/core/env";
import { can } from "@cloudivoice/core/services/auth";
import { currentUser } from "@/lib/session";

/**
 * Private recording playback. Requires both a signed-in user with permission
 * and a short-lived signature issued for this call.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user?.orgId || !user.role || !can(user.role, "recordings.listen")) return new Response("Forbidden", { status: 403 });
  const sig = new URL(req.url).searchParams.get("sig") ?? "";
  const claims = verifyPayload<{ callId: string; orgId: string }>(sig);
  if (!claims || claims.callId !== id || claims.orgId !== user.orgId) return new Response("Link expired", { status: 403 });
  const [row] = await withTenant(user.orgId, (tx) => tx<{ recording_key: string | null }[]>`select recording_key from calls where id = ${id}`);
  if (!row?.recording_key) return new Response("Not found", { status: 404 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  const headers = (size: string | null) => ({
    "Content-Type": "audio/mpeg",
    ...(size ? { "Content-Length": size } : {}),
    "Cache-Control": "private, no-store",
    ...(download ? { "Content-Disposition": `attachment; filename="call-${id.slice(0, 8)}.mp3"` } : {}),
  });

  // Same machine as the voice gateway (local/dev): read the file directly.
  const root = resolve(env.storageDir);
  const path = resolve(join(root, row.recording_key));
  if (!path.startsWith(root + "/")) return new Response("Not found", { status: 404 });
  try {
    const s = await stat(path);
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { headers: headers(String(s.size)) });
  } catch {
    /* not on this machine */
  }

  // Separate hosts: stream it from the voice gateway's private storage.
  const token = signPayload({ kind: "recording", key: row.recording_key }, 60);
  const upstream = await fetch(`${env.voiceUrl}/internal/recording?token=${encodeURIComponent(token)}`, { cache: "no-store" }).catch(() => null);
  if (!upstream?.ok || !upstream.body) return new Response("Not found", { status: 404 });
  return new Response(upstream.body, { headers: headers(upstream.headers.get("content-length")) });
}
