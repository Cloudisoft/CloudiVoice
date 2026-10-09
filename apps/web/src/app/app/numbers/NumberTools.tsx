"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/form";
import { buyNumberAction, importNumbersAction, searchNumbersAction, type NumState } from "./actions";

export function ImportNumbers() {
  const [state, action] = useActionState<NumState>(importNumbersAction, {});
  return (
    <form action={action} className="stack">
      {state.ok && <div className="notice notice-ok">{state.ok}</div>}
      {state.error && <div className="notice notice-bad">{state.error}</div>}
      <SubmitButton className="btn btn-ghost btn-sm" pendingText="Syncing…">
        Sync numbers from connection
      </SubmitButton>
    </form>
  );
}

export function SearchNumbers() {
  const [state, action] = useActionState<NumState, FormData>(searchNumbersAction, {});
  const [buy, buyAction] = useActionState<NumState, FormData>(buyNumberAction, {});
  return (
    <div className="stack">
      <form action={action} className="form-grid">
        <div className="field">
          <label htmlFor="n-pattern">Area code or digits</label>
          <input id="n-pattern" name="pattern" className="input" placeholder="e.g. 22 (Mumbai), 80 (Bengaluru)" inputMode="numeric" />
        </div>
        <div className="field">
          <label htmlFor="n-type">Type</label>
          <select id="n-type" name="type" className="select">
            <option value="">Any</option>
            <option value="local">Local / fixed line</option>
            <option value="mobile">Mobile</option>
            <option value="tollfree">Toll-free</option>
          </select>
        </div>
        <div className="span-2">
          <SubmitButton className="btn btn-ghost btn-sm" pendingText="Searching…">
            Search available numbers
          </SubmitButton>
        </div>
      </form>
      {state.error && <div className="notice notice-warn">{state.error}</div>}
      {buy.ok && <div className="notice notice-ok">{buy.ok}</div>}
      {buy.error && <div className="notice notice-bad">{buy.error}</div>}
      {state.results && (
        <ul className="checklist">
          {state.results.map((r) => (
            <li key={r.e164}>
              <span className="mark mark-ok">#</span>
              <span>
                <b className="mono">{r.e164}</b>
                <span className="d">{[r.region, r.numberType].filter(Boolean).join(" · ") || "India"}</span>
              </span>
              <form action={buyAction}>
                <input type="hidden" name="e164" value={r.e164} />
                <SubmitButton className="btn btn-accent btn-sm" pendingText="Buying…">
                  Buy
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
