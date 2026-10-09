"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/form";
import { saveCampaignAction, type CampaignState } from "./actions";

export interface CampaignDefaults {
  id?: string;
  name: string;
  agent_id: string | null;
  list_ids: string[];
  number_ids: string[];
  transfer_number: string;
  intro_name: string;
  voicemail_message: string;
  max_concurrency: number;
  calls_per_minute: number;
  max_attempts: number;
  window_start: string;
  window_end: string;
  retry_rules: Record<string, { retry: boolean; delay_minutes: number }>;
}

const RETRY_LABELS: Record<string, string> = {
  no_answer: "No answer / never connected",
  busy: "Busy",
  voicemail: "Voicemail",
  failed: "Network failure",
  callback_requested: "Callback requested (if no time given)",
};

export function CampaignForm({
  d,
  agents,
  lists,
  numbers,
  orgWindow,
}: {
  d: CampaignDefaults;
  agents: { id: string; name: string; status: string }[];
  lists: { id: string; name: string; total: number }[];
  numbers: { id: string; e164: string; label: string | null }[];
  orgWindow: string;
}) {
  const [state, action] = useActionState<CampaignState, FormData>(saveCampaignAction, {});
  return (
    <form action={action} className="stack">
      {d.id && <input type="hidden" name="id" value={d.id} />}
      {state.error && <div className="notice notice-bad" role="alert">{state.error}</div>}
      <section className="panel">
        <div className="panel-head">
          <h2>Basics</h2>
        </div>
        <div className="panel-body form-grid">
          <div className="field">
            <label htmlFor="c-name">Campaign name</label>
            <input id="c-name" name="name" className="input" defaultValue={d.name} required minLength={2} />
          </div>
          <div className="field">
            <label htmlFor="c-agent">Agent</label>
            <select id="c-agent" name="agent_id" className="select" defaultValue={d.agent_id ?? ""}>
              <option value="">Choose an agent…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.status !== "active" ? " (inactive)" : ""}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="field span-2" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label" style={{ marginBottom: 6 }}>
              Lead lists
            </legend>
            {lists.length === 0 ? (
              <span className="field-hint">No lists yet — import leads first.</span>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 6 }}>
                {lists.map((l) => (
                  <label key={l.id} className="check">
                    <input type="checkbox" name="list_ids" value={l.id} defaultChecked={d.list_ids.includes(l.id)} />
                    <span>
                      {l.name} <span className="field-hint">({l.total.toLocaleString("en-IN")})</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <fieldset className="field span-2" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label" style={{ marginBottom: 6 }}>
              Caller number pool
            </legend>
            {numbers.length === 0 ? (
              <span className="field-hint">No outbound numbers yet — add one on the Phone Numbers page.</span>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 6 }}>
                {numbers.map((n) => (
                  <label key={n.id} className="check">
                    <input type="checkbox" name="number_ids" value={n.id} defaultChecked={d.number_ids.includes(n.id)} />
                    <span className="mono">
                      {n.e164} {n.label && <span className="field-hint">{n.label}</span>}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Conversation</h2>
        </div>
        <div className="panel-body form-grid">
          <div className="field">
            <label htmlFor="c-intro">Intro name (overrides the agent’s name)</label>
            <input id="c-intro" name="intro_name" className="input" defaultValue={d.intro_name} placeholder="Optional" />
          </div>
          <div className="field">
            <label htmlFor="c-transfer">Transfer number</label>
            <input id="c-transfer" name="transfer_number" className="input" inputMode="tel" defaultValue={d.transfer_number} placeholder="Optional — overrides the agent’s" />
          </div>
          <div className="field span-2">
            <label htmlFor="c-vm">Voicemail message</label>
            <textarea id="c-vm" name="voicemail_message" className="textarea" style={{ minHeight: 70 }} defaultValue={d.voicemail_message} placeholder="Hi {{first_name}}, this is {{agent_name}} from {{company}}…" />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Pacing, hours &amp; retries</h2>
        </div>
        <div className="panel-body form-grid">
          <div className="field">
            <label htmlFor="c-conc">Concurrent calls</label>
            <input id="c-conc" name="max_concurrency" type="number" min={1} max={100} className="input" defaultValue={d.max_concurrency} />
          </div>
          <div className="field">
            <label htmlFor="c-cpm">Calls per minute</label>
            <input id="c-cpm" name="calls_per_minute" type="number" min={1} max={120} className="input" defaultValue={d.calls_per_minute} />
            <span className="field-hint">Gentle pacing avoids your numbers being flagged as spam.</span>
          </div>
          <div className="field">
            <label htmlFor="c-ws">Calling hours start (lead’s local time)</label>
            <input id="c-ws" name="window_start" type="time" className="input" defaultValue={d.window_start} />
          </div>
          <div className="field">
            <label htmlFor="c-we">Calling hours end</label>
            <input id="c-we" name="window_end" type="time" className="input" defaultValue={d.window_end} />
            <span className="field-hint">Leave empty to use your organization hours ({orgWindow}).</span>
          </div>
          <div className="field">
            <label htmlFor="c-att">Maximum attempts per lead</label>
            <input id="c-att" name="max_attempts" type="number" min={1} max={10} className="input" defaultValue={d.max_attempts} />
          </div>
          <div className="span-2">
            <span className="field-label">Retry rules</span>
            <div className="table-wrap" style={{ marginTop: 6 }}>
              <table className="table">
                <tbody>
                  {Object.entries(RETRY_LABELS).map(([k, label]) => (
                    <tr key={k}>
                      <td>
                        <label className="check">
                          <input type="checkbox" name={`retry_${k}`} defaultChecked={d.retry_rules[k]?.retry ?? false} /> {label}
                        </label>
                      </td>
                      <td className="num">
                        <label className="field-hint">
                          retry after{" "}
                          <input name={`delay_${k}`} type="number" min={5} max={10080} className="input" style={{ width: 90, minHeight: 32, height: 32, display: "inline-block" }} defaultValue={d.retry_rules[k]?.delay_minutes ?? 120} /> min
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="field-hint">Do Not Call, Not in service, Disconnected, Not interested and Wrong number are never retried.</p>
          </div>
        </div>
      </section>
      <div className="form-actions">
        <SubmitButton pendingText="Saving…">{d.id ? "Save changes" : "Create campaign"}</SubmitButton>
      </div>
    </form>
  );
}
