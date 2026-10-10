import { NextResponse } from "next/server";
import { z } from "zod";
import { signPayload } from "@cloudivoice/core/crypto";
import { withTenant } from "@cloudivoice/core/db/client";
import { env } from "@cloudivoice/core/env";
import { LIVE_STATES } from "@cloudivoice/core/callState";
import { audit } from "@cloudivoice/core/services/audit";
import { can } from "@cloudivoice/core/services/auth";
import { currentUser } from "@/lib/session";

/** Short-lived token to listen to (and, for supervisors, take over) a live call. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user?.orgId || !user.role || !can(user.role, "calls.supervise")) return NextResponse.json({ error: "Only supervisors can listen to live calls." }, { status: 403 });
  const parsed = z.object({ callId: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const orgId = user.orgId;
  const ok = await withTenant(orgId, async (tx) => {
    const [c] = await tx<{ state: string }[]>`select state from calls where id = ${parsed.data.callId}`;
    if (!c || !(LIVE_STATES as readonly string[]).includes(c.state)) return false;
    await audit(tx, orgId, user.userId, "call.monitored", { type: "call", id: parsed.data.callId });
    return true;
  });
  if (!ok) return NextResponse.json({ error: "This call has already ended." }, { status: 404 });
  const token = signPayload({ kind: "monitor", orgId, callId: parsed.data.callId, userId: user.userId, name: user.name, canBarge: true }, 60);
  return NextResponse.json({ token, url: `${env.voiceUrl.replace(/^http/, "ws")}/monitor` });
}
