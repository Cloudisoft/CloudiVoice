import { NextResponse } from "next/server";
import { z } from "zod";
import { signPayload } from "@cloudivoice/core/crypto";
import { withTenant } from "@cloudivoice/core/db/client";
import { env, liveStackStatus } from "@cloudivoice/core/env";
import { can } from "@cloudivoice/core/services/auth";
import { rateLimit } from "@cloudivoice/core/services/system";
import { currentUser } from "@/lib/session";

/** Token for a browser test session with one of the organization's own agents. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user?.orgId || !user.role || !can(user.role, "calls.test")) return NextResponse.json({ error: "You don't have permission to test agents." }, { status: 403 });
  if (!liveStackStatus().browserDemo) return NextResponse.json({ error: "The voice engine isn't configured yet." }, { status: 503 });
  const parsed = z.object({ agentId: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const rl = await rateLimit(`agent-test:${user.userId}`, 20, 3600);
  if (!rl.ok) return NextResponse.json({ error: "Test session limit reached for this hour." }, { status: 429 });
  const agent = await withTenant(user.orgId, (tx) => tx`select id from agents where id = ${parsed.data.agentId}`);
  if (!agent.length) return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  const maxSeconds = 600;
  const token = signPayload({ kind: "agent", orgId: user.orgId, agentId: parsed.data.agentId, userId: user.userId, maxSeconds }, 60);
  return NextResponse.json({ token, url: `${env.voiceUrl.replace(/^http/, "ws")}/demo`, maxSeconds });
}
