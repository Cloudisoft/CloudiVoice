import Link from "next/link";
import { notFound } from "next/navigation";
import { signPayload } from "@cloudivoice/core/crypto";
import { endReasonText, OUTCOMES } from "@cloudivoice/core/outcomes";
import { formatPhone } from "@cloudivoice/core/phone";
import { formatInr } from "@cloudivoice/core/pricing";
import { getCallDetail } from "@cloudivoice/core/services/calls";
import { AutoRefresh } from "@/components/ui/AutoRefresh";
import { fmtDate, fmtDuration, OutcomeChip, PageHeader, StateChip } from "@/components/ui/kit";
import { hasPermission, tenant } from "@/lib/session";
import { overrideOutcomeAction } from "../actions";

const EVENT_TEXT: Record<string, (p: Record<string, unknown>) => string> = {
  created: () => "Call created",
  dial_requested: () => "Dialling",
  dial_failed: (p) => `Couldn’t start: ${String(p.message ?? "")}`,
  state: (p) => `${String(p.from)} → ${String(p.to)}`.replace(/_/g, " "),
  transition_rejected: (p) => `Ignored late update (${String(p.to)})`.replace(/_/g, " "),
  tool: (p) => `Agent action: ${String(p.name).replace(/_/g, " ")}`,
  machine_detection: (p) => (p.machine ? "Voicemail detected" : "Person detected"),
  transfer_result: (p) => `Transfer: ${String(p.status)}`,
  conversation_ended: (p) => `Conversation ended (${String(p.kind).replace(/_/g, " ")})`,
  recording_available: () => "Recording available",
  recording_stored: () => "Recording saved to private storage",
  outcome_override: (p) => `Outcome set by supervisor: ${String(p.outcome)}`,
  supervisor_ended: () => "Ended by supervisor",
  supervisor_transfer: () => "Transfer started by supervisor",
  supervisor_listening: () => "Supervisor started listening",
  supervisor_joined: (p) => `${String(p.name ?? "Supervisor")} took over the call`,
  supervisor_left: (p) => `${String(p.name ?? "Supervisor")} handed the call back to the agent`,
  reconciled: () => "Final status confirmed with the phone network",
  finalized: (p) => `Outcome recorded${p.outcome ? `: ${String(p.outcome)}` : ""}`,
  media_stream: (p) => `Audio stream ${String(p.event)}`,
};

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { d, user } = await tenant(async (tx, user) => ({ d: await getCallDetail(tx, id), user }), "calls.view");
  if (!d) notFound();
  const c = d.call;
  const live = !["completed", "failed"].includes(c.state);
  const sig = c.recording_key && hasPermission(user, "recordings.listen") ? signPayload({ callId: id, orgId: user.orgId }, 600) : null;
  const t0 = new Date(c.created_at).getTime();
  // Right after the call: keep refreshing until the summary and recording land.
  const justEnded = !live && c.ended_at != null && Date.now() - new Date(c.ended_at).getTime() < 5 * 60_000;
  const awaitingSummary = justEnded && !c.summary && d.transcript.length > 0;
  const awaitingRecording = justEnded && (c.recording_status === "pending" || c.recording_status === "failed") && !c.recording_key;

  return (
    <>
      {(live || awaitingSummary || awaitingRecording) && <AutoRefresh seconds={live ? 2 : 3} />}
      <PageHeader
        title={c.lead_name ?? (c.direction === "test" && !c.to_e164 ? "Browser test call" : "No name on file")}
        crumbs={[{ href: "/app/calls", label: "Call Records" }]}
        sub={
          <>
            <StateChip state={c.state} /> <span style={{ marginLeft: 8 }}>{fmtDate(c.created_at)}</span>
          </>
        }
        actions={
          c.lead_id && (
            <Link href={`/app/leads/${c.lead_id}`} className="btn btn-ghost btn-sm">
              Lead history
            </Link>
          )
        }
      />
      <div className="grid-main-side">
        <div className="stack">
          {c.summary && (
            <section className="panel">
              <div className="panel-head">
                <h2>Summary</h2>
                {c.qa && <span className={`chip ${c.qa.score >= 75 ? "chip-ok" : c.qa.score >= 50 ? "chip-warn" : "chip-bad"}`}>QA {c.qa.score}/100</span>}
              </div>
              <div className="panel-body">
                <p style={{ margin: 0 }}>{c.summary}</p>
                {c.qa?.notes && <p className="field-hint" style={{ marginBottom: 0 }}>{c.qa.notes}</p>}
              </div>
            </section>
          )}
          {(awaitingSummary || awaitingRecording) && (
            <section className="panel">
              <div className="panel-body" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span className="chip chip-accent chip-dot">Processing</span>
                <span className="field-hint" style={{ margin: 0 }}>
                  {awaitingSummary && awaitingRecording ? "Preparing the summary and saving the recording…" : awaitingSummary ? "Preparing the call summary and QA score…" : "Saving the recording…"} This page updates automatically.
                </span>
              </div>
            </section>
          )}
          {sig && (
            <section className="panel">
              <div className="panel-head">
                <h2>Recording</h2>
                <a className="btn btn-quiet btn-sm" href={`/api/recordings/${id}?sig=${encodeURIComponent(sig)}&download=1`}>
                  Download MP3
                </a>
              </div>
              <div className="panel-body">
                <audio controls preload="none" src={`/api/recordings/${id}?sig=${encodeURIComponent(sig)}`} style={{ width: "100%" }} />
                <p className="field-hint">Stored privately. This player link expires in 10 minutes.</p>
              </div>
            </section>
          )}
          <section className="panel">
            <div className="panel-head">
              <h2>Transcript</h2>
              {live && <span className="chip chip-accent chip-dot">Updating live</span>}
            </div>
            <div className="panel-body">
              {d.transcript.length === 0 ? (
                <p className="field-hint">{live ? "Waiting for the conversation to start…" : "No conversation was recorded for this call."}</p>
              ) : (
                <div className="transcript">
                  {d.transcript.map((l) => (
                    <div key={l.id} className="tline" lang={l.language === "hi-IN" ? "hi" : undefined}>
                      <span className="t">
                        {Math.floor(l.at_ms / 60000)}:{String(Math.floor((l.at_ms % 60000) / 1000)).padStart(2, "0")}
                      </span>
                      <span className={`s s-${l.speaker}`}>{l.speaker}</span>
                      <span>{l.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>Outcome</h2>
              <OutcomeChip outcome={c.outcome} />
            </div>
            <div className="panel-body stack">
              <dl className="kv">
                <dt>Why</dt>
                <dd>{c.outcome_reason ?? "—"}</dd>
                <dt>Confidence</dt>
                <dd>{c.outcome_confidence != null ? `${Math.round(c.outcome_confidence * 100)}%${c.outcome_overridden ? " · set by supervisor" : ""}` : "—"}</dd>
                <dt>How it ended</dt>
                <dd>{endReasonText(c.end_reason) || (live ? "In progress" : "—")}</dd>
                {c.transfer_status && (
                  <>
                    <dt>Transfer</dt>
                    <dd>{c.transfer_status.replace(/_/g, " ")}</dd>
                  </>
                )}
              </dl>
              {hasPermission(user, "calls.override") && !live && (
                <form action={overrideOutcomeAction} className="stack" style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
                  <input type="hidden" name="id" value={id} />
                  <div className="field">
                    <label htmlFor="o-out">Override outcome</label>
                    <select id="o-out" name="outcome" className="select" defaultValue={c.outcome ?? ""}>
                      {Object.entries(OUTCOMES).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input name="note" className="input" placeholder="Reason (optional)" aria-label="Reason" />
                  <button className="btn btn-ghost btn-sm">Save override</button>
                  <span className="field-hint">Supervisor overrides are never replaced by automatic outcomes.</span>
                </form>
              )}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Details</h2>
            </div>
            <dl className="kv panel-body">
              <dt>Direction</dt>
              <dd>{c.direction}</dd>
              <dt>From</dt>
              <dd className="mono">{formatPhone(c.from_e164) || "—"}</dd>
              <dt>To</dt>
              <dd className="mono">{formatPhone(c.to_e164) || "—"}</dd>
              <dt>Agent</dt>
              <dd>
                {c.agent_name ?? "—"} {c.agent_version ? <span className="mono field-hint">v{c.agent_version}</span> : null}
              </dd>
              <dt>Campaign</dt>
              <dd>{c.campaign_name ?? "—"}</dd>
              <dt>Duration</dt>
              <dd>{fmtDuration(c.duration_sec)}</dd>
              <dt>Cost</dt>
              <dd>{Number(c.cost_paise) ? formatInr(Number(c.cost_paise), { decimals: true }) : "—"}</dd>
            </dl>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Timeline</h2>
            </div>
            <div className="panel-body">
              <ol className="timeline">
                {d.events
                  .filter((e) => e.type !== "transition_rejected" || hasPermission(user, "settings.manage"))
                  .map((e) => (
                    <li key={e.id}>
                      <span className="t">+{Math.max(0, Math.round((new Date(e.created_at).getTime() - t0) / 1000))}s</span>
                      <span>{(EVENT_TEXT[e.type] ?? (() => e.type.replace(/_/g, " ")))(e.payload)}</span>
                    </li>
                  ))}
              </ol>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
