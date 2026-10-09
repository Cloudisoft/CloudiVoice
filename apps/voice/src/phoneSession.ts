import type WebSocket from "ws";
import { parseAgentConfig, fillTemplate } from "@cloudivoice/core/agentConfig";
import { buildSystemPrompt, openingLine, templateVars, type CallContext } from "@cloudivoice/core/agentPrompt";
import { bytesToPcm16, mulawToPcm16 } from "@cloudivoice/core/audio";
import { summarizeCall, type ToolHost, type ToolName } from "@cloudivoice/core/brain";
import { withTenant } from "@cloudivoice/core/db/client";
import { env } from "@cloudivoice/core/env";
import { phoneForSpeech } from "@cloudivoice/core/phone";
import { addEvent, addTranscriptLine, transition } from "@cloudivoice/core/services/calls";
import { scheduleCallback } from "@cloudivoice/core/services/callbacks";
import { addDnc } from "@cloudivoice/core/services/leads";
import { searchKnowledge } from "@cloudivoice/core/services/knowledge";
import { clampToWindow } from "@cloudivoice/core/schedule";
import { telephony } from "@cloudivoice/core/telephony";
import { Conversation, type EndKind } from "./conversation";
import { TelephonySink } from "./sinks";
import { StreamingSynthesizer, StreamingTranscriber } from "./realtime";
import { log } from "./log";

const VOICEMAIL_GREETING =
  /(leave (a|your) message|after the (tone|beep)|not available|person you are trying to reach|number you have dial|switched off|not reachable|संदेश|उपलब्ध नहीं|स्विच ऑफ)/i;

interface CallSetup {
  orgId: string;
  callId: string;
}

/**
 * One phone call's media stream. Created when the carrier opens the
 * WebSocket; lives until the stream stops or the call ends.
 */
export function handlePhoneStream(ws: WebSocket, setup: CallSetup) {
  let streamId = "";
  let conv: Conversation | null = null;
  let providerCallId: string | null = null;
  let firstCallerLine = true;
  let transferNumber = "";
  let callerId = "";
  const format = env.telephonyStreamFormat;
  const sink = new TelephonySink(ws, () => streamId, format);
  const inputRate = format === "l16-16k" ? 16000 : 8000;

  const persist = (fn: Parameters<typeof withTenant>[1]) =>
    withTenant(setup.orgId, fn).catch((e) => log.error("persist failed", { callId: setup.callId, err: String(e) }));

  async function begin() {
    const data = await withTenant(setup.orgId, async (tx) => {
      const [call] = await tx<{
        state: string;
        direction: "outbound" | "inbound" | "test";
        agent_id: string | null;
        agent_version: number | null;
        lead_id: string | null;
        campaign_id: string | null;
        from_e164: string | null;
        to_e164: string | null;
        provider_call_id: string | null;
      }[]>`select state, direction, agent_id, agent_version, lead_id, campaign_id, from_e164, to_e164, provider_call_id from calls where id = ${setup.callId}`;
      if (!call?.agent_id) throw new Error("Call has no agent");
      const [v] = await tx<{ config: unknown }[]>`select config from agent_versions where agent_id = ${call.agent_id} and version = ${call.agent_version}`;
      const [org] = await tx<{ timezone: string; record_calls: boolean; recording_disclosure: string; calling_window_start: string; calling_window_end: string; calling_days: number[] }[]>`
        select timezone, record_calls, recording_disclosure, calling_window_start, calling_window_end, calling_days from organizations`;
      const [lead] = call.lead_id
        ? await tx<{ first_name: string | null; last_name: string | null; email: string | null; phone_e164: string; city: string | null; custom: Record<string, string>; attempts: number }[]>`
            select first_name, last_name, email, phone_e164, city, custom, attempts from leads where id = ${call.lead_id}`
        : [];
      const [cp] = call.campaign_id
        ? await tx<{ transfer_number: string | null; intro_name: string | null; voicemail_message: string | null }[]>`
            select transfer_number, intro_name, voicemail_message from campaigns where id = ${call.campaign_id}`
        : [];
      const returning =
        call.direction === "inbound" && call.lead_id
          ? (await tx`select 1 from calls where lead_id = ${call.lead_id} and id <> ${setup.callId} limit 1`).length > 0
          : false;
      await transition(tx, setup.callId, "in_progress");
      return { call, config: parseAgentConfig(v?.config), org: org!, lead, cp, returning };
    });

    providerCallId = data.call.provider_call_id;
    transferNumber = data.cp?.transfer_number || data.config.transfer_number || "";
    callerId = (data.call.direction === "inbound" ? data.call.to_e164 : data.call.from_e164) ?? "";
    const ctx: CallContext = {
      direction: data.call.direction,
      lead: data.lead
        ? { first_name: data.lead.first_name, last_name: data.lead.last_name, email: data.lead.email, phone: data.lead.phone_e164, city: data.lead.city, custom: data.lead.custom }
        : null,
      returningCaller: data.returning,
      introName: data.cp?.intro_name,
      timezone: data.org.timezone,
      canTransfer: Boolean(transferNumber),
    };
    let opening = openingLine(data.config, ctx);
    if (data.org.record_calls && data.config.recording_disclosure) opening = `${data.org.recording_disclosure} ${opening}`;
    const voicemailText = fillTemplate(data.cp?.voicemail_message || data.config.voicemail_message || "", templateVars(data.config, ctx));

    if (data.org.record_calls && providerCallId) {
      telephony()
        ?.startRecording(providerCallId, `${env.voiceUrl}/telephony/recording?callId=${setup.callId}`)
        .catch((e: unknown) => log.warn("recording start failed", { callId: setup.callId, err: String(e) }));
    }

    const tools: ToolHost = {
      enabled: [
        "end_call",
        "schedule_callback",
        "book_appointment",
        "save_caller_details",
        "add_to_dnc",
        "mark_qualified",
        "mark_disqualified",
        ...(data.config.knowledge_enabled ? (["lookup_knowledge"] as ToolName[]) : []),
        ...(transferNumber ? (["transfer_to_human"] as ToolName[]) : []),
      ],
      run: async (name, input) => {
        switch (name) {
          case "lookup_knowledge": {
            const hits = await withTenant(setup.orgId, (tx) => searchKnowledge(tx, String(input.query), data.call.agent_id));
            return hits.length ? hits.map((h) => h.content).join("\n---\n").slice(0, 3000) : "No matching information in the knowledge base.";
          }
          case "schedule_callback": {
            if (!data.call.lead_id) return "Noted. A team member will call back.";
            const when = clampToWindow(new Date(String(input.when_iso)), {
              timezone: data.org.timezone,
              start: data.org.calling_window_start,
              end: data.org.calling_window_end,
              days: data.org.calling_days,
            });
            if (Number.isNaN(when.getTime())) return "Could not understand the time. Ask the caller to confirm a date and time.";
            await withTenant(setup.orgId, (tx) =>
              scheduleCallback(tx, { orgId: setup.orgId, leadId: data.call.lead_id!, campaignId: data.call.campaign_id, callId: setup.callId, when, reason: String(input.note ?? ""), createdBy: "ai" }),
            );
            return `Callback scheduled for ${when.toLocaleString("en-IN", { timeZone: data.org.timezone })}.`;
          }
          case "save_caller_details": {
            if (data.call.lead_id) {
              await persist(async (tx) => {
                const name = typeof input.name === "string" ? input.name.trim().split(/\s+/) : null;
                await tx`update leads set
                  first_name = coalesce(${name?.[0] ?? null}, first_name),
                  last_name = coalesce(${name && name.length > 1 ? name.slice(1).join(" ") : null}, last_name),
                  email = coalesce(${typeof input.email === "string" ? input.email.toLowerCase() : null}, email),
                  city = coalesce(${(input.city as string) ?? null}, city),
                  pincode = coalesce(${typeof input.pincode === "string" ? input.pincode.replace(/\D/g, "").slice(0, 6) : null}, pincode),
                  custom = custom || ${tx.json(input.notes ? { ai_notes: String(input.notes).slice(0, 500) } : {})},
                  updated_at = now() where id = ${data.call.lead_id}`;
              });
            }
            return "Saved.";
          }
          case "add_to_dnc": {
            const phone = data.call.direction === "inbound" ? data.call.from_e164 : data.call.to_e164;
            if (phone) await persist((tx) => addDnc(tx, setup.orgId, phone, "Caller asked during call"));
            return "Added to the do-not-call list.";
          }
          case "book_appointment":
            return `Appointment noted for ${String(input.when_iso)}. The team will send a confirmation.`;
          case "transfer_to_human":
            return `Transferring now to a team member.`;
          default:
            return "Done.";
        }
      },
    };

    conv = new Conversation({
      system: buildSystemPrompt(data.config, ctx) + (data.lead ? `\nCaller's number for read-back: ${phoneForSpeech(data.lead.phone_e164)}` : ""),
      opening,
      language: data.config.primary_language,
      voice: data.config.voice,
      pace: data.config.pace,
      tools,
      inputSampleRate: inputRate,
      maxDurationSec: data.config.max_duration_sec,
      silenceCheckinSec: data.config.silence_checkin_sec,
      maxSilenceCheckins: data.config.max_silence_checkins,
      sink,
      transcriber: new StreamingTranscriber(inputRate),
      synthesizer: new StreamingSynthesizer(inputRate),
      hooks: {
        onTranscript: (l) => {
          void persist((tx) => addTranscriptLine(tx, setup.orgId, setup.callId, l.speaker, l.text, l.atMs, l.language));
          // Backup voicemail detector reading the first thing the line says.
          if (l.speaker === "caller" && firstCallerLine) {
            firstCallerLine = false;
            if (VOICEMAIL_GREETING.test(l.text) && data.call.direction !== "inbound") {
              void persist(async (tx) => {
                await addEvent(tx, setup.orgId, setup.callId, "machine_detection", { machine: true, source: "transcript" });
                await transition(tx, setup.callId, "voicemail");
              });
              if (voicemailText) void conv?.sayAndEnd(voicemailText, "agent_ended");
              else conv?.finish("agent_ended");
            }
          }
        },
        onTool: (t) => void persist((tx) => addEvent(tx, setup.orgId, setup.callId, "tool", { name: t.name, input: t.input, result: t.result.slice(0, 500), is_error: t.isError })),
        onTransfer: async () => {
          const adapter = telephony();
          if (!adapter || !providerCallId || !transferNumber) return false;
          try {
            await persist(async (tx) => {
              await transition(tx, setup.callId, "transferring");
              await tx`update calls set transfer_status = 'requested' where id = ${setup.callId}`;
            });
            await adapter.transfer(providerCallId, transferNumber, callerId, setup.callId);
            return true;
          } catch (e) {
            log.error("transfer failed", { callId: setup.callId, err: String(e) });
            await persist(async (tx) => {
              await tx`update calls set transfer_status = 'failed' where id = ${setup.callId}`;
              await transition(tx, setup.callId, "in_progress");
            });
            return false;
          }
        },
        onEnd: (kind: EndKind) => void onEnded(kind),
        onError: (e) => log.warn("conversation error", { callId: setup.callId, err: String(e) }),
      },
    });

    // If async machine detection already flagged voicemail, leave the message.
    if (data.call.state === "voicemail" && voicemailText) {
      await conv.sayAndEnd(voicemailText, "agent_ended");
      return;
    }
    await conv.start();
  }

  async function onEnded(kind: EndKind) {
    await persist(async (tx) => {
      await addEvent(tx, setup.orgId, setup.callId, "conversation_ended", { kind });
      if (kind !== "transferred" && kind !== "caller_hung_up") {
        await tx`update calls set end_reason = coalesce(end_reason, ${kind}) where id = ${setup.callId}`;
      }
    });
    // Agent-side endings hang up the line; the hangup webhook finalizes the call.
    if (kind !== "transferred" && kind !== "caller_hung_up" && providerCallId) {
      await sink.drained();
      await telephony()?.hangup(providerCallId).catch(() => {});
    }
    // Post-call summary + QA score (best effort, off the critical path).
    setTimeout(() => void summarize(), 4000);
  }

  async function summarize() {
    try {
      const lines = await withTenant(setup.orgId, (tx) => tx<{ speaker: string; text: string }[]>`select speaker, text from transcript_lines where call_id = ${setup.callId} order by id`);
      const s = await summarizeCall(lines);
      if (s) await persist((tx) => tx`update calls set summary = ${s.summary}, qa = ${tx.json({ score: s.score, notes: s.notes })} where id = ${setup.callId}`);
    } catch (e) {
      log.warn("summary failed", { callId: setup.callId, err: String(e) });
    }
  }

  ws.on("message", (raw, isBinary) => {
    if (isBinary) return;
    let msg: { event?: string; start?: { streamId: string; callId: string }; media?: { payload: string; track?: string }; streamId?: string };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (msg.event) {
      case "start":
        streamId = msg.start?.streamId ?? "";
        providerCallId = providerCallId ?? msg.start?.callId ?? null;
        begin().catch((e) => {
          log.error("call setup failed", { callId: setup.callId, err: String(e) });
          ws.close();
        });
        break;
      case "media": {
        if (!conv || !msg.media?.payload || (msg.media.track && msg.media.track !== "inbound")) return;
        const bytes = Buffer.from(msg.media.payload, "base64");
        conv.pushAudio(format === "l16-16k" ? bytesToPcm16(new Uint8Array(bytes)) : mulawToPcm16(new Uint8Array(bytes)));
        break;
      }
      case "stop":
        conv?.finish("caller_hung_up");
        break;
    }
  });
  ws.on("close", () => conv?.finish("caller_hung_up"));
  ws.on("error", (e) => log.warn("media socket error", { callId: setup.callId, err: String(e) }));
}
