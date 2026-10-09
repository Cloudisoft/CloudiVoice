import { KNOWLEDGE_TYPES, listDocuments } from "@cloudivoice/core/services/knowledge";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { EmptyState, fmtDate, PageHeader } from "@/components/ui/kit";
import { hasPermission, tenant } from "@/lib/session";
import { deleteKnowledgeAction } from "./actions";
import { UploadForm } from "./UploadForm";

export const metadata = { title: "Knowledge Base" };

export default async function KnowledgePage() {
  const { docs, agents, user } = await tenant(async (tx, user) => ({
    docs: await listDocuments(tx),
    agents: await tx<{ id: string; name: string }[]>`select id, name from agents order by name`,
    user,
  }));
  const canEdit = hasPermission(user, "knowledge.edit");
  return (
    <>
      <PageHeader title="Knowledge Base" sub="Agents search these documents during calls to answer questions about prices, policies and FAQs — instead of guessing." />
      <div className="grid-main-side">
        <section className="panel">
          <div className="panel-head">
            <h2>Documents</h2>
            <span className="field-hint">{docs.filter((d) => d.status === "ready").length} ready</span>
          </div>
          {docs.length === 0 ? (
            <EmptyState icon="book" title="No documents yet" body="Upload your FAQ, price list or policy documents. We split them into sections and make them searchable for your agents." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Type</th>
                    <th>Agent</th>
                    <th>Status</th>
                    <th className="num">Sections</th>
                    <th>Added</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id}>
                      <td className="strong">{d.filename}</td>
                      <td>{KNOWLEDGE_TYPES[d.mime_type] ?? d.filename.split(".").pop()?.toUpperCase()}</td>
                      <td>{d.agent_name ?? "All agents"}</td>
                      <td>
                        {d.status === "ready" ? (
                          <span className="chip chip-ok chip-dot">Ready</span>
                        ) : d.status === "failed" ? (
                          <span className="chip chip-bad chip-dot" title={d.error ?? ""}>
                            Failed
                          </span>
                        ) : (
                          <span className="chip chip-warn chip-dot">Processing</span>
                        )}
                        {d.error && <div className="field-error" style={{ marginTop: 4 }}>{d.error}</div>}
                      </td>
                      <td className="num">{d.chunk_count}</td>
                      <td className="muted">{fmtDate(d.created_at)}</td>
                      <td className="num">
                        {canEdit && (
                          <form action={deleteKnowledgeAction}>
                            <input type="hidden" name="id" value={d.id} />
                            <ConfirmButton message={`Remove ${d.filename} from the knowledge base?`} className="btn btn-quiet btn-sm">
                              Remove
                            </ConfirmButton>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {canEdit && (
          <section className="panel">
            <div className="panel-head">
              <h2>Add documents</h2>
            </div>
            <div className="panel-body">
              <UploadForm agents={agents} />
              <p className="field-hint" style={{ marginTop: 14 }}>
                Scanned PDFs (images only) can’t be read — upload a text-based PDF or a Word file instead.
              </p>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
