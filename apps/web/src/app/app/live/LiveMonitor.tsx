"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { superviseAction } from "./actions";

interface LiveCall {
  id: string;
  direction: string;
  state: string;
  who: string;
  agent: string | null;
  campaign: string | null;
  startedAt: string;
  lastLine: string | null;
}
interface Line {
  id: number;
  speaker: string;
  text: string;
  at_ms: number;
}

const STATE: Record<string, string> = { queued: "Queued", ringing: "Ringing", answered: "Answered", in_progress: "In conversation", voicemail: "Voicemail", transferring: "Transferring" };

function elapsed(iso: string, now: number) {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function LiveMonitor({ canSupervise, canTransfer }: { canSupervise: boolean; canTransfer: boolean }) {
  const [calls, setCalls] = useState<LiveCall[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const after = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    after.current = 0;
    setLines([]);
  }, [selected]);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/live?${selected ? `call=${selected}&after=${after.current}` : ""}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { calls: LiveCall[]; lines: Line[] };
        if (stop) return;
        setCalls(data.calls);
        setError(null);
        if (data.lines.length) {
          after.current = data.lines.at(-1)!.id;
          setLines((l) => [...l, ...data.lines]);
        }
      } catch {
        setError("Reconnecting…");
      }
    };
    void poll();
    const id = window.setInterval(() => document.visibilityState === "visible" && void poll(), 2000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop = true;
      window.clearInterval(id);
      window.clearInterval(tick);
    };
  }, [selected]);

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [lines]);

  const current = calls.find((c) => c.id === selected);

  return (
    <div className="grid-main-side">
      <section className="panel">
        <div className="panel-head">
          <h2>Calls in progress</h2>
          <span className={`chip chip-dot ${calls.length ? "chip-ok" : ""}`}>{error ?? `${calls.length} live`}</span>
        </div>
        {calls.length === 0 ? (
          <div className="empty">
            <h3>All quiet</h3>
            <p>Live calls appear here within two seconds of starting. Calls leave the list when they end or are transferred.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Caller</th>
                  <th>Agent</th>
                  <th>Status</th>
                  <th className="num">Time</th>
                  <th>Latest</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.id} style={{ cursor: "pointer", background: c.id === selected ? "rgba(255,176,32,.06)" : undefined }} onClick={() => setSelected(c.id)}>
                    <td>
                      <button className="row-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => setSelected(c.id)}>
                        {c.who}
                      </button>
                      <div className="field-hint">{c.campaign ?? c.direction}</div>
                    </td>
                    <td>{c.agent ?? "—"}</td>
                    <td>
                      <span className="chip chip-dot chip-accent">{STATE[c.state] ?? c.state}</span>
                    </td>
                    <td className="num mono">{elapsed(c.startedAt, now)}</td>
                    <td className="muted" style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.lastLine ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>{current ? current.who : "Live transcript"}</h2>
          {current && (
            <Link href={`/app/calls/${current.id}`} className="btn btn-quiet btn-sm">
              Record →
            </Link>
          )}
        </div>
        <div className="panel-body">
          {!selected ? (
            <p className="field-hint">Select a call to follow its transcript as it happens.</p>
          ) : (
            <>
              <div ref={box} className="transcript" style={{ maxHeight: 420, overflowY: "auto" }} aria-live="polite">
                {lines.length === 0 && <p className="field-hint">Waiting for the first words…</p>}
                {lines.map((l) => (
                  <div key={l.id} className="tline" style={{ gridTemplateColumns: "60px 1fr" }}>
                    <span className={`s s-${l.speaker}`}>{l.speaker}</span>
                    <span>{l.text}</span>
                  </div>
                ))}
              </div>
              {msg && <div className="notice" style={{ marginTop: 10 }}>{msg}</div>}
              {canSupervise && current && (
                <form
                  className="form-actions"
                  action={async (fd) => {
                    const r = await superviseAction(fd);
                    setMsg(r.message);
                  }}
                >
                  <input type="hidden" name="id" value={current.id} />
                  {canTransfer && (
                    <>
                      <input name="to" className="input" placeholder="Transfer to number" inputMode="tel" aria-label="Transfer to number" style={{ maxWidth: 200, minHeight: 34, height: 34 }} />
                      <button className="btn btn-ghost btn-sm" name="op" value="transfer">
                        Transfer
                      </button>
                    </>
                  )}
                  <button className="btn btn-danger btn-sm" name="op" value="end" onClick={(e) => !confirm("End this call now?") && e.preventDefault()}>
                    End call
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
