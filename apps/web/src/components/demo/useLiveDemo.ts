"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type LiveStatus = "idle" | "requesting" | "connecting" | "listening" | "processing" | "speaking" | "ended" | "error";

export interface LiveLine {
  id: number;
  speaker: "agent" | "caller";
  text: string;
  atMs: number;
}

interface SessionResponse {
  token?: string;
  url?: string;
  maxSeconds?: number;
  error?: string;
}

const TARGET_RATE = 16000;

/** Browser side of a live demo: microphone → voice engine → speaker. */
export function useLiveDemo() {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [lines, setLines] = useState<LiveLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [endReason, setEndReason] = useState<string | null>(null);
  const levels = useRef({ mic: 0, agent: 0 });

  const ws = useRef<WebSocket | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const nextTime = useRef(0);
  const outAnalyser = useRef<AnalyserNode | null>(null);
  const timer = useRef<number | null>(null);
  const lineId = useRef(0);

  const teardown = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    try {
      ws.current?.close();
    } catch {
      /* ignore */
    }
    ws.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    sources.current.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* ignore */
      }
    });
    sources.current = [];
    void ctx.current?.close().catch(() => {});
    ctx.current = null;
    levels.current = { mic: 0, agent: 0 };
  }, []);

  useEffect(() => teardown, [teardown]);

  const clearPlayback = () => {
    sources.current.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* ignore */
      }
    });
    sources.current = [];
    nextTime.current = ctx.current?.currentTime ?? 0;
  };

  const playPcm = (buf: ArrayBuffer) => {
    const ac = ctx.current;
    if (!ac || !outAnalyser.current) return;
    const pcm = new Int16Array(buf);
    if (!pcm.length) return;
    const audio = ac.createBuffer(1, pcm.length, TARGET_RATE);
    const ch = audio.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i]! / 32768;
    const src = ac.createBufferSource();
    src.buffer = audio;
    src.connect(outAnalyser.current);
    const at = Math.max(ac.currentTime + 0.04, nextTime.current);
    src.start(at);
    nextTime.current = at + audio.duration;
    sources.current.push(src);
    src.onended = () => {
      sources.current = sources.current.filter((s) => s !== src);
    };
  };

  const start = useCallback(
    async (body: Record<string, string>, endpoint = "/api/demo/session") => {
      teardown();
      setLines([]);
      setError(null);
      setNotice(null);
      setEndReason(null);
      setStatus("requesting");

      let session: SessionResponse;
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        session = (await res.json()) as SessionResponse;
        if (!res.ok || !session.token || !session.url) throw new Error(session.error ?? "The live session is unavailable right now.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "The live demo is unavailable right now.");
        setStatus("error");
        return;
      }

      try {
        stream.current = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        });
      } catch {
        setError("Microphone access was blocked. Allow microphone access in your browser to talk to the agent.");
        setStatus("error");
        return;
      }

      const ac = new AudioContext();
      ctx.current = ac;
      await ac.resume();
      outAnalyser.current = ac.createAnalyser();
      outAnalyser.current.fftSize = 512;
      outAnalyser.current.connect(ac.destination);
      nextTime.current = ac.currentTime;

      await ac.audioWorklet.addModule("/worklets/pcm-capture.js");
      const mic = ac.createMediaStreamSource(stream.current);
      const capture = new AudioWorkletNode(ac, "pcm-capture");
      mic.connect(capture);
      const ratio = ac.sampleRate / TARGET_RATE;
      let pending: number[] = [];
      capture.port.onmessage = (e: MessageEvent<Float32Array>) => {
        const input = e.data;
        let peak = 0;
        // Downsample to 16 kHz by averaging (anti-aliasing box filter).
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
        levels.current.mic = levels.current.mic * 0.6 + peak * 0.4;
        if (pending.length >= 640 && ws.current?.readyState === WebSocket.OPEN) {
          const out = new Int16Array(pending.length);
          for (let i = 0; i < pending.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(pending[i]! * 32767)));
          ws.current.send(out.buffer);
          pending = [];
        }
      };

      const levelBuf = new Uint8Array(outAnalyser.current.fftSize);
      const sampleLevels = () => {
        if (!outAnalyser.current || !ctx.current) return;
        outAnalyser.current.getByteTimeDomainData(levelBuf);
        let peak = 0;
        for (const v of levelBuf) peak = Math.max(peak, Math.abs(v - 128) / 128);
        levels.current.agent = levels.current.agent * 0.6 + peak * 0.4;
        requestAnimationFrame(sampleLevels);
      };
      requestAnimationFrame(sampleLevels);

      setStatus("connecting");
      const socket = new WebSocket(`${session.url}?token=${encodeURIComponent(session.token)}`);
      socket.binaryType = "arraybuffer";
      ws.current = socket;
      const max = session.maxSeconds ?? 120;
      setRemaining(max);
      const startedAt = Date.now();
      timer.current = window.setInterval(() => {
        const left = Math.max(0, max - Math.floor((Date.now() - startedAt) / 1000));
        setRemaining(left);
        if (left <= 0 && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "end" }));
      }, 500);

      socket.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) return playPcm(ev.data);
        let msg: { type: string; status?: LiveStatus; speaker?: "agent" | "caller"; text?: string; atMs?: number; reason?: string; message?: string };
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        switch (msg.type) {
          case "status":
            if (msg.status && msg.status !== "ended") setStatus(msg.status);
            break;
          case "transcript":
            if (msg.text && msg.speaker) {
              const line: LiveLine = { id: ++lineId.current, speaker: msg.speaker, text: msg.text, atMs: msg.atMs ?? 0 };
              setLines((l) => [...l, line].slice(-60));
            }
            break;
          case "clear":
            clearPlayback();
            break;
          case "notice":
            setNotice(msg.message ?? null);
            break;
          case "ended":
            setEndReason(msg.reason ?? "ended");
            setStatus("ended");
            break;
          case "error":
            setError(msg.message ?? "Something went wrong.");
            setStatus("error");
            break;
        }
      };
      socket.onerror = () => {
        setError("We couldn't reach the voice engine. Check your connection and try again.");
        setStatus("error");
      };
      socket.onclose = () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        if (timer.current) window.clearInterval(timer.current);
        setStatus((s) => (s === "error" ? s : "ended"));
      };
    },
    [teardown],
  );

  const end = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ type: "end" }));
    else teardown();
  }, [teardown]);

  const reset = useCallback(() => {
    teardown();
    setLines([]);
    setError(null);
    setNotice(null);
    setEndReason(null);
    setStatus("idle");
  }, [teardown]);

  return { status, lines, error, notice, remaining, endReason, levels, start, end, reset };
}
