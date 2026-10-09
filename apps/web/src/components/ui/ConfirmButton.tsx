"use client";

/** Submit button that asks for confirmation before destructive actions. */
export function ConfirmButton({ message, className = "btn btn-danger btn-sm", children }: { message: string; className?: string; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
