"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/form";
import { inviteAction, type SettingsState } from "../actions";

export function InviteForm() {
  const [state, action] = useActionState<SettingsState, FormData>(inviteAction, {});
  return (
    <form action={action} className="stack">
      {state.ok && <div className="notice notice-ok">{state.ok}</div>}
      {state.devLink && (
        <div className="notice notice-warn">
          <span>
            Development mode (no email server): <a className="link" href={state.devLink}>invitation link</a>
          </span>
        </div>
      )}
      {state.error && <div className="notice notice-bad">{state.error}</div>}
      <div className="field">
        <label htmlFor="i-email">Email</label>
        <input id="i-email" name="email" type="email" className="input" required />
      </div>
      <div className="field">
        <label htmlFor="i-role">Role</label>
        <select id="i-role" name="role" className="select" defaultValue="operator">
          <option value="admin">Admin — everything, including team, billing and connections</option>
          <option value="manager">Manager — agents, campaigns, leads, overrides</option>
          <option value="operator">Operator — run campaigns, work leads, monitor calls</option>
          <option value="viewer">Viewer — read-only</option>
        </select>
      </div>
      <SubmitButton className="btn btn-accent btn-sm" pendingText="Inviting…">
        Send invitation
      </SubmitButton>
    </form>
  );
}
