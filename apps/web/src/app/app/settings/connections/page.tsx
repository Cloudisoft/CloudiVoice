import { env, liveStackStatus } from "@cloudivoice/core/env";
import { listConnections } from "@cloudivoice/core/services/org";
import { fmtDate } from "@/components/ui/kit";
import { tenant } from "@/lib/session";
import { CheckButton } from "./CheckButton";

export const metadata = { title: "Connections" };

export default async function ConnectionsPage() {
  const conns = await tenant((tx) => listConnections(tx), "integrations.manage");
  const stack = liveStackStatus();
  const rows = [
    { kind: "telephony", name: "Telephony connection", ready: stack.telephony, what: "Places and receives calls on Indian phone numbers, transfers and recordings.", extra: `Audio format: ${env.telephonyStreamFormat === "l16-16k" ? "wideband 16 kHz" : "standard 8 kHz"}` },
    { kind: "speech", name: "Speech engine", ready: stack.speech, what: "Understands callers (speech-to-text) and speaks in natural Indian voices (text-to-speech).", extra: "" },
    { kind: "reasoning", name: "Reasoning engine", ready: stack.llm, what: "Decides what the agent says next, uses tools and your knowledge base.", extra: "" },
  ];
  return (
    <div className="grid-main-side">
      <section className="panel">
        <div className="panel-head">
          <h2>Voice connections</h2>
        </div>
        <div className="panel-body">
          <ul className="checklist">
            {rows.map((r) => {
              const c = conns.find((x) => x.kind === r.kind);
              return (
                <li key={r.kind}>
                  <span className={`mark ${r.ready ? (c?.status === "failed" ? "mark-bad" : "mark-ok") : "mark-bad"}`}>{r.ready && c?.status !== "failed" ? "✓" : "!"}</span>
                  <span>
                    <b>{r.name}</b>
                    <span className="d">{r.what}</span>
                    <span className="d" style={{ marginTop: 4 }}>
                      {!r.ready ? "Not configured for this workspace." : c?.lastCheckedAt ? `Last check ${fmtDate(c.lastCheckedAt)}: ${c.status}${c.lastError ? ` — ${c.lastError}` : ""}` : "Configured. Run a check to verify."}
                      {r.extra && ` · ${r.extra}`}
                    </span>
                  </span>
                  <span className={`chip ${r.ready ? "chip-ok" : "chip-bad"}`}>{r.ready ? "Configured" : "Missing"}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Check health</h2>
        </div>
        <div className="panel-body stack">
          <p className="field-hint" style={{ margin: 0 }}>
            Voice connections are managed by Cloudisoft and shared securely across your workspace. Credentials are never shown in the dashboard or sent to your browser.
          </p>
          <CheckButton />
        </div>
      </section>
    </div>
  );
}
