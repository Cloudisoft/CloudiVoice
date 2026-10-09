"use client";

export function HearItButton({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event("cv:play-sample"))}>
      {children}
    </button>
  );
}
