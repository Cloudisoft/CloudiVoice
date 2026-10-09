"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Sample, SampleMeta } from "@/lib/samples";
import { formatTime, LiveScope, Waveform } from "./Waveform";
import { useLiveDemo, type LiveStatus } from "./useLiveDemo";
import "./demo.css";

export interface DemoLanguage {
  code: string;
  name: string;
  native: string;
  status: "available" | "in_validation";
}

export interface DemoScenarioInfo {
  id: string;
  label: string;
  business: string;
  blurb: string;
}

interface Props {
  initial: Sample;
  samples: SampleMeta[];
  scenarios: DemoScenarioInfo[];
  languages: DemoLanguage[];
  liveEnabled: boolean;
  liveMaxSeconds: number;
}

type PlayStatus = "idle" | "loading" | "playing" | "paused" | "completed" | "error";

const PLAY_LABEL: Record<PlayStatus, string> = {
  idle: "Ready",
  loading: "Loading",
  playing: "Playing",
  paused: "Paused",
  completed: "Completed",
  error: "Error",
};

const LIVE_LABEL: Record<LiveStatus, string> = {
  idle: "Ready",
  requesting: "Preparing",
  connecting: "Connecting",
  listening: "Listening",
  processing: "Thinking",
  speaking: "Speaking",
  ended: "Call ended",
  error: "Error",
};

function langShort(code: string) {
  return code.split("-")[0]!.toUpperCase();
}

export function DemoConsole({ initial, samples, scenarios, languages, liveEnabled, liveMaxSeconds }: Props) {
  const [all, setAll] = useState<Map<string, Sample>>(() => new Map([[initial.id, initial]]));
  const [sample, setSample] = useState<Sample>(initial);
  const [scenario, setScenario] = useState(initial.scenario);
  const [language, setLanguage] = useState(initial.language);
  const [status, setStatus] = useState<PlayStatus>("idle");
  const [now, setNow] = useState(0);
  const [mode, setMode] = useState<"sample" | "consent" | "live">("sample");
  const [consent, setConsent] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const raf = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const live = useLiveDemo();

  const langsForScenario = useMemo(() => new Set(samples.filter((s) => s.scenario === scenario).map((s) => s.language)), [samples, scenario]);
  const scenarioInfo = scenarios.find((s) => s.id === scenario) ?? scenarios[0]!;

  // Fetch the full manifest lazily (peaks + transcripts for other samples).
  const ensureAll = useCallback(async () => {
    if (all.size === samples.length) return all;
    const res = await fetch("/samples/manifest.json");
    const data = (await res.json()) as { samples: Sample[] };
    const map = new Map(data.samples.map((s) => [s.id, s]));
    setAll(map);
    return map;
  }, [all, samples.length]);

  const select = useCallback(
    async (nextScenario: string, nextLanguage: string) => {
      const exists = samples.some((s) => s.scenario === nextScenario && s.language === nextLanguage);
      const lang = exists ? nextLanguage : (samples.find((s) => s.scenario === nextScenario)?.language ?? nextLanguage);
      setScenario(nextScenario);
      setLanguage(lang);
      const meta = samples.find((s) => s.scenario === nextScenario && s.language === lang);
      if (!meta || meta.id === sample.id) return;
      audio.current?.pause();
      setStatus("loading");
      try {
        const map = await ensureAll();
        const next = map.get(meta.id);
        if (next) {
          setSample(next);
          setNow(0);
          setStatus("idle");
        }
      } catch {
        setStatus("error");
      }
    },
    [ensureAll, sample.id, samples],
  );

  const tick = useCallback(() => {
    const a = audio.current;
    if (a) setNow(a.currentTime * 1000);
    raf.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const play = useCallback(async () => {
    const a = audio.current;
    if (!a) return;
    if (mode !== "sample") {
      live.reset();
      setMode("sample");
    }
    try {
      if (status === "completed") a.currentTime = 0;
      setStatus((s) => (s === "idle" ? "loading" : s));
      await a.play();
    } catch {
      setStatus("error");
    }
  }, [live, mode, status]);

  const pause = () => audio.current?.pause();
  const toggle = () => (status === "playing" ? pause() : void play());
  const seek = (ms: number) => {
    const a = audio.current;
    if (!a) return;
    a.currentTime = ms / 1000;
    setNow(ms);
    if (status === "completed") setStatus("paused");
  };
  const restart = () => {
    seek(0);
    void play();
  };

  // "Hear it for yourself" buttons elsewhere on the page.
  useEffect(() => {
    const onPlay = () => {
      root.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      void play();
    };
    window.addEventListener("cv:play-sample", onPlay);
    return () => window.removeEventListener("cv:play-sample", onPlay);
  }, [play]);

  const current = useMemo(() => {
    let seg = null as Sample["segments"][number] | null;
    for (const s of sample.segments) if (s.startMs <= now + 120) seg = s;
    return seg;
  }, [sample, now]);
  const currentEvent = useMemo(() => {
    let ev = null as Sample["events"][number] | null;
    for (const e of sample.events) if (e.atMs <= now + 60 && now - e.atMs < 9000) ev = e;
    return ev;
  }, [sample, now]);
  const activeIndex = current ? sample.segments.indexOf(current) : -1;

  const startLive = async () => {
    audio.current?.pause();
    setMode("live");
    await live.start({ scenario, language });
  };

  const signupHref = `/signup?scenario=${encodeURIComponent(scenario)}&lang=${encodeURIComponent(language)}`;
  const isLive = mode === "live";
  const liveActive = isLive && ["connecting", "listening", "processing", "speaking"].includes(live.status);
  const statusText = isLive ? LIVE_LABEL[live.status] : PLAY_LABEL[status];
  const statusTone = isLive
    ? live.status === "error"
      ? "bad"
      : live.status === "speaking"
        ? "accent"
        : live.status === "listening"
          ? "ok"
          : "neutral"
    : status === "playing"
      ? "accent"
      : status === "error"
        ? "bad"
        : "neutral";

  return (
    <div
      ref={root}
      className="console"
      aria-label="Voice agent demo"
      role="region"
      onKeyDown={(e) => {
        if (mode !== "sample") return;
        const t = e.target as HTMLElement;
        if ((e.key === " " || e.key === "k") && !["BUTTON", "SELECT", "INPUT", "A"].includes(t.tagName) && t.getAttribute("role") !== "tab") {
          e.preventDefault();
          toggle();
        }
      }}
    >
      <div className="console-head">
        <div className="console-title">
          <span className={`dot dot-${statusTone}`} aria-hidden="true" />
          <span className="mono">cloudivoice/call-scope</span>
        </div>
        <span className="mono console-kind">{isLive ? "[live session]" : "[sample call]"}</span>
      </div>

      <div className="console-controls">
        <div className="scenario-tabs" role="tablist" aria-label="Scenario">
          {scenarios.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={s.id === scenario}
              className="scenario-tab"
              disabled={liveActive}
              onClick={() => void select(s.id, language)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="lang-select">
          <span className="sr-only">Language</span>
          <select
            className="select select-compact"
            value={language}
            disabled={liveActive}
            onChange={(e) => void select(scenario, e.target.value)}
            aria-describedby="lang-note"
          >
            {languages.map((l) => {
              const hasSample = langsForScenario.has(l.code);
              const usable = l.status === "available" && hasSample;
              return (
                <option key={l.code} value={l.code} disabled={!usable}>
                  {l.name}
                  {l.status !== "available" ? " — in validation" : !hasSample ? " — sample coming soon" : ""}
                </option>
              );
            })}
          </select>
        </label>
      </div>

      <div className="console-stage">
        <div className="lane-labels mono" aria-hidden="true">
          <span>agent</span>
          <span>caller</span>
        </div>
        {mode === "sample" && (
          <Waveform
            agent={sample.peaks.agent}
            caller={sample.peaks.caller}
            durationMs={sample.durationMs}
            progressMs={now}
            onSeek={seek}
            label={`Seek in sample call: ${scenarioInfo.label}`}
          />
        )}
        {isLive && <LiveScope levels={live.levels} active={liveActive} />}

        {mode === "sample" && (status === "idle" || status === "loading") && now === 0 && (
          <button className="big-play" onClick={() => void play()} aria-label={`Play sample call: ${scenarioInfo.label}, ${languages.find((l) => l.code === language)?.name}`}>
            <span className="big-play-circle" aria-hidden="true">
              {status === "loading" ? <span className="spinner" /> : <PlayIcon size={26} />}
            </span>
            <span className="big-play-label mono">Listen to the call</span>
          </button>
        )}

        {mode === "sample" && status === "completed" && (
          <div className="stage-overlay" role="status">
            <p className="overlay-title">Imagine what an AI agent could do for your business.</p>
            <div className="overlay-actions">
              <Link href={signupHref} className="btn btn-accent">
                Create your free agent <ArrowIcon />
              </Link>
              <button className="btn btn-ghost" onClick={restart}>
                <ReplayIcon /> Replay
              </button>
            </div>
          </div>
        )}

        {mode === "consent" && (
          <div className="consent" role="dialog" aria-modal="false" aria-labelledby="consent-title">
            <p id="consent-title" className="consent-title">
              Talk to {scenarioInfo.business}&rsquo;s agent
            </p>
            <ul className="consent-list">
              <li>Your browser will ask for microphone access. Audio is streamed to our voice engine only while the session is open.</li>
              <li>Sessions end automatically after {Math.round(liveMaxSeconds / 60)} minutes. Demo calls are not recorded or stored.</li>
              <li>The agent uses a fictional business and synthetic data. Don&rsquo;t share personal or payment details.</li>
              <li>Free for you. A few sessions per day per visitor.</li>
            </ul>
            <label className="check">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>I understand and agree to use my microphone for this demo.</span>
            </label>
            <div className="overlay-actions">
              <button className="btn btn-accent" disabled={!consent} onClick={() => void startLive()}>
                <MicIcon /> Start talking
              </button>
              <button className="btn btn-quiet" onClick={() => setMode("sample")}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {isLive && (live.status === "ended" || live.status === "error") && (
          <div className="stage-overlay" role="status">
            {live.status === "error" ? (
              <p className="overlay-title overlay-error">{live.error}</p>
            ) : (
              <p className="overlay-title">Imagine what an AI agent could do for your business.</p>
            )}
            <div className="overlay-actions">
              <Link href={signupHref} className="btn btn-accent">
                Create your free agent <ArrowIcon />
              </Link>
              <button className="btn btn-ghost" onClick={() => { live.reset(); setMode("sample"); }}>
                Back to sample
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="console-transcript" aria-live="polite">
        {mode === "sample" ? (
          current ? (
            <p className={`line line-${current.speaker}`} lang={sample.language === "hi-IN" ? "hi" : "en"}>
              <span className="line-who mono">
                {current.speaker} <span aria-hidden="true">›</span>
              </span>
              <span className="line-text">{current.text}</span>
            </p>
          ) : (
            <p className="line line-muted">
              <span className="line-who mono">{sample.agentName.toLowerCase()} ›</span>
              <span className="line-text">
                {scenarioInfo.business} · {scenarioInfo.blurb}
              </span>
            </p>
          )
        ) : isLive ? (
          <div className="live-lines">
            {live.lines.length === 0 && <p className="line line-muted">{live.status === "connecting" || live.status === "requesting" ? "Connecting to the agent…" : "Say hello when you hear the agent."}</p>}
            {live.lines.slice(-3).map((l) => (
              <p key={l.id} className={`line line-${l.speaker}`}>
                <span className="line-who mono">
                  {l.speaker === "agent" ? "agent" : "you"} <span aria-hidden="true">›</span>
                </span>
                <span className="line-text">{l.text}</span>
              </p>
            ))}
            {live.notice && <p className="line line-muted">{live.notice}</p>}
          </div>
        ) : (
          <p className="line line-muted">Live test with the real voice stack.</p>
        )}
      </div>

      <div className="console-meta mono">
        {mode === "sample" ? (
          <span className={`tool-line ${currentEvent ? "is-on" : ""}`}>
            {currentEvent ? <>tool: {currentEvent.label}</> : <>lang: {langShort(sample.language)} · {sample.business}</>}
          </span>
        ) : (
          <span className="tool-line">lang: {langShort(language)} · {scenarioInfo.business}</span>
        )}
        <span className={`status status-${statusTone}`}>
          <span className={`dot dot-${statusTone}`} aria-hidden="true" />
          {statusText}
          {isLive && liveActive && <> · {formatTime(live.remaining * 1000)}</>}
        </span>
      </div>

      <div className="console-actions">
        {mode !== "live" ? (
          <>
            <button className="icon-btn" onClick={toggle} aria-label={status === "playing" ? "Pause" : "Play"} disabled={mode !== "sample"}>
              {status === "playing" ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button className="icon-btn" onClick={restart} aria-label="Replay from start" disabled={mode !== "sample"}>
              <ReplayIcon />
            </button>
            <span className="time mono" aria-hidden="true">
              {formatTime(now)} / {formatTime(sample.durationMs)}
            </span>
            <span className="spacer" />
            {liveEnabled ? (
              <button className="btn btn-accent btn-sm try-btn" onClick={() => { audio.current?.pause(); setConsent(false); setMode("consent"); }} disabled={mode === "consent"}>
                <MicIcon /> Try this agent live
              </button>
            ) : (
              <Link className="btn btn-accent btn-sm try-btn" href={signupHref}>
                <MicIcon /> Try this agent
              </Link>
            )}
          </>
        ) : (
          <>
            <span className="time mono">{LIVE_LABEL[live.status]}</span>
            <span className="spacer" />
            {liveActive ? (
              <button className="btn btn-danger btn-sm" onClick={live.end}>
                <StopIcon /> End call
              </button>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={() => { live.reset(); setMode("consent"); setConsent(false); }}>
                <ReplayIcon /> New session
              </button>
            )}
            <button className="btn btn-quiet btn-sm" onClick={() => { live.reset(); setMode("sample"); }}>
              Reset
            </button>
          </>
        )}
      </div>

      {mode === "sample" && (
        <div className="transcript-toggle">
          <button className="btn btn-quiet btn-sm" aria-expanded={showTranscript} onClick={() => setShowTranscript((v) => !v)}>
            {showTranscript ? "Hide" : "Show"} full transcript
          </button>
          <span className="provenance">Sample call · synthesized voices · fictional business</span>
        </div>
      )}
      {mode === "sample" && showTranscript && (
        <ol className="transcript-list" lang={sample.language === "hi-IN" ? "hi" : "en"}>
          {sample.segments.map((s, i) => (
            <li key={i} className={i === activeIndex ? "is-active" : ""}>
              <button onClick={() => { seek(s.startMs); void play(); }}>
                <span className="mono t">{formatTime(s.startMs)}</span>
                <span className={`who who-${s.speaker} mono`}>{s.name}</span>
                <span className="txt">{s.text}</span>
              </button>
            </li>
          ))}
        </ol>
      )}

      <audio
        ref={audio}
        src={sample.src}
        preload="metadata"
        onPlay={() => {
          setStatus("playing");
          cancelAnimationFrame(raf.current);
          raf.current = requestAnimationFrame(tick);
        }}
        onPause={() => {
          cancelAnimationFrame(raf.current);
          setStatus((s) => (s === "completed" ? s : "paused"));
        }}
        onEnded={() => {
          cancelAnimationFrame(raf.current);
          setNow(sample.durationMs);
          setStatus("completed");
        }}
        onWaiting={() => setStatus("loading")}
        onPlaying={() => setStatus("playing")}
        onError={() => setStatus("error")}
      />
    </div>
  );
}

function PlayIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" />
    </svg>
  );
}
function ReplayIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  );
}
function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" />
    </svg>
  );
}
export function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
