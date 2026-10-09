"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ children, className = "btn btn-accent", pendingText }: { children: React.ReactNode; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? (pendingText ?? "Working…") : children}
    </button>
  );
}

export function Field({
  label,
  name,
  type = "text",
  error,
  hint,
  defaultValue,
  autoComplete,
  required,
  placeholder,
  minLength,
  inputMode,
}: {
  label: string;
  name: string;
  type?: string;
  error?: string;
  hint?: string;
  defaultValue?: string;
  autoComplete?: string;
  required?: boolean;
  placeholder?: string;
  minLength?: number;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  const id = `f-${name}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type={type}
        className="input"
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        required={required}
        placeholder={placeholder}
        minLength={minLength}
        inputMode={inputMode}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
      />
      {hint && !error && (
        <span id={`${id}-hint`} className="field-hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-err`} className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function FormMessage({ error, ok }: { error?: string; ok?: string }) {
  if (error)
    return (
      <div className="notice notice-bad" role="alert">
        {error}
      </div>
    );
  if (ok)
    return (
      <div className="notice notice-ok" role="status">
        {ok}
      </div>
    );
  return null;
}
