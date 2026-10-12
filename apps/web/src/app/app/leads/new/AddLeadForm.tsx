"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { PendingButton } from "@/components/ui/form";
import { addLeadAction, type AddLeadState } from "../actions";

interface Props {
  lists: { id: string; name: string }[];
  languages: { code: string; name: string }[];
  defaultList: string;
}

export function AddLeadForm({ lists, languages, defaultList }: Props) {
  const [state, action] = useActionState<AddLeadState, FormData>(addLeadAction, {});
  const [listChoice, setListChoice] = useState(defaultList);
  const [custom, setCustom] = useState<number[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const nextId = useRef(0);
  const fe = state.fieldErrors ?? {};

  // "Save & add another": clear the form (keep the chosen list) and focus the first field.
  useEffect(() => {
    if (!state.nonce || !formRef.current) return;
    for (const el of Array.from(formRef.current.querySelectorAll<HTMLInputElement>("input:not([type=hidden])"))) el.value = "";
    setCustom([]);
    formRef.current.querySelector<HTMLInputElement>("#l-first")?.focus();
  }, [state.nonce]);

  return (
    <form ref={formRef} action={action} className="panel panel-body form-grid" style={{ maxWidth: 860 }} noValidate>
      {state.added && (
        <div className="notice notice-ok span-2" role="status">
          <span>
            Added <Link className="link" href={`/app/leads/${state.added.id}`}>{state.added.name}</Link>.
            {state.added.dnc ? " This number is on your Do-Not-Call list, so it won’t be called." : " Add the next one below."}
          </span>
        </div>
      )}
      {state.error && <div className="notice notice-bad span-2">{state.error}</div>}

      <div className="field">
        <label htmlFor="l-first">First name</label>
        <input id="l-first" name="first_name" className="input" autoComplete="off" autoFocus />
      </div>
      <div className="field">
        <label htmlFor="l-last">Last name</label>
        <input id="l-last" name="last_name" className="input" autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="l-phone">
          Phone number <span className="req">*</span>
        </label>
        <input
          id="l-phone"
          name="phone"
          className="input"
          inputMode="tel"
          required
          placeholder="98765 43210"
          autoComplete="off"
          aria-invalid={fe.phone ? true : undefined}
          aria-describedby={fe.phone ? "l-phone-err" : "l-phone-hint"}
        />
        {fe.phone ? (
          <span id="l-phone-err" className="field-error" role="alert">
            {fe.phone}
            {state.existingId && (
              <>
                {" "}
                <Link className="link" href={`/app/leads/${state.existingId}`}>
                  Open it →
                </Link>
              </>
            )}
          </span>
        ) : (
          <span id="l-phone-hint" className="field-hint">
            Any format: 9876543210, 098765 43210 or +91-98765-43210.
          </span>
        )}
      </div>
      <div className="field">
        <label htmlFor="l-email">Email</label>
        <input id="l-email" name="email" type="email" className="input" autoComplete="off" aria-invalid={fe.email ? true : undefined} />
        {fe.email && (
          <span className="field-error" role="alert">
            {fe.email}
          </span>
        )}
      </div>
      <div className="field">
        <label htmlFor="l-city">City</label>
        <input id="l-city" name="city" className="input" autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="l-state">State</label>
        <input id="l-state" name="state" className="input" autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="l-pin">PIN code</label>
        <input id="l-pin" name="pincode" className="input" inputMode="numeric" maxLength={6} autoComplete="off" aria-invalid={fe.pincode ? true : undefined} />
        {fe.pincode && (
          <span className="field-error" role="alert">
            {fe.pincode}
          </span>
        )}
      </div>
      <div className="field">
        <label htmlFor="l-lang">Preferred language</label>
        <select id="l-lang" name="language" className="select" defaultValue="">
          <option value="">Agent’s default</option>
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="l-list">Add to list</label>
        <select id="l-list" name="list_id" className="select" value={listChoice} onChange={(e) => setListChoice(e.target.value)}>
          <option value="">No list</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
          <option value="__new">+ New list…</option>
        </select>
        <span className="field-hint">Campaigns call leads by list — pick one to include this lead in a campaign.</span>
      </div>
      {listChoice === "__new" ? (
        <div className="field">
          <label htmlFor="l-listname">New list name</label>
          <input id="l-listname" name="list_name" className="input" required placeholder="e.g. Walk-in enquiries" />
        </div>
      ) : (
        <div className="field" aria-hidden="true" />
      )}

      <div className="field span-2">
        <span className="label-like">Custom fields</span>
        <span className="field-hint">Anything your agent should know, e.g. budget, course, policy number. Use them in scripts as {"{{field_name}}"}.</span>
        {custom.map((id) => (
          <div key={id} className="custom-row">
            <input name="custom_key" className="input" placeholder="Field (e.g. budget)" aria-label="Field name" />
            <input name="custom_value" className="input" placeholder="Value (e.g. 50 lakh)" aria-label="Field value" />
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setCustom((c) => c.filter((x) => x !== id))} aria-label="Remove field">
              Remove
            </button>
          </div>
        ))}
        <div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCustom((c) => [...c, nextId.current++])}>
            + Add field
          </button>
        </div>
      </div>

      <div className="form-actions span-2">
        <PendingButton type="submit" name="next" value="view" className="btn btn-accent">
          Save lead
        </PendingButton>
        <PendingButton type="submit" name="next" value="another" className="btn btn-ghost">
          Save &amp; add another
        </PendingButton>
        <Link href="/app/leads" className="btn btn-quiet">
          Cancel
        </Link>
      </div>
    </form>
  );
}
