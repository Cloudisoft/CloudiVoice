/**
 * Supervisor access to calls in progress: listen live, take over the call
 * (barge in) and hand it back to the agent.
 *
 * Calls register here while their media stream is open. The registry is
 * in-process, so a supervisor must reach the same gateway instance that
 * carries the call (single replica, or sticky routing by call id).
 *
 * Monitor socket protocol
 *   gateway → browser  binary  [tag:u8][PCM16 LE mono @ rate]  tag 1 caller, 2 agent, 3 supervisor
 *                      json    hello | partial | clear | barge | ended
 *   browser → gateway  json    {type:"barge"} | {type:"handback"}
 *                      binary  PCM16 LE mono @ 16 kHz (only while barged in)
 */
import type WebSocket from "ws";
import { resample, TurnDetector } from "@cloudivoice/core/audio";
import type { AudioSink, Conversation } from "./conversation";
import { transcribeSegment } from "./realtime";
import { log } from "./log";

export type MonitorClaims = {
  kind: "monitor";
  orgId: string;
  callId: string;
  userId: string;
  name: string;
  canBarge: boolean;
};

export interface LiveCallHooks {
  /** Something a supervisor said to the caller (transcribed). */
  onSupervisorLine(text: string, atMs: number): void;
  onSupervisorEvent(type: "supervisor_joined" | "supervisor_left" | "supervisor_listening", payload: Record<string, unknown>): void;
}

const TAG = { caller: 1, agent: 2, supervisor: 3 } as const;
const MAX_BUFFERED = 512 * 1024; // drop audio for a monitor that can't keep up

const calls = new Map<string, LiveCall>();

export function getLiveCall(callId: string) {
  return calls.get(callId);
}

export class LiveCall {
  conv: Conversation | null = null;
  readonly sink: AudioSink;
  private readonly monitors = new Set<WebSocket>();
  private barger: { ws: WebSocket; name: string; userId: string } | null = null;
  private supVad = new TurnDetector({ sampleRate: 16000, endSilenceMs: 600, minSpeechMs: 250 });
  private readonly startedAt = Date.now();

  constructor(
    readonly callId: string,
    readonly orgId: string,
    private readonly real: AudioSink,
    private readonly hooks: LiveCallHooks,
  ) {
    const self = this;
    // Monitors hear exactly what the caller hears.
    this.sink = {
      get sampleRate() {
        return real.sampleRate;
      },
      play(pcm) {
        real.play(pcm);
        self.broadcast(TAG.agent, pcm);
      },
      clear() {
        real.clear();
        self.broadcastJson({ type: "clear" });
      },
      drained: () => real.drained(),
      remainingMs: () => real.remainingMs?.() ?? 0,
    };
    calls.set(callId, this);
  }

  get rate() {
    return this.real.sampleRate;
  }

  /** Caller audio as received from the line. */
  caller(pcm: Int16Array) {
    this.broadcast(TAG.caller, pcm);
  }

  /** In-progress caller words, for a live transcript that updates as they speak. */
  partial(text: string) {
    this.broadcastJson({ type: "partial", text });
  }

  attach(ws: WebSocket, claims: MonitorClaims) {
    this.monitors.add(ws);
    const send = (m: Record<string, unknown>) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
    send({ type: "hello", rate: this.rate, barged: this.barger ? this.barger.name : null, canBarge: claims.canBarge });
    this.hooks.onSupervisorEvent("supervisor_listening", { by: claims.userId });

    ws.on("message", (raw, isBinary) => {
      if (isBinary) {
        if (this.barger?.ws !== ws) return;
        const buf = raw as Buffer;
        if (buf.length < 2 || buf.length > 32000) return;
        const pcm16k = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + (buf.length & ~1)));
        this.supervisorAudio(pcm16k);
        return;
      }
      let msg: { type?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === "barge" && claims.canBarge) this.takeOver(ws, claims);
      else if (msg.type === "handback" && this.barger?.ws === ws) this.handBack();
    });
    ws.on("close", () => {
      this.monitors.delete(ws);
      if (this.barger?.ws === ws) this.handBack();
    });
  }

  private takeOver(ws: WebSocket, claims: MonitorClaims) {
    if (this.barger || !this.conv || this.conv.isEnded) return;
    this.barger = { ws, name: claims.name, userId: claims.userId };
    this.conv.pause();
    this.supVad.reset();
    this.broadcastJson({ type: "barge", by: claims.name });
    this.hooks.onSupervisorEvent("supervisor_joined", { by: claims.userId, name: claims.name });
    log.info("supervisor took over", { callId: this.callId });
  }

  private handBack() {
    const b = this.barger;
    if (!b) return;
    this.barger = null;
    this.broadcastJson({ type: "barge", by: null });
    this.hooks.onSupervisorEvent("supervisor_left", { by: b.userId, name: b.name });
    this.conv?.resume(
      "A human supervisor from the team just spoke with the caller directly (see the transcript above) and has handed the call back to you. Continue naturally from where they left off; don't greet again or repeat what was already settled.",
    );
  }

  private supervisorAudio(pcm16k: Int16Array) {
    const out = this.rate === 16000 ? pcm16k : resample(pcm16k, 16000, this.rate);
    this.real.play(out);
    this.broadcast(TAG.supervisor, out);
    // Transcribe what the supervisor says so the call record stays complete.
    for (const ev of this.supVad.push(pcm16k)) {
      if (ev.type !== "utterance") continue;
      const atMs = Date.now() - this.startedAt - ev.durationMs;
      transcribeSegment(ev.pcm, 16000)
        .then((t) => t.text.trim() && this.hooks.onSupervisorLine(t.text.trim(), atMs))
        .catch((e) => log.warn("supervisor transcription failed", { err: String(e) }));
    }
  }

  private broadcast(tag: number, pcm: Int16Array) {
    if (!this.monitors.size) return;
    const frame = Buffer.allocUnsafe(1 + pcm.byteLength);
    frame[0] = tag;
    Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(frame, 1);
    for (const ws of this.monitors) {
      if (ws.readyState === ws.OPEN && ws.bufferedAmount < MAX_BUFFERED) ws.send(frame, { binary: true });
    }
  }

  private broadcastJson(m: Record<string, unknown>) {
    const s = JSON.stringify(m);
    for (const ws of this.monitors) if (ws.readyState === ws.OPEN) ws.send(s);
  }

  /** The call ended: tell every monitor and forget it. */
  close() {
    if (calls.get(this.callId) === this) calls.delete(this.callId);
    this.broadcastJson({ type: "ended" });
    for (const ws of this.monitors) setTimeout(() => ws.close(), 200);
    this.monitors.clear();
    this.barger = null;
  }
}

/** A supervisor's browser connected to /monitor. */
export function handleMonitor(ws: WebSocket, claims: MonitorClaims) {
  const call = calls.get(claims.callId);
  if (!call || call.orgId !== claims.orgId) {
    ws.send(JSON.stringify({ type: "unavailable" }));
    ws.close();
    return;
  }
  call.attach(ws, claims);
}
