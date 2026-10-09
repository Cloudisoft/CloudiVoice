import { NextResponse } from "next/server";
import { z } from "zod";
import { signPayload } from "@cloudivoice/core/crypto";
import { getDemoScenario } from "@cloudivoice/core/demoScenarios";
import { env, liveStackStatus } from "@cloudivoice/core/env";
import { languageStatus } from "@cloudivoice/core/languages";
import { demoAllowance, hashIp, rateLimit, startDemoSession } from "@cloudivoice/core/services/system";
import { ensureMigrated } from "@/lib/db";
import { requestMeta } from "@/lib/session";

const body = z.object({ scenario: z.string().max(40), language: z.string().max(10) });

/** Issue a short-lived token for one live browser demo session. */
export async function POST(req: Request) {
  if (!liveStackStatus().browserDemo) {
    return NextResponse.json({ error: "Live demos aren't available right now. Listen to a sample call or create a free account." }, { status: 503 });
  }
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { scenario, language } = parsed.data;
  if (!getDemoScenario(scenario)) return NextResponse.json({ error: "Unknown scenario." }, { status: 400 });
  if (languageStatus(language) !== "available") {
    return NextResponse.json({ error: "That language is still in validation. Please choose Hindi or English." }, { status: 400 });
  }

  await ensureMigrated();
  const { ip } = await requestMeta();
  const ipHash = hashIp(ip ?? "unknown");
  const burst = await rateLimit(`demo-burst:${ipHash}`, 3, 60);
  if (!burst.ok) return NextResponse.json({ error: "Please wait a minute before starting another session." }, { status: 429 });
  const allowance = await demoAllowance(ipHash);
  if (!allowance.ok) return NextResponse.json({ error: allowance.reason }, { status: 429 });

  const sid = await startDemoSession(ipHash, language, scenario);
  const maxSeconds = env.demoMaxSeconds;
  const token = signPayload({ kind: "demo", sid, scenario, language, maxSeconds }, 60);
  return NextResponse.json({ token, url: `${env.voiceUrl.replace(/^http/, "ws")}/demo`, maxSeconds });
}
