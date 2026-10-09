"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  agent: number[];
  caller: number[];
  durationMs: number;
  progressMs: number;
  onSeek: (ms: number) => void;
  label: string;
}

export function formatTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Dual-track call waveform (agent above, caller below) drawn from the real
 * recording's peaks. Played audio lights up as the playhead passes.
 * Works as an accessible slider for seeking.
 */
export function Waveform({ agent, caller, durationMs, progressMs, onSeek, label }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !size.w || !size.h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);

    const rulerH = 26;
    const plotH = size.h - rulerH;
    const laneA = plotH * 0.3;
    const laneB = plotH * 0.74;
    const laneAmp = plotH * 0.2;
    const progressX = durationMs ? (progressMs / durationMs) * size.w : 0;

    // Lane guides
    g.strokeStyle = "rgba(255,255,255,0.06)";
    g.lineWidth = 1;
    for (const y of [laneA, laneB]) {
      g.beginPath();
      g.moveTo(0, Math.round(y) + 0.5);
      g.lineTo(size.w, Math.round(y) + 0.5);
      g.stroke();
    }

    const bar = size.w < 480 ? 2 : 3;
    const gap = size.w < 480 ? 2 : 2;
    const step = bar + gap;
    const count = Math.floor(size.w / step);
    const grad = g.createLinearGradient(0, 0, size.w, 0);
    grad.addColorStop(0, "#fe3f14");
    grad.addColorStop(0.4, "#ff8a00");
    grad.addColorStop(0.75, "#fec701");
    grad.addColorStop(1, "#fdf500");

    const sample = (peaks: number[], i: number) => {
      if (!peaks.length) return 0;
      const a = Math.floor((i / count) * peaks.length);
      const b = Math.max(a + 1, Math.floor(((i + 1) / count) * peaks.length));
      let m = 0;
      for (let k = a; k < b && k < peaks.length; k++) m = Math.max(m, peaks[k]!);
      return m;
    };

    for (let i = 0; i < count; i++) {
      const x = i * step;
      const played = x < progressX;
      const va = sample(agent, i);
      const vb = sample(caller, i);
      if (va > 0.04) {
        const h = Math.max(2, va * laneAmp);
        g.fillStyle = played ? grad : "rgba(255,255,255,0.26)";
        g.fillRect(x, laneA - h, bar, h * 2);
      }
      if (vb > 0.04) {
        const h = Math.max(2, vb * laneAmp);
        g.fillStyle = played ? "#9fb4ff" : "rgba(159,180,255,0.28)";
        g.fillRect(x, laneB - h, bar, h * 2);
      }
    }

    // Ruler
    g.fillStyle = "rgba(255,255,255,0.08)";
    g.fillRect(0, plotH, size.w, 1);
    const secs = durationMs / 1000;
    const pxPerSec = size.w / Math.max(secs, 1);
    const labelEvery = pxPerSec * 5 < 46 ? 10 : 5;
    g.font = "10.5px ui-monospace, SFMono-Regular, Menlo, monospace";
    g.textBaseline = "top";
    for (let s = 0; s <= secs; s++) {
      const x = Math.round(s * pxPerSec) + 0.5;
      const major = s % labelEvery === 0;
      g.fillStyle = major ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.14)";
      g.fillRect(x, plotH, 1, major ? 7 : 4);
      if (major && s > 0 && x < size.w - 24) {
        g.fillStyle = "rgba(255,255,255,0.42)";
        g.fillText(String(s * 1000).padStart(5, "0"), x - 14, plotH + 10);
      }
    }

    // Hover guide
    if (hover !== null) {
      g.fillStyle = "rgba(255,255,255,0.18)";
      g.fillRect(Math.round(hover), 0, 1, plotH);
    }

    // Playhead
    if (progressMs > 0) {
      const x = Math.round(progressX) + 0.5;
      g.fillStyle = "rgba(255,255,255,0.75)";
      g.fillRect(x - 0.5, 8, 1, plotH - 8);
      g.fillRect(x - 3.5, 2, 7, 7);
    }
  }, [agent, caller, durationMs, progressMs, size, hover]);

  const msFromEvent = useCallback(
    (clientX: number) => {
      const rect = wrap.current!.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * durationMs;
    },
    [durationMs],
  );

  const onKey = (e: React.KeyboardEvent) => {
    const big = e.shiftKey ? 15000 : 5000;
    if (e.key === "ArrowRight") onSeek(Math.min(durationMs, progressMs + big));
    else if (e.key === "ArrowLeft") onSeek(Math.max(0, progressMs - big));
    else if (e.key === "Home") onSeek(0);
    else if (e.key === "End") onSeek(durationMs - 200);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={wrap}
      className="wave"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(durationMs / 1000)}
      aria-valuenow={Math.round(progressMs / 1000)}
      aria-valuetext={`${formatTime(progressMs)} of ${formatTime(durationMs)}`}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        onSeek(msFromEvent(e.clientX));
      }}
      onPointerMove={(e) => {
        const rect = wrap.current!.getBoundingClientRect();
        setHover(e.clientX - rect.left);
        if (e.buttons === 1) onSeek(msFromEvent(e.clientX));
      }}
      onPointerLeave={() => setHover(null)}
    >
      <canvas ref={canvas} style={{ width: "100%", height: "100%" }} aria-hidden="true" />
    </div>
  );
}

/** Rolling level scope for live sessions (agent above, caller below). */
export function LiveScope({ levels, active }: { levels: React.RefObject<{ mic: number; agent: number }>; active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const history = useRef<{ a: number; m: number }[]>([]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 40) return;
      last = t;
      const c = canvas.current;
      if (!c) return;
      const w = c.clientWidth;
      const h = c.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (c.width !== w * dpr) {
        c.width = w * dpr;
        c.height = h * dpr;
      }
      const g = c.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const step = 5;
      const max = Math.floor(w / step);
      const lv = levels.current ?? { mic: 0, agent: 0 };
      history.current.push({ a: active ? Math.min(1, lv.agent * 3) : 0, m: active ? Math.min(1, lv.mic * 4) : 0 });
      if (history.current.length > max) history.current.splice(0, history.current.length - max);
      g.clearRect(0, 0, w, h);
      const laneA = h * 0.3;
      const laneB = h * 0.74;
      const amp = h * 0.2;
      g.strokeStyle = "rgba(255,255,255,0.06)";
      for (const y of [laneA, laneB]) {
        g.beginPath();
        g.moveTo(0, Math.round(y) + 0.5);
        g.lineTo(w, Math.round(y) + 0.5);
        g.stroke();
      }
      const grad = g.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, "#fe3f14");
      grad.addColorStop(0.5, "#ff9a00");
      grad.addColorStop(1, "#fdf500");
      history.current.forEach((p, i) => {
        const x = w - (history.current.length - i) * step;
        if (p.a > 0.03) {
          const hh = Math.max(2, p.a * amp);
          g.fillStyle = grad;
          g.fillRect(x, laneA - hh, 3, hh * 2);
        }
        if (p.m > 0.03) {
          const hh = Math.max(2, p.m * amp);
          g.fillStyle = "#9fb4ff";
          g.fillRect(x, laneB - hh, 3, hh * 2);
        }
      });
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [levels, active]);

  return <canvas ref={canvas} className="wave" style={{ width: "100%", height: "100%" }} aria-hidden="true" />;
}
