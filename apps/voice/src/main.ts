/**
 * CloudiVoice voice gateway + worker.
 *  - HTTP webhooks from the telephony connection (signature-verified, stored first)
 *  - WebSocket media streams for phone calls and browser demos
 *  - Background loops: campaign dialer, reconciliation, recording backfill, retention
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import { db, withSystem, withTenant } from "@cloudivoice/core/db/client";
import { migrate } from "@cloudivoice/core/db/migrate";
import { env, liveStackStatus } from "@cloudivoice/core/env";
import { signPayload, verifyPayload } from "@cloudivoice/core/crypto";
import { normalizePhone } from "@cloudivoice/core/phone";
import { telephony } from "@cloudivoice/core/telephony";
import { createCall } from "@cloudivoice/core/services/calls";
import { dialerTick } from "@cloudivoice/core/services/dialer";
import { markWebhook, storeWebhook, acquireLease } from "@cloudivoice/core/services/system";
import { processTelephonyEvent, reconcileCalls, type TelephonyEventKind } from "@cloudivoice/core/services/telephonyEvents";
import { handlePhoneStream } from "./phoneSession";
import { handleAgentTest, handleDemo, type AgentTestClaims, type DemoClaims } from "./demoSession";
import { backfillRecordings, enforceRetention } from "./jobs";
import { fetchRecordingsNow } from "./postCall";
import { log } from "./log";

const PORT = Number(process.env.PORT ?? 8080);

async function readBody(req: IncomingMessage, limit = 256 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new Error("body too large");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, status: number, body: string, type = "text/plain") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

const xml = (res: ServerResponse, body: string) => send(res, 200, body, "application/xml");

function publicUrl(req: IncomingMessage) {
  return `${env.voiceUrl}${req.url ?? "/"}`;
}

/** Verify, store, then process a carrier webhook. */
async function intake(req: IncomingMessage, kind: TelephonyEventKind | "answer") {
  const raw = req.method === "POST" ? await readBody(req) : "";
  const url = new URL(publicUrl(req));
  const params: Record<string, string> = Object.fromEntries(new URLSearchParams(raw));
  const adapter = telephony();
  if (!adapter) throw Object.assign(new Error("telephony not configured"), { status: 503 });
  const headers = new Headers(Object.entries(req.headers).flatMap(([k, v]) => (v === undefined ? [] : [[k, Array.isArray(v) ? v.join(",") : v]])) as [string, string][]);
  if (!adapter.verifyWebhook({ method: req.method ?? "POST", url: url.toString(), headers, params })) {
    throw Object.assign(new Error("invalid signature"), { status: 403 });
  }
  const callId = url.searchParams.get("callId");
  return { params, callId, url };
}

async function handleEvent(req: IncomingMessage, res: ServerResponse, kind: TelephonyEventKind) {
  const { params, callId } = await intake(req, kind);
  const dedupe = `${kind}:${params.CallUUID ?? params.RequestUUID ?? callId ?? ""}:${params.Event ?? ""}:${params.RecordingID ?? params.StreamID ?? ""}:${params.CallStatus ?? ""}`;
  const id = await storeWebhook("telephony", kind, dedupe, { params, callId });
  if (id !== null) {
    try {
      await processTelephonyEvent(kind, params, callId);
      await markWebhook(id, null);
      if (kind === "recording") fetchRecordingsNow();
    } catch (e) {
      log.error("webhook processing failed", { kind, callId, err: String(e) });
      await markWebhook(id, e instanceof Error ? e.message : String(e));
    }
  }
  send(res, 200, "ok");
}

function streamXml(callId: string, orgId: string, maxSeconds: number, resume?: "transfer_failed") {
  const adapter = telephony()!;
  const token = signPayload({ kind: "call", callId, orgId, ...(resume ? { resume } : {}) }, 4 * 3600);
  const wsBase = env.voiceUrl.replace(/^http/, "ws");
  return adapter.streamResponse({
    streamUrl: `${wsBase}/media?token=${encodeURIComponent(token)}`,
    statusUrl: `${env.voiceUrl}/telephony/stream-status?callId=${callId}`,
    format: env.telephonyStreamFormat,
    maxSeconds,
    extra: { cv: callId.slice(0, 8) },
  });
}

/** Answer URL: outbound calls carry our callId; inbound calls are routed by number. */
async function handleAnswer(req: IncomingMessage, res: ServerResponse) {
  const { params, callId } = await intake(req, "answer");
  const adapter = telephony()!;
  if (callId) {
    const [call] = await db()<{ id: string; org_id: string; agent_id: string | null }[]>`select id, org_id, agent_id from calls where id = ${callId}`;
    if (!call) return xml(res, adapter.sayAndHangupResponse("Sorry, this call cannot be completed.", "en-IN"));
    await processTelephonyEvent("answer", params, callId).catch((e) => log.warn("answer event", { err: String(e) }));
    return xml(res, streamXml(call.id, call.org_id, 3700));
  }

  // Inbound
  const to = normalizePhone(params.To ?? "")?.e164;
  const from = normalizePhone(params.From ?? "")?.e164 ?? params.From ?? null;
  const [num] = to
    ? await db()<{ org_id: string; inbound_agent_id: string | null; voice_inbound: boolean; status: string }[]>`
        select org_id, inbound_agent_id, voice_inbound, status from phone_numbers where e164 = ${to}`
    : [];
  if (!num || !num.inbound_agent_id || !num.voice_inbound || num.status !== "active") {
    return xml(res, adapter.sayAndHangupResponse("Thank you for calling. We are unable to take your call right now. Please try again later.", "en-IN"));
  }
  const id = await withTenant(num.org_id, async (tx) => {
    const [agent] = await tx<{ current_version: number; status: string }[]>`select current_version, status from agents where id = ${num.inbound_agent_id}`;
    if (!agent || agent.status !== "active") return null;
    const [org] = await tx<{ timezone: string }[]>`select timezone from organizations`;
    let leadId: string | null = null;
    if (from) {
      const [lead] = await tx<{ id: string }[]>`select id from leads where phone_e164 = ${from}`;
      if (lead) leadId = lead.id;
      else {
        const p = normalizePhone(from);
        if (p) {
          const [l] = await tx<{ id: string }[]>`insert into leads (org_id, phone_e164, phone_digits, status, timezone) values (${num.org_id}, ${p.e164}, ${p.national}, 'inbound', ${org!.timezone}) returning id`;
          leadId = l!.id;
        }
      }
    }
    return createCall(tx, {
      orgId: num.org_id,
      direction: "inbound",
      agentId: num.inbound_agent_id,
      agentVersion: agent.current_version,
      leadId,
      from,
      to: to ?? null,
      providerCallId: params.CallUUID ?? null,
      state: "answered",
    });
  });
  if (!id) return xml(res, adapter.sayAndHangupResponse("Thank you for calling. Please try again later.", "en-IN"));
  return xml(res, streamXml(id, num.org_id, 3700));
}

/**
 * The bridged leg finished. If the person answered, the call is over; if
 * nobody picked up, the caller goes straight back to the agent instead of
 * being disconnected.
 */
async function handleTransferResult(req: IncomingMessage, res: ServerResponse) {
  const { params, callId } = await intake(req, "transfer_result");
  const dedupe = `transfer_result:${params.CallUUID ?? callId ?? ""}:${params.DialBLegUUID ?? ""}:${params.DialStatus ?? ""}`;
  const id = await storeWebhook("telephony", "transfer_result", dedupe, { params, callId });
  if (id !== null) {
    await processTelephonyEvent("transfer_result", params, callId)
      .then(() => markWebhook(id, null))
      .catch((e) => markWebhook(id, e instanceof Error ? e.message : String(e)));
  }
  const status = (params.DialStatus ?? params.DialBLegStatus ?? "").toLowerCase();
  const connected = status === "completed" || status === "answer" || status === "answered";
  const [call] = callId && /^[0-9a-f-]{36}$/i.test(callId) ? await db()<{ id: string; org_id: string; state: string }[]>`select id, org_id, state from calls where id = ${callId}` : [];
  if (connected || !call || ["completed", "failed"].includes(call.state)) return xml(res, telephony()!.hangupResponse());
  return xml(res, streamXml(call.id, call.org_id, 3700, "transfer_failed"));
}

async function handleTransferXml(req: IncomingMessage, res: ServerResponse) {
  const { url } = await intake(req, "answer");
  const to = normalizePhone(url.searchParams.get("to") ?? "");
  const from = url.searchParams.get("from") ?? "";
  const callId = url.searchParams.get("callId") ?? "";
  if (!to) return xml(res, telephony()!.sayAndHangupResponse("Sorry, the transfer could not be completed.", "en-IN"));
  return xml(res, telephony()!.transferResponse({ toE164: to.e164, callerId: from, actionUrl: `${env.voiceUrl}/telephony/transfer-result?callId=${callId}` }));
}

const server = createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  try {
    if (path === "/health") {
      await db()`select 1`;
      return send(res, 200, JSON.stringify({ ok: true, stack: liveStackStatus() }), "application/json");
    }
    if (req.method !== "POST" && req.method !== "GET") return send(res, 405, "method not allowed");
    switch (path) {
      case "/telephony/answer":
        return await handleAnswer(req, res);
      case "/telephony/ring":
        return await handleEvent(req, res, "ring");
      case "/telephony/hangup":
        return await handleEvent(req, res, "hangup");
      case "/telephony/machine":
        return await handleEvent(req, res, "machine");
      case "/telephony/recording":
        return await handleEvent(req, res, "recording");
      case "/telephony/stream-status":
        return await handleEvent(req, res, "stream_status");
      case "/telephony/transfer-xml":
        return await handleTransferXml(req, res);
      case "/telephony/transfer-result":
        return await handleTransferResult(req, res);
      default:
        return send(res, 404, "not found");
    }
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    log.error("request failed", { path, status, err: String(e) });
    if (!res.headersSent) send(res, status, status === 403 ? "forbidden" : "error");
  }
});

// One misbehaving call must never take the gateway (and every other call) down.
process.on("unhandledRejection", (e) => {
  // Cancelled reasoning requests (the caller kept talking) are expected.
  if (e instanceof Error && /aborted/i.test(e.message)) return;
  log.error("unhandled rejection", { err: String(e) });
});
process.on("uncaughtException", (e) => log.error("uncaught exception", { err: String(e) }));

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://x");
  const token = url.searchParams.get("token") ?? "";
  if (url.pathname === "/media") {
    const claims = verifyPayload<{ kind: string; callId: string; orgId: string; resume?: "transfer_failed" }>(token);
    if (!claims || claims.kind !== "call") return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => handlePhoneStream(ws, { callId: claims.callId, orgId: claims.orgId, resume: claims.resume }));
    return;
  }
  if (url.pathname === "/demo") {
    const origin = req.headers.origin ?? "";
    if (env.isProduction && origin && !origin.startsWith(env.appUrl)) return socket.destroy();
    const claims = verifyPayload<(DemoClaims | AgentTestClaims) & Record<string, unknown>>(token);
    if (!claims) return socket.destroy();
    if (claims.kind === "demo") wss.handleUpgrade(req, socket, head, (ws) => handleDemo(ws, claims as DemoClaims));
    else if (claims.kind === "agent") wss.handleUpgrade(req, socket, head, (ws) => void handleAgentTest(ws, claims as AgentTestClaims));
    else socket.destroy();
    return;
  }
  socket.destroy();
});

// ---------------------------------------------------------------------------
// Background loops
// ---------------------------------------------------------------------------
function every(ms: number, name: string, fn: () => Promise<unknown>) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (e) {
      log.error(`${name} failed`, { err: String(e) });
    } finally {
      running = false;
    }
  };
  setInterval(tick, ms).unref();
  setTimeout(tick, 2000).unref();
}

async function main() {
  await migrate(db(), (m) => log.info("migration", { m }));
  server.listen(PORT, () => log.info("voice gateway listening", { port: PORT, stack: liveStackStatus() }));
  if (process.env.DISABLE_WORKER !== "1") {
    every(5_000, "dialer", () => (telephony() ? dialerTick() : Promise.resolve()));
    every(60_000, "reconcile", () => (acquireLease("reconcile", env.workerId, 120).then((ok) => (ok ? reconcileCalls() : null))));
    every(60_000, "recordings", () => (acquireLease("recordings", env.workerId, 600).then((ok) => (ok ? backfillRecordings() : null))));
    every(6 * 3600_000, "retention", () => (acquireLease("retention", env.workerId, 3600).then((ok) => (ok ? enforceRetention() : null))));
  }
}

const shutdown = () => {
  log.info("shutting down");
  server.close();
  void withSystem(async () => {}).finally(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

main().catch((e) => {
  log.error("fatal", { err: String(e) });
  process.exit(1);
});
