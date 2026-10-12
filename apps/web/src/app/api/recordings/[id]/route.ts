import { signPayload, verifyPayload } from "@cloudivoice/core/crypto";
import { withTenant } from "@cloudivoice/core/db/client";
import { env } from "@cloudivoice/core/env";
import { can } from "@cloudivoice/core/services/auth";
import { getObject, usingSupabaseStorage } from "@cloudivoice/core/storage";
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
  const range = req.headers.get("range");
  const respond = (body: ReadableStream<Uint8Array>, status: number, extra: Record<string, string | null>) =>
    new Response(body, {
      status,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, no-store",
        ...(Object.fromEntries(Object.entries(extra).filter(([, v]) => v)) as Record<string, string>),
        ...(download ? { "Content-Disposition": `attachment; filename="call-${id.slice(0, 8)}.mp3"` } : {}),
      },
    });

  // Supabase Storage, or local disk on the same machine as the voice gateway.
  const obj = await getObject(row.recording_key, range).catch(() => null);
  if (obj) return respond(obj.body, obj.status, { ...obj.headers, "content-type": null });
  if (usingSupabaseStorage()) return new Response("Not found", { status: 404 });

  // Local storage on a separate voice host: stream it from there.
  const token = signPayload({ kind: "recording", key: row.recording_key }, 60);
  const upstream = await fetch(`${env.voiceUrl}/internal/recording?token=${encodeURIComponent(token)}`, {
    cache: "no-store",
    headers: range ? { Range: range } : {},
  }).catch(() => null);
  if (!upstream?.ok || !upstream.body) return new Response("Not found", { status: 404 });
  return respond(upstream.body, upstream.status, {
    "content-length": upstream.headers.get("content-length"),
    "content-range": upstream.headers.get("content-range"),
    "accept-ranges": upstream.headers.get("accept-ranges"),
  });
}
