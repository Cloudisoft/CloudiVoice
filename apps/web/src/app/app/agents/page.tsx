import Link from "next/link";
import { USE_CASES, type UseCase } from "@cloudivoice/core/agentConfig";
import { getLanguage } from "@cloudivoice/core/languages";
import { listAgents } from "@cloudivoice/core/services/agents";
import { Icon } from "@/components/ui/Icon";
import { EmptyState, fmtDate, PageHeader } from "@/components/ui/kit";
import { hasPermission, tenant } from "@/lib/session";

export const metadata = { title: "AI Agents" };

export default async function AgentsPage() {
  const { agents, user } = await tenant(async (tx, user) => ({ agents: await listAgents(tx), user }));
  const canEdit = hasPermission(user, "agents.edit");
  return (
    <>
      <PageHeader
        title="AI Agents"
        sub="Each agent has its own language, voice, instructions and knowledge. Every save creates a version you can roll back to."
        actions={
          canEdit && (
            <Link href="/app/agents/new" className="btn btn-accent btn-sm">
              <Icon name="plus" /> New agent
            </Link>
          )
        }
      />
      <section className="panel">
        {agents.length === 0 ? (
          <EmptyState
            icon="agent"
            title="Create your first agent"
            body="Start from a template — receptionist, sales, support, recruitment or follow-up — and customise it in minutes."
            actions={
              canEdit && (
                <Link href="/app/agents/new" className="btn btn-accent btn-sm">
                  Create agent
                </Link>
              )
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Use case</th>
                  <th>Language</th>
                  <th>Status</th>
                  <th className="num">Version</th>
                  <th className="num">Calls · 7d</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link className="row-link" href={`/app/agents/${a.id}`}>
                        {a.name}
                      </Link>
                    </td>
                    <td>{USE_CASES[a.use_case as UseCase] ?? a.use_case}</td>
                    <td>{getLanguage(a.primary_language)?.name ?? a.primary_language}</td>
                    <td>
                      <span className={`chip chip-dot ${a.status === "active" ? "chip-ok" : a.status === "draft" ? "" : "chip-warn"}`}>{a.status}</span>
                    </td>
                    <td className="num mono">v{a.current_version}</td>
                    <td className="num">{a.calls_7d}</td>
                    <td className="muted">{fmtDate(a.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
