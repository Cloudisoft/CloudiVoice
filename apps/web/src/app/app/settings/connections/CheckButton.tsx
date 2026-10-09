"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/form";
import { checkConnectionsAction, type SettingsState } from "../actions";

export function CheckButton() {
  const [state, action] = useActionState<SettingsState>(checkConnectionsAction, {});
  return (
    <form action={action} className="stack">
      {state.ok && <div className="notice">{state.ok}</div>}
      <SubmitButton className="btn btn-ghost btn-sm" pendingText="Checking…">
        Run connection check
      </SubmitButton>
    </form>
  );
}
