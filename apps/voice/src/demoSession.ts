import type WebSocket from "ws";
import { buildSystemPrompt, openingLine } from "@cloudivoice/core/agentPrompt";
import { bytesToPcm16 } from "@cloudivoice/core/audio";
import { demoToolResult, getDemoScenario } from "@cloudivoice/core/demoScenarios";
import { endDemoSession } from "@cloudivoice/core/services/system";
import { parseAgentConfig } from "@cloudivoice/core/agentConfig";
import { withTenant, type Tx } from "@cloudivoice/core/db/client";
import type { EndReason } from "@cloudivoice/core/outcomes";
import { addEvent, addTranscriptLine, createCall, finalizeCall, transition } from "@cloudivoice/core/services/calls";
import { searchKnowledge } from "@cloudivoice/core/services/knowledge";
import { Conversation } from "./conversation";
import { BrowserSink } from "./sinks";
import { StreamingSynthesizer, StreamingTranscriber } from "./realtime";
import { log } from "./log";

export interface DemoClaims {
  kind: "demo";
  sid: string;
  scenario: string;
  language: string;
  maxSeconds: number;
}

/**
 * A live website demo: browser microphone ⇄ the real speech + reasoning
 * stack, using an isolated demo agent with synthetic data only.
 */
export function handleDemo(ws: WebSocket, claims: DemoClaims) {
  const scenario = getDemoScenario(claims.scenario);
  const send = (m: Record<string, unknown>) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
  if (!scenario) {
    send({ type: "error", message: "Unknown demo scenario." });
    ws.close();
    return;
  }
  const config = scenario.config(claims.language);
  const startedAt = Date.now();
  let lines = 0;

  const conv = new Conversation({
    system: buildSystemPrompt(config, { direction: "demo", canTransfer: false, isDemo: true }),
    opening: openingLine(config, { direction: "inbound", canTransfer: false }),
    language: claims.language,
    voice: config.voice,
    pace: config.pace,
    tools: {
      enabled: ["end_call", "book_appointment", "schedule_callback", "save_caller_details", "mark_qualified", "mark_disqualified", "add_to_dnc"],
      run: async (name, input) => demoToolResult(name, input),
    },
    inputSampleRate: 16000,
    maxDurationSec: claims.maxSeconds,
    silenceCheckinSec: 9,
    maxSilenceCheckins: 2,
    sink: new BrowserSink(ws),
    transcriber: new StreamingTranscriber(16000),
    synthesizer: new StreamingSynthesizer(16000),
    hooks: {
      onStatus: (status) => send({ type: "status", status }),
      onTranscript: (l) => {
        if (lines++ > 400) return;
        send({ type: "transcript", speaker: l.speaker, text: l.text, atMs: l.atMs, language: l.language });
      },
      onTool: (t) => send({ type: "tool", name: t.name, atMs: t.atMs }),
      onEnd: (reason) => {
        send({ type: "ended", reason });
        void endDemoSession(claims.sid, (Date.now() - startedAt) / 1000, reason);
        setTimeout(() => ws.close(), 1500);
      },
      onError: (e) => {
        log.warn("demo error", { sid: claims.sid, err: String(e) });
        send({ type: "notice", message: "The voice engine hiccuped — please repeat that." });
      },
    },
  });

  ws.on("message", (raw, isBinary) => {
    if (isBinary) {
      const buf = raw as Buffer;
      if (buf.length > 0 && buf.length <= 32000) conv.pushAudio(bytesToPcm16(new Uint8Array(buf)));
      return;
    }
    try {
      const msg = JSON.parse(raw.toString()) as { type?: string };
      if (msg.type === "end") conv.finish("caller_hung_up");
    } catch {
      /* ignore */
    }
  });
  ws.on("close", () => conv.finish("caller_hung_up"));

  send({ type: "ready", scenario: scenario.id, business: scenario.business, maxSeconds: claims.maxSeconds });
  conv.start().catch((e) => {
    log.error("demo start failed", { sid: claims.sid, err: String(e) });
    send({ type: "error", message: "The live demo couldn't start. Please try again in a moment." });
    conv.finish("error");
  });
}

export interface AgentTestClaims {
  kind: "agent";
  orgId: string;
  agentId: string;
  userId: string;
  maxSeconds: number;
}

/**
 * Browser test of an organization's own agent. Recorded as a "test" call so
 * the transcript, outcome and cost appear in Call Records like any call.
 */
export async function handleAgentTest(ws: WebSocket, claims: AgentTestClaims) {
  const send = (m: Record<string, unknown>) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
  const persist = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(claims.orgId, fn).catch((e) => {
      log.error("agent test persist failed", { err: String(e) });
      return undefined;
    });

  const setup = await persist(async (tx) => {
    const [agent] = await tx<{ current_version: number; config: unknown }[]>`
      select a.current_version, v.config from agents a join agent_versions v on v.agent_id = a.id and v.version = a.current_version where a.id = ${claims.agentId}`;
    if (!agent) return null;
    const [org] = await tx<{ timezone: string }[]>`select timezone from organizations`;
    const callId = await createCall(tx, { orgId: claims.orgId, direction: "test", agentId: claims.agentId, agentVersion: agent.current_version, from: null, to: null, state: "answered" });
    await transition(tx, callId, "in_progress");
    return { config: parseAgentConfig(agent.config), callId, timezone: org!.timezone };
  });
  if (!setup) {
    send({ type: "error", message: "Agent not found." });
    ws.close();
    return;
  }
  const { config, callId } = setup;
  const startedAt = Date.now();
  const ctx = { direction: "test" as const, canTransfer: false, timezone: setup.timezone };

  const conv = new Conversation({
    system: buildSystemPrompt(config, ctx),
    opening: openingLine(config, ctx),
    language: config.primary_language,
    voice: config.voice,
    pace: config.pace,
    tools: {
      enabled: ["end_call", "book_appointment", "schedule_callback", "save_caller_details", "mark_qualified", "mark_disqualified", ...(config.knowledge_enabled ? (["lookup_knowledge"] as const) : [])],
      run: async (name, input) => {
        if (name === "lookup_knowledge") {
          const hits = (await persist((tx) => searchKnowledge(tx, String(input.query), claims.agentId))) ?? [];
          return hits.length ? hits.map((h) => h.content).join("\n---\n").slice(0, 3000) : "No matching information in the knowledge base.";
        }
        return `${demoToolResult(name, input)} (test call — nothing was booked)`;
      },
    },
    inputSampleRate: 16000,
    maxDurationSec: Math.min(claims.maxSeconds, config.max_duration_sec),
    silenceCheckinSec: config.silence_checkin_sec,
    maxSilenceCheckins: config.max_silence_checkins,
    sink: new BrowserSink(ws),
    transcriber: new StreamingTranscriber(16000),
    synthesizer: new StreamingSynthesizer(16000),
    hooks: {
      onStatus: (status) => send({ type: "status", status }),
      onTranscript: (l) => {
        send({ type: "transcript", speaker: l.speaker, text: l.text, atMs: l.atMs, language: l.language });
        void persist((tx) => addTranscriptLine(tx, claims.orgId, callId, l.speaker, l.text, l.atMs, l.language));
      },
      onTool: (t) => {
        send({ type: "tool", name: t.name, atMs: t.atMs });
        void persist((tx) => addEvent(tx, claims.orgId, callId, "tool", { name: t.name, input: t.input, result: t.result.slice(0, 500), is_error: t.isError }));
      },
      onEnd: (reason) => {
        send({ type: "ended", reason });
        const duration = Math.round((Date.now() - startedAt) / 1000);
        void persist(async (tx) => {
          await transition(tx, callId, "completed", { endReason: reason === "caller_hung_up" ? "caller_hung_up" : reason === "error" ? "unknown" : (reason as EndReason), durationSec: duration });
          await finalizeCall(tx, callId);
        });
        setTimeout(() => ws.close(), 1500);
      },
      onError: (e) => {
        log.warn("agent test error", { callId, err: String(e) });
        send({ type: "notice", message: "The voice engine hiccuped — please repeat that." });
      },
    },
  });

  ws.on("message", (raw, isBinary) => {
    if (isBinary) {
      const buf = raw as Buffer;
      if (buf.length > 0 && buf.length <= 32000) conv.pushAudio(bytesToPcm16(new Uint8Array(buf)));
      return;
    }
    try {
      if ((JSON.parse(raw.toString()) as { type?: string }).type === "end") conv.finish("caller_hung_up");
    } catch {
      /* ignore */
    }
  });
  ws.on("close", () => conv.finish("caller_hung_up"));
  send({ type: "ready", maxSeconds: claims.maxSeconds });
  conv.start().catch((e) => {
    log.error("agent test start failed", { err: String(e) });
    send({ type: "error", message: "The test session couldn't start. Check the voice engine configuration." });
    conv.finish("error");
  });
}
