"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type MonitorState = "idle" | "connecting" | "listening" | "barged" | "ended" | "error";

const TAGS = { 1: "caller", 2: "agent", 3: "supervisor" } as const;
type Track = (typeof TAGS)[keyof typeof TAGS];
const MIC_RATE = 16000;

/**
 * Supervisor side of a live call: hear both sides in real time, take over
 * the conversation from the agent, and hand it back.
 */
export function useCallMonitor() {
  const [state, setState] = useState<MonitorState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState("");
  const [bargedBy, setBargedBy] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const mutedRef = useRef(false);
  const setMuted = useCallback((m: boolean) => {
    mutedRef.current = m;
    setMutedState(m);
  }, []);
  const levels = useRef<Record<Track, number>>({ caller: 0, agent: 0, supervisor: 0 });

  const ws = useRef<WebSocket | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const out = useRef<GainNode | null>(null);
  const rate = useRef(8000);
  const cursor = useRef<Record<Track, number>>({ caller: 0, agent: 0, supervisor: 0 });
  const agentSources = useRef<AudioBufferSourceNode[]>([]);
  const mic = useRef<MediaStream | null>(null);
  const capture = useRef<AudioWorkletNode | null>(null);
  const self = useRef(false); // this browser is the one barged in

  const stopMic = () => {
    capture.current?.disconnect();
    capture.current = null;
    mic.current?.getTracks().forEach((t) => t.stop());
    mic.current = null;
    self.current = false;
  };

  const stop = useCallback(() => {
    stopMic();
    try {
      ws.current?.close();
    } catch {
      /* ignore */
    }
    ws.current = null;
    void ctx.current?.close().catch(() => {});
    ctx.current = null;
    agentSources.current = [];
    setPartial("");
    setBargedBy(null);
    setState((s) => (s === "error" ? s : "idle"));
  }, []);

  useEffect(() => stop, [stop]);

  const play = (track: Track, pcm: Int16Array) => {
    const ac = ctx.current;
    if (!ac || !out.current || !pcm.length) return;
    let peak = 0;
    const buf = ac.createBuffer(1, pcm.length, rate.current);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) {
      ch[i] = pcm[i]! / 32768;
      peak = Math.max(peak, Math.abs(ch[i]!));
    }
    levels.current[track] = Math.max(levels.current[track] * 0.7, peak);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(out.current);
    // Small jitter buffer; each side keeps its own timeline so they overlap naturally.
    const at = Math.max(ac.currentTime + 0.12, cursor.current[track]);
    src.start(at);
    cursor.current[track] = at + buf.duration;
    if (track === "agent") {
      agentSources.current.push(src);
      src.onended = () => (agentSources.current = agentSources.current.filter((s) => s !== src));
    }
  };

  const listen = useCallback(
    async (callId: string) => {
      stop();
      setError(null);
      setState("connecting");
      let session: { token?: string; url?: string; error?: string };
      try {
        const res = await fetch("/api/live/monitor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ callId }) });
        session = (await res.json()) as typeof session;
        if (!res.ok || !session.token || !session.url) throw new Error(session.error ?? "Live listening is unavailable right now.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Live listening is unavailable right now.");
        setState("error");
        return;
      }
      const ac = new AudioContext();
      ctx.current = ac;
      await ac.resume();
      out.current = ac.createGain();
      out.current.connect(ac.destination);

      const socket = new WebSocket(`${session.url}?token=${encodeURIComponent(session.token)}`);
      socket.binaryType = "arraybuffer";
      ws.current = socket;
      socket.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(ev.data);
          const track = TAGS[bytes[0] as 1 | 2 | 3];
          if (!track || bytes.length < 3) return;
          if (track === "supervisor" && self.current) return; // don't hear yourself
          const pcm = new Int16Array(ev.data.slice(1, 1 + ((bytes.length - 1) & ~1)));
          return play(track, pcm);
        }
        let msg: { type: string; rate?: number; text?: string; by?: string | null; barged?: string | null };
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        if (msg.type === "hello") {
          rate.current = msg.rate ?? 8000;
          setBargedBy(msg.barged ?? null);
          setState("listening");
        } else if (msg.type === "partial") setPartial(msg.text ?? "");
        else if (msg.type === "clear") {
          agentSources.current.forEach((s) => {
            try {
              s.stop();
            } catch {
              /* ignore */
            }
          });
          agentSources.current = [];
          cursor.current.agent = 0;
        } else if (msg.type === "barge") {
          setBargedBy(msg.by ?? null);
          if (!msg.by && self.current) stopMic();
          setState(self.current ? "barged" : "listening");
        } else if (msg.type === "ended" || msg.type === "unavailable") {
          stopMic();
          setState("ended");
          setPartial("");
        }
      };
      socket.onclose = () => {
        stopMic();
        setState((s) => (s === "connecting" ? "error" : s === "listening" || s === "barged" ? "ended" : s));
      };
      socket.onerror = () => setError("Lost the live audio connection.");
    },
    [stop],
  );

  /** Take over the call: the agent goes quiet and the caller hears you. */
  const barge = useCallback(async () => {
    const ac = ctx.current;
    const socket = ws.current;
    if (!ac || !socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      mic.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch {
      setError("Microphone access was blocked. Allow the microphone to speak on the call.");
      return;
    }
    await ac.audioWorklet.addModule("/worklets/pcm-capture.js");
    const node = new AudioWorkletNode(ac, "pcm-capture");
    ac.createMediaStreamSource(mic.current).connect(node);
    capture.current = node;
    const ratio = ac.sampleRate / MIC_RATE;
    let pending: number[] = [];
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const input = e.data;
      let peak = 0;
      for (let pos = 0; pos + ratio <= input.length; pos += ratio) {
        let sum = 0;
        let n = 0;
        for (let j = Math.floor(pos); j < Math.floor(pos + ratio); j++) {
          sum += input[j]!;
          n++;
        }
        const v = n ? sum / n : 0;
        peak = Math.max(peak, Math.abs(v));
        pending.push(v);
      }
      levels.current.supervisor = Math.max(levels.current.supervisor * 0.7, peak);
      // 20 ms frames, like a phone line.
      while (pending.length >= 320) {
        const frame = pending.slice(0, 320);
        pending = pending.slice(320);
        const pcm = new Int16Array(320);
        const silent = mutedRef.current;
        for (let i = 0; i < 320; i++) pcm[i] = silent ? 0 : Math.max(-32768, Math.min(32767, Math.round(frame[i]! * 32767)));
        if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(pcm.buffer);
      }
    };
    self.current = true;
    socket.send(JSON.stringify({ type: "barge" }));
  }, []);

  /** Give the call back to the agent. */
  const handBack = useCallback(() => {
    ws.current?.send(JSON.stringify({ type: "handback" }));
    stopMic();
    setState("listening");
  }, []);

  return { state, error, partial, bargedBy, levels, listen, barge, handBack, stop, muted, setMuted };
}
