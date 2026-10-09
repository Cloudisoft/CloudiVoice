import Link from "next/link";
import { CALL_STATE_LABEL, type CallState } from "@cloudivoice/core/callState";
import { OUTCOMES, type Outcome } from "@cloudivoice/core/outcomes";
import { Icon, type IconName } from "./Icon";

export function PageHeader({ title, sub, actions, crumbs }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode; crumbs?: { href: string; label: string }[] }) {
  return (
    <div className="page-head">
      <div>
        {crumbs && (
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c) => (
              <span key={c.href}>
                <Link href={c.href}>{c.label}</Link> <span aria-hidden="true">/</span>
              </span>
            ))}
          </nav>
        )}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, body, actions }: { icon: IconName; title: string; body: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={22} />
      </span>
      <h3>{title}</h3>
      <p>{body}</p>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

const POSITIVE: string[] = ["appointment_booked", "qualified", "interested", "transferred", "callback_requested", "answered"];
const NEGATIVE: string[] = ["failed", "not_in_service", "disconnected", "dnc", "wrong_number"];

export function OutcomeChip({ outcome }: { outcome: string | null | undefined }) {
  if (!outcome) return <span className="chip">Pending</span>;
  const tone = POSITIVE.includes(outcome) ? "chip-ok" : NEGATIVE.includes(outcome) ? "chip-bad" : "chip-warn";
  return <span className={`chip ${tone}`}>{OUTCOMES[outcome as Outcome] ?? outcome}</span>;
}

export function StateChip({ state }: { state: string }) {
  const live = ["ringing", "answered", "in_progress", "transferring", "queued", "voicemail"].includes(state);
  return <span className={`chip chip-dot ${live ? "chip-accent" : state === "failed" ? "chip-bad" : ""}`}>{CALL_STATE_LABEL[state as CallState] ?? state}</span>;
}

export function Pager({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pager">
      <span>
        {from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
      </span>
      <span className="pager-links">
        {page > 1 ? (
          <Link className="btn btn-ghost btn-sm" href={hrefFor(page - 1)}>
            Previous
          </Link>
        ) : (
          <span className="btn btn-ghost btn-sm" aria-disabled="true">
            Previous
          </span>
        )}
        {page < pages ? (
          <Link className="btn btn-ghost btn-sm" href={hrefFor(page + 1)}>
            Next
          </Link>
        ) : (
          <span className="btn btn-ghost btn-sm" aria-disabled="true">
            Next
          </span>
        )}
      </span>
    </div>
  );
}

export function fmtDuration(sec: number | null | undefined) {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

export function fmtDate(d: Date | string | null | undefined, opts: { time?: boolean; tz?: string } = {}) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: opts.tz ?? "Asia/Kolkata",
    day: "numeric",
    month: "short",
    ...(opts.time === false ? {} : { hour: "numeric", minute: "2-digit" }),
  }).format(new Date(d));
}

export function leadName(first?: string | null, last?: string | null) {
  const n = [first, last].filter(Boolean).join(" ").trim();
  return n || "No name on file";
}

export function qs(base: Record<string, string | number | undefined | null>, patch: Record<string, string | number | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...patch })) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
