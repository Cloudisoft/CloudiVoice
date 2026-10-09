"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/ui/form";
import { resetListAction, type ResetState } from "./actions";

const RESETTABLE = [
  { v: "no_answer", l: "No answer" },
  { v: "voicemail", l: "Voicemail" },
  { v: "busy", l: "Busy" },
  { v: "answered", l: "Answered" },
  { v: "callback_requested", l: "Callback requested" },
  { v: "failed", l: "Failed" },
];

export function ResetForm({ lists }: { lists: { id: string; name: string }[] }) {
  const [state, action] = useActionState<ResetState, FormData>(resetListAction, {});
  const [scope, setScope] = useState("outcomes");
  return (
    <form action={action} className="stack">
      {state.ok && <div className="notice notice-ok">{state.ok}</div>}
      {state.error && <div className="notice notice-bad">{state.error}</div>}
      <div className="field">
        <label htmlFor="r-list">List</label>
        <select id="r-list" name="list_id" className="select" required>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span className="field-label">Which leads</span>
        <label className="check">
          <input type="radio" name="scope" value="outcomes" checked={scope === "outcomes"} onChange={() => setScope("outcomes")} />
          <span>Only these outcomes</span>
        </label>
        {scope === "outcomes" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, paddingLeft: 26 }}>
            {RESETTABLE.map((o) => (
              <label key={o.v} className="check">
                <input type="checkbox" name="outcomes" value={o.v} defaultChecked={["no_answer", "voicemail", "busy"].includes(o.v)} />
                <span>{o.l}</span>
              </label>
            ))}
          </div>
        )}
        <label className="check">
          <input type="radio" name="scope" value="all" checked={scope === "all"} onChange={() => setScope("all")} />
          <span>All leads in the list</span>
        </label>
      </div>
      <p className="field-hint">Never resets Do Not Call, Not in service, Disconnected, Not interested or Wrong number.</p>
      <SubmitButton className="btn btn-ghost btn-sm" pendingText="Resetting…">
        Reset for redial
      </SubmitButton>
    </form>
  );
}
