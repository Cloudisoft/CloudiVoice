"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/form";
import { updateOrgAction, type SettingsState } from "./actions";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface OrgValues {
  name: string;
  industry: string;
  website: string;
  timezone: string;
  default_language: string;
  calling_window_start: string;
  calling_window_end: string;
  calling_days: number[];
  record_calls: boolean;
  recording_disclosure: string;
  retention_days: number;
  max_concurrency: number;
  monthly_spend_limit: string;
}

export function OrgForm({ v, languages, readOnly }: { v: OrgValues; languages: { value: string; label: string; disabled: boolean }[]; readOnly: boolean }) {
  const [state, action] = useActionState<SettingsState, FormData>(updateOrgAction, {});
  return (
    <form action={action} className="stack">
      {state.ok && <div className="notice notice-ok">{state.ok}</div>}
      {state.error && <div className="notice notice-bad">{state.error}</div>}
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="stack">
        <section className="panel">
          <div className="panel-head">
            <h2>Business</h2>
          </div>
          <div className="panel-body form-grid">
            <div className="field">
              <label htmlFor="o-name">Organization name</label>
              <input id="o-name" name="name" className="input" defaultValue={v.name} required />
            </div>
            <div className="field">
              <label htmlFor="o-ind">Industry</label>
              <input id="o-ind" name="industry" className="input" defaultValue={v.industry} />
            </div>
            <div className="field">
              <label htmlFor="o-web">Website</label>
              <input id="o-web" name="website" className="input" defaultValue={v.website} />
            </div>
            <div className="field">
              <label htmlFor="o-lang">Default language for new agents</label>
              <select id="o-lang" name="default_language" className="select" defaultValue={v.default_language}>
                {languages.map((l) => (
                  <option key={l.value} value={l.value} disabled={l.disabled}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Calling hours</h2>
          </div>
          <div className="panel-body form-grid">
            <div className="field">
              <label htmlFor="o-tz">Time zone</label>
              <select id="o-tz" name="timezone" className="select" defaultValue={v.timezone}>
                {["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York"].map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
              <span className="field-hint">Leads without their own time zone are called in this one.</span>
            </div>
            <div className="field">
              <span className="field-label">Hours</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input name="calling_window_start" type="time" className="input" defaultValue={v.calling_window_start} aria-label="Start" />
                <span>to</span>
                <input name="calling_window_end" type="time" className="input" defaultValue={v.calling_window_end} aria-label="End" />
              </div>
            </div>
            <fieldset className="field span-2" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field-label">Calling days</legend>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
                {DAYS.map((d, i) => (
                  <label key={d} className="check">
                    <input type="checkbox" name="calling_days" value={i + 1} defaultChecked={v.calling_days.includes(i + 1)} /> {d}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Recording, retention &amp; limits</h2>
          </div>
          <div className="panel-body form-grid">
            <label className="check span-2">
              <input type="checkbox" name="record_calls" defaultChecked={v.record_calls} />
              <span>Record phone calls (stored privately; make sure you have consent where required).</span>
            </label>
            <div className="field span-2">
              <label htmlFor="o-disc">Recording disclosure</label>
              <input id="o-disc" name="recording_disclosure" className="input" defaultValue={v.recording_disclosure} />
            </div>
            <div className="field">
              <label htmlFor="o-ret">Keep transcripts &amp; recordings for (days)</label>
              <input id="o-ret" name="retention_days" type="number" min={1} max={3650} className="input" defaultValue={v.retention_days} />
            </div>
            <div className="field">
              <label htmlFor="o-conc">Maximum concurrent calls</label>
              <input id="o-conc" name="max_concurrency" type="number" min={1} max={500} className="input" defaultValue={v.max_concurrency} />
            </div>
            <div className="field">
              <label htmlFor="o-limit">Monthly spend limit (₹)</label>
              <input id="o-limit" name="monthly_spend_limit" type="number" min={0} className="input" defaultValue={v.monthly_spend_limit} placeholder="No limit" />
            </div>
          </div>
        </section>
      </fieldset>
      {!readOnly && (
        <div className="form-actions">
          <SubmitButton pendingText="Saving…">Save settings</SubmitButton>
        </div>
      )}
    </form>
  );
}
