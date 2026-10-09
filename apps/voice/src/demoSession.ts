import type WebSocket from "ws";
import { buildSystemPrompt, openingLine } from "@cloudivoice/core/agentPrompt";
import { bytesToPcm16 } from "@cloudivoice/core/audio";
import { demoToolResult, getDemoScenario } from "@cloudivoice/core/demoScenarios";
import { endDemoSession } from "@cloudivoice/core/services/system";
import { Conversation } from "./conversation";
import { BrowserSink } from "./sinks";
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
