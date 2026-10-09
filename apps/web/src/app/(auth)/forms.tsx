"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { acceptInviteAction, forgotAction, type FormState, loginAction, resetAction, signupAction } from "./actions";

const initial: FormState = {};

export function SignupForm({ scenario, lang, scenarioLabel }: { scenario?: string; lang?: string; scenarioLabel?: string }) {
  const [state, action] = useActionState(signupAction, initial);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="auth-form" noValidate>
      {scenarioLabel && (
        <div className="demo-carry">
          <span className="chip chip-accent">Saved</span>
          <span>
            We&rsquo;ll start your first agent from the <b>{scenarioLabel}</b> demo{lang ? ` in ${lang === "hi-IN" ? "Hindi" : "English"}` : ""}.
          </span>
        </div>
      )}
      <FormMessage error={state.error} />
      <Field label="Your name" name="name" autoComplete="name" required defaultValue={state.values?.name} error={fe.name} />
      <Field label="Work email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} error={fe.email} />
      <Field label="Company" name="company" autoComplete="organization" required defaultValue={state.values?.company} error={fe.company} />
      <Field label="Password" name="password" type="password" autoComplete="new-password" required minLength={10} hint="At least 10 characters, with letters and a number." error={fe.password} />
      <input type="hidden" name="scenario" value={scenario ?? ""} />
      <input type="hidden" name="lang" value={lang ?? ""} />
      <label className="check">
        <input type="checkbox" name="terms" required />
        <span>I agree to use CloudiVoice in line with applicable telemarketing, consent and privacy rules.</span>
      </label>
      {fe.terms && (
        <span className="field-error" role="alert">
          {fe.terms}
        </span>
      )}
      <SubmitButton pendingText="Creating your account…">Create account</SubmitButton>
    </form>
  );
}

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action] = useActionState(loginAction, initial);
  return (
    <form action={action} className="auth-form">
      <FormMessage error={state.error} ok={notice} />
      <Field label="Email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} />
      <div className="field">
        <div className="row-between">
          <label htmlFor="f-password">Password</label>
          <Link href="/forgot-password" className="link" style={{ fontSize: 13.5 }}>
            Forgot password?
          </Link>
        </div>
        <input id="f-password" name="password" type="password" className="input" autoComplete="current-password" required />
      </div>
      <input type="hidden" name="next" value={next ?? ""} />
      <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
    </form>
  );
}

export function ForgotForm() {
  const [state, action] = useActionState(forgotAction, initial);
  return (
    <form action={action} className="auth-form">
      <FormMessage error={state.error} ok={state.ok} />
      {state.devLink && (
        <div className="notice notice-warn">
          <span>
            Development mode (no email server configured):{" "}
            <a className="link" href={state.devLink}>
              open the reset link
            </a>
          </span>
        </div>
      )}
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <SubmitButton pendingText="Sending…">Send reset link</SubmitButton>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetAction, initial);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="auth-form">
      <FormMessage error={state.error} />
      <input type="hidden" name="token" value={token} />
      <Field label="New password" name="password" type="password" autoComplete="new-password" required hint="At least 10 characters, with letters and a number." error={fe.password} />
      <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required error={fe.confirm} />
      <SubmitButton pendingText="Saving…">Set new password</SubmitButton>
    </form>
  );
}

export function InviteForm({ token, needsName }: { token: string; needsName: boolean }) {
  const [state, action] = useActionState(acceptInviteAction, initial);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="auth-form">
      <FormMessage error={state.error ?? fe.form} />
      <input type="hidden" name="token" value={token} />
      {needsName && <Field label="Your name" name="name" autoComplete="name" required error={fe.name} />}
      <Field
        label={needsName ? "Choose a password" : "Your password"}
        name="password"
        type="password"
        autoComplete={needsName ? "new-password" : "current-password"}
        required
        hint={needsName ? "At least 10 characters, with letters and a number." : undefined}
        error={fe.password}
      />
      <SubmitButton pendingText="Joining…">Join organization</SubmitButton>
    </form>
  );
}
