"use client";

import Link from "next/link";
import { useActionState } from "react";
import { LiveScope } from "../demo/Waveform";
import { useLiveDemo } from "../demo/useLiveDemo";
import { SubmitButton } from "../ui/form";
import { testCallAction, type AgentFormState } from "@/app/app/agents/actions";
import "../demo/demo.css";

const LABEL: Record<string, string> = {
  idle: "Ready",
  requesting: "Preparing",
  connecting: "Connecting",
  listening: "Listening",
  processing: "Thinking",
  speaking: "Speaking",
  ended: "Session ended",
  error: "Error",
};

export function AgentTest({
  agentId,
  browserReady,
  phoneReady,
  numbers,
}: {
  agentId: string;
  browserReady: boolean;
  phoneReady: boolean;
  numbers: { id: string; e164: string }[];
}) {
  const live = useLiveDemo();
  const [state, action] = useActionState<AgentFormState, FormData>(testCallAction, {});
  const active = ["connecting", "listening", "processing", "speaking", "requesting"].includes(live.status);

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h3>Talk in your browser</h3>
          <span className={`chip chip-dot ${active ? "chip-accent" : live.status === "error" ? "chip-bad" : ""}`}>{LABEL[live.status]}</span>
        </div>
        <div className="panel-body">
          {!browserReady ? (
            <p className="field-hint">Browser testing becomes available once the speech and reasoning engines are configured for this workspace.</p>
          ) : (
            <>
              <div style={{ position: "relative", height: 120, borderRadius: 10, border: "1px solid var(--line)", overflow: "hidden", background: "var(--bg)" }}>
                <LiveScope levels={live.levels} active={active} />
              </div>
              <div className="transcript" style={{ marginTop: 12, maxHeight: 220, overflowY: "auto" }} aria-live="polite">
                {live.lines.length === 0 && <p className="field-hint">Uses your microphone. The session is saved as a test call with its transcript.</p>}
                {live.lines.map((l) => (
                  <div key={l.id} className="tline" style={{ gridTemplateColumns: "60px 1fr" }}>
                    <span className={`s s-${l.speaker}`}>{l.speaker === "agent" ? "agent" : "you"}</span>
                    <span>{l.text}</span>
                  </div>
                ))}
              </div>
              {live.error && (
                <div className="notice notice-bad" role="alert" style={{ marginTop: 10 }}>
                  {live.error}
                </div>
              )}
              <div className="form-actions" style={{ marginTop: 12 }}>
                {active ? (
                  <button className="btn btn-danger btn-sm" onClick={live.end}>
                    End session {live.remaining ? `· ${Math.floor(live.remaining / 60)}:${String(live.remaining % 60).padStart(2, "0")}` : ""}
                  </button>
                ) : (
                  <button className="btn btn-accent btn-sm" onClick={() => void live.start({ agentId }, "/api/agents/test-session")}>
                    Start talking
                  </button>
                )}
                {live.status === "ended" && (
                  <Link href="/app/calls?direction=test" className="btn btn-quiet btn-sm">
                    View test calls
                  </Link>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Get a test call on your phone</h3>
        </div>
        <div className="panel-body">
          {!phoneReady ? (
            <p className="field-hint">
              Phone test calls need the telephony connection and at least one active number.{" "}
              <Link className="link" href="/app/numbers">
                Set up numbers
              </Link>
            </p>
          ) : (
            <form action={action} className="stack">
              <input type="hidden" name="id" value={agentId} />
              {state.error && <div className="notice notice-bad">{state.error}</div>}
              {state.ok && <div className="notice notice-ok">{state.ok}</div>}
              <div className="field">
                <label htmlFor="t-to">Your phone number</label>
                <input id="t-to" name="to" className="input" inputMode="tel" placeholder="98765 43210" required />
              </div>
              <div className="field">
                <label htmlFor="t-from">Call from</label>
                <select id="t-from" name="from_id" className="select">
                  {numbers.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.e164}
                    </option>
                  ))}
                </select>
              </div>
              <p className="field-hint">Test calls are charged at your normal per-minute rates.</p>
              <SubmitButton className="btn btn-ghost btn-sm" pendingText="Dialling…">
                Call me now
              </SubmitButton>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
