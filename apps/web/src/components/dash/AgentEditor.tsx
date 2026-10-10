"use client";

import { useActionState, useRef, useState } from "react";
import type { AgentConfig } from "@cloudivoice/core/agentConfig";
import { SubmitButton } from "../ui/form";
import { saveAgentAction, type AgentFormState } from "@/app/app/agents/actions";

interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

interface Props {
  id?: string;
  name: string;
  config: AgentConfig;
  useCases: Option[];
  languages: Option[];
  voices: (Option & { gender: string; style: string })[];
  canPreview: boolean;
  readOnly?: boolean;
}

export function AgentEditor({ id, name, config, useCases, languages, voices, canPreview, readOnly }: Props) {
  const [state, action] = useActionState<AgentFormState, FormData>(saveAgentAction, {});
  const fe = state.fieldErrors ?? {};
  const [voice, setVoice] = useState(config.voice);
  const [lang, setLang] = useState(config.primary_language);
  const [pace, setPace] = useState(config.pace);
  const [previewing, setPreviewing] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  const preview = async () => {
    setPreviewing(true);
    try {
      audio.current?.pause();
      audio.current = new Audio(`/api/voices/preview?voice=${encodeURIComponent(voice)}&lang=${encodeURIComponent(lang)}&pace=${pace}`);
      await audio.current.play();
      audio.current.onended = () => setPreviewing(false);
    } catch {
      setPreviewing(false);
    }
  };

  const err = (k: string) =>
    fe[k] ? (
      <span className="field-error" role="alert">
        {fe[k]}
      </span>
    ) : null;

  return (
    <form action={action} className="stack">
      {id && <input type="hidden" name="id" value={id} />}
      {state.error && (
        <div className="notice notice-bad" role="alert">
          {state.error}
        </div>
      )}
      {state.ok && (
        <div className="notice notice-ok" role="status">
          {state.ok}
        </div>
      )}
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <section className="panel">
          <div className="panel-head">
            <h2>Identity</h2>
          </div>
          <div className="panel-body form-grid">
            <div className="field">
              <label htmlFor="a-name">Agent name (internal)</label>
              <input id="a-name" name="name" className="input" defaultValue={name} required />
              {err("name")}
            </div>
            <div className="field">
              <label htmlFor="a-use">Use case</label>
              <select id="a-use" name="use_case" className="select" defaultValue={config.use_case}>
                {useCases.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="a-persona">Name the agent introduces itself with</label>
              <input id="a-persona" name="persona_name" className="input" defaultValue={config.persona_name} required />
              {err("persona_name")}
            </div>
            <div className="field">
              <label htmlFor="a-company">Company name it represents</label>
              <input id="a-company" name="company_name" className="input" defaultValue={config.company_name} required />
              {err("company_name")}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Language &amp; voice</h2>
          </div>
          <div className="panel-body form-grid">
            <div className="field">
              <label htmlFor="a-lang">Primary language</label>
              <select id="a-lang" name="primary_language" className="select" value={lang} onChange={(e) => setLang(e.target.value)}>
                {languages.map((l) => (
                  <option key={l.value} value={l.value} disabled={l.disabled}>
                    {l.label}
                  </option>
                ))}
              </select>
              <span className="field-hint">Languages marked “in validation” are enabled once tested on the voice engine.</span>
            </div>
            <div className="field">
              <label htmlFor="a-fallback">Fallback language</label>
              <select id="a-fallback" name="fallback_language" className="select" defaultValue={config.fallback_language}>
                {languages.map((l) => (
                  <option key={l.value} value={l.value} disabled={l.disabled}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="a-voice">Voice</label>
              <div style={{ display: "flex", gap: 8 }}>
                <select id="a-voice" name="voice" className="select" value={voice} onChange={(e) => setVoice(e.target.value)}>
                  {voices.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label} — {v.gender}, {v.style.toLowerCase()}
                    </option>
                  ))}
                </select>
                {canPreview && (
                  <button type="button" className="btn btn-ghost" onClick={() => void preview()} disabled={previewing} aria-label="Preview voice">
                    {previewing ? "Playing…" : "Preview"}
                  </button>
                )}
              </div>
            </div>
            <div className="field">
              <label htmlFor="a-pace">
                Speaking pace <span className="mono field-hint">{pace.toFixed(2)}×</span>
              </label>
              <input id="a-pace" name="pace" type="range" min="0.8" max="1.3" step="0.05" value={pace} onChange={(e) => setPace(Number(e.target.value))} style={{ accentColor: "var(--accent)" }} />
            </div>
            <div className="field">
              <label htmlFor="a-tone">Tone</label>
              <select id="a-tone" name="tone" className="select" defaultValue={config.tone}>
                <option value="warm">Warm</option>
                <option value="professional">Professional</option>
                <option value="energetic">Energetic</option>
                <option value="calm">Calm</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="a-form">Formality</label>
              <select id="a-form" name="formality" className="select" defaultValue={config.formality}>
                <option value="formal">Formal (आप, Sir/Ma’am)</option>
                <option value="neutral">Respectful (आप / ji)</option>
                <option value="casual">Casual</option>
              </select>
            </div>
            <label className="check span-2">
              <input type="checkbox" name="code_switching" defaultChecked={config.code_switching} />
              <span>Allow natural Hindi–English code-switching (Hinglish) when the caller mixes languages.</span>
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Conversation</h2>
          </div>
          <div className="panel-body form-grid">
            <div className="field span-2">
              <label htmlFor="a-open">Opening line</label>
              <textarea id="a-open" name="opening_line" className="textarea" style={{ minHeight: 70 }} defaultValue={config.opening_line} placeholder="Leave empty to use the default for this use case" />
              <span className="field-hint">
                Variables: <code className="mono">{"{{first_name}}"}</code> <code className="mono">{"{{agent_name}}"}</code> <code className="mono">{"{{company}}"}</code> and any custom lead field.
              </span>
            </div>
            <div className="field span-2">
              <label htmlFor="a-ins">Call script, SOP &amp; business details</label>
              <textarea id="a-ins" name="instructions" className="textarea" style={{ minHeight: 160 }} defaultValue={config.instructions} placeholder={"1. Greet and confirm the caller’s name\n2. Ask what they need…\nHours, prices, policies, escalation rules"} />
              <span className="field-hint">The agent follows your flow and policies but speaks naturally, adapting to what the caller says instead of reading word-for-word.</span>
              {err("instructions")}
            </div>
            <div className="field">
              <label htmlFor="a-goals">Goals (one per line)</label>
              <textarea id="a-goals" name="goals" className="textarea" defaultValue={config.goals.join("\n")} />
            </div>
            <div className="field">
              <label htmlFor="a-qual">Qualification criteria</label>
              <textarea id="a-qual" name="qualification_criteria" className="textarea" defaultValue={config.qualification_criteria} placeholder="e.g. Budget above ₹50 lakh and buying within 6 months" />
            </div>
            <label className="check span-2">
              <input type="checkbox" name="knowledge_enabled" defaultChecked={config.knowledge_enabled} />
              <span>Let the agent search the Knowledge Base during calls instead of guessing.</span>
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Call handling</h2>
          </div>
          <div className="panel-body form-grid">
            <div className="field">
              <label htmlFor="a-transfer">Transfer number (human handoff)</label>
              <input id="a-transfer" name="transfer_number" className="input" inputMode="tel" defaultValue={config.transfer_number} placeholder="98765 43210" />
              {err("transfer_number")}
              <span className="field-hint">When a caller asks for a person, the agent transfers immediately. Campaigns can override this.</span>
            </div>
            <div className="field">
              <label htmlFor="a-max">Maximum call length (minutes)</label>
              <input id="a-max" name="max_duration_min" type="number" min={2} max={60} className="input" defaultValue={Math.round(config.max_duration_sec / 60)} />
              {err("max_duration_sec")}
              <span className="field-hint">Leave room for real conversations; very short limits cut callers off.</span>
            </div>
            <div className="field">
              <label htmlFor="a-silence">Quiet-caller check-in after (seconds)</label>
              <input id="a-silence" name="silence_checkin_sec" type="number" min={4} max={20} className="input" defaultValue={config.silence_checkin_sec} />
            </div>
            <div className="field">
              <label htmlFor="a-checkins">Check-ins before ending politely</label>
              <input id="a-checkins" name="max_silence_checkins" type="number" min={1} max={3} className="input" defaultValue={config.max_silence_checkins} />
            </div>
            <div className="field">
              <label htmlFor="a-clar">Max clarifications for the same detail</label>
              <input id="a-clar" name="max_clarifications" type="number" min={1} max={3} className="input" defaultValue={config.max_clarifications} />
            </div>
            <div className="field span-2">
              <label htmlFor="a-vm">Voicemail message</label>
              <textarea id="a-vm" name="voicemail_message" className="textarea" style={{ minHeight: 70 }} defaultValue={config.voicemail_message} placeholder="Leave empty to hang up without a message" />
            </div>
            <label className="check span-2">
              <input type="checkbox" name="recording_disclosure" defaultChecked={config.recording_disclosure} />
              <span>Read the recording disclosure at the start of the call when call recording is on.</span>
            </label>
          </div>
        </section>
      </fieldset>

      {!readOnly && (
        <div className="form-actions">
          {id && <input name="note" className="input" placeholder="What changed? (optional, shown in version history)" style={{ maxWidth: 420 }} />}
          <SubmitButton pendingText="Saving…">{id ? "Save new version" : "Create agent"}</SubmitButton>
        </div>
      )}
    </form>
  );
}
