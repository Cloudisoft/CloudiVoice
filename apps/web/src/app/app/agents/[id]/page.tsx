import Link from "next/link";
import { notFound } from "next/navigation";
import { liveStackStatus } from "@cloudivoice/core/env";
import { getAgent, listVersions } from "@cloudivoice/core/services/agents";
import { telephony } from "@cloudivoice/core/telephony";
import { AgentEditor } from "@/components/dash/AgentEditor";
import { AgentTest } from "@/components/dash/AgentTest";
import { fmtDate, PageHeader } from "@/components/ui/kit";
import { agentOptions } from "@/lib/options";
import { hasPermission, tenant } from "@/lib/session";
import { deleteAgentAction, rollbackAction, setStatusAction } from "../actions";

export default async function AgentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { agent, versions, numbers, user } = await tenant(async (tx, user) => ({
    agent: await getAgent(tx, id),
    versions: await listVersions(tx, id),
    numbers: await tx<{ id: string; e164: string }[]>`select id, e164 from phone_numbers where status = 'active' and voice_outbound order by created_at`,
    user,
  }));
  if (!agent) notFound();
  const canEdit = hasPermission(user, "agents.edit");
  const stack = liveStackStatus();
  const opts = agentOptions();

  return (
    <>
      <PageHeader
        title={agent.name}
        crumbs={[{ href: "/app/agents", label: "AI Agents" }]}
        sub={
          <>
            <span className={`chip chip-dot ${agent.status === "active" ? "chip-ok" : agent.status === "draft" ? "" : "chip-warn"}`}>{agent.status}</span>{" "}
            <span className="mono" style={{ marginLeft: 8 }}>
              v{agent.current_version}
            </span>
          </>
        }
        actions={
          canEdit && (
            <form action={setStatusAction}>
              <input type="hidden" name="id" value={agent.id} />
              <input type="hidden" name="status" value={agent.status === "active" ? "inactive" : "active"} />
              <button className={`btn btn-sm ${agent.status === "active" ? "btn-ghost" : "btn-accent"}`}>{agent.status === "active" ? "Deactivate" : "Activate agent"}</button>
            </form>
          )
        }
      />
      {sp.created && (
        <div className="notice notice-ok" style={{ marginBottom: 16 }}>
          Agent created. Test it on the right, then activate it when it sounds right.
        </div>
      )}
      <div className="grid-main-side">
        <AgentEditor
          id={agent.id}
          name={agent.name}
          config={agent.config}
          useCases={opts.useCases}
          languages={opts.languages}
          voices={opts.voices}
          canPreview={stack.speech}
          readOnly={!canEdit}
        />
        <div className="stack">
          <AgentTest agentId={agent.id} browserReady={stack.browserDemo} phoneReady={stack.phoneCalls && Boolean(telephony()) && numbers.length > 0} numbers={numbers} />
          <section className="panel">
            <div className="panel-head">
              <h3>Version history</h3>
            </div>
            <ul className="checklist" style={{ padding: "0 18px" }}>
              {versions.map((v) => (
                <li key={v.version}>
                  <span className={`mark ${v.version === agent.current_version ? "mark-ok" : "mark-warn"}`} style={{ fontSize: 10 }}>
                    v{v.version}
                  </span>
                  <span>
                    <b style={{ fontWeight: 500 }}>{v.note ?? "Saved"}</b>
                    <span className="d">
                      {fmtDate(v.created_at)} · {v.author ?? "—"}
                    </span>
                  </span>
                  {canEdit && v.version !== agent.current_version ? (
                    <form action={rollbackAction}>
                      <input type="hidden" name="id" value={agent.id} />
                      <input type="hidden" name="version" value={v.version} />
                      <button className="btn btn-quiet btn-sm">Restore</button>
                    </form>
                  ) : (
                    <span className="field-hint">{v.version === agent.current_version ? "Current" : ""}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h3>Related</h3>
            </div>
            <div className="panel-body" style={{ display: "grid", gap: 8 }}>
              <Link className="link" href={`/app/calls?agent=${agent.id}`}>
                Calls handled by this agent →
              </Link>
              <Link className="link" href="/app/knowledge">
                Knowledge Base →
              </Link>
              {canEdit && (
                <form action={deleteAgentAction} style={{ marginTop: 8 }}>
                  <input type="hidden" name="id" value={agent.id} />
                  <button className="btn btn-danger btn-sm">Delete agent</button>
                </form>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
