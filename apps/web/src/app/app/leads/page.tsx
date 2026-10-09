import Link from "next/link";
import { OUTCOMES } from "@cloudivoice/core/outcomes";
import { formatPhone } from "@cloudivoice/core/phone";
import { listLeadLists, listLeads } from "@cloudivoice/core/services/leads";
import { Icon } from "@/components/ui/Icon";
import { EmptyState, fmtDate, leadName, OutcomeChip, PageHeader, Pager, qs } from "@/components/ui/kit";
import { hasPermission, tenant } from "@/lib/session";
import { LeadTable } from "./LeadTable";

export const metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const filter = { q: sp.q, listId: sp.list, outcome: sp.outcome, status: sp.status };
  const { data, lists, user } = await tenant(async (tx, user) => ({ data: await listLeads(tx, filter, page, 50), lists: await listLeadLists(tx), user }));
  const base = { q: sp.q, list: sp.list, outcome: sp.outcome, status: sp.status };
  const filtered = Boolean(sp.q || sp.list || sp.outcome || sp.status);
  const canEdit = hasPermission(user, "leads.edit");

  return (
    <>
      <PageHeader
        title="Leads"
        sub="Search by name, email or phone in any format — 98765 43210, +91-98765-43210 and 09876543210 all find the same person."
        actions={
          <>
            {hasPermission(user, "leads.export") && data.total > 0 && (
              <a className="btn btn-ghost btn-sm" href={`/api/leads/export${qs(base, {})}`}>
                <Icon name="download" /> Export CSV
              </a>
            )}
            {canEdit && (
              <Link href="/app/leads/import" className="btn btn-accent btn-sm">
                <Icon name="upload" /> Import leads
              </Link>
            )}
          </>
        }
      />
      <section className="panel">
        <form className="filters" role="search">
          <input type="search" name="q" className="input" placeholder="Search name, email, phone…" defaultValue={sp.q} aria-label="Search leads" />
          <select name="list" className="select" defaultValue={sp.list ?? ""} aria-label="List">
            <option value="">All lists</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <select name="outcome" className="select" defaultValue={sp.outcome ?? ""} aria-label="Last outcome">
            <option value="">Any outcome</option>
            <option value="none">Not called yet</option>
            {Object.entries(OUTCOMES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button className="btn btn-ghost btn-sm">Filter</button>
          {filtered && (
            <Link href="/app/leads" className="btn btn-quiet btn-sm">
              Clear
            </Link>
          )}
        </form>
        {data.total === 0 ? (
          filtered ? (
            <EmptyState icon="search" title="No leads match" body="Try a different search or clear the filters." />
          ) : (
            <EmptyState
              icon="leads"
              title="No leads yet"
              body="Import a CSV or Excel file. We normalise every number to +91 format, remove duplicates and flag invalid numbers."
              actions={
                canEdit && (
                  <Link href="/app/leads/import" className="btn btn-accent btn-sm">
                    Import leads
                  </Link>
                )
              }
            />
          )
        ) : (
          <>
            <LeadTable
              rows={data.rows.map((r) => ({
                id: r.id,
                name: leadName(r.first_name, r.last_name),
                phone: formatPhone(r.phone_e164),
                email: r.email,
                city: r.city,
                outcome: r.last_outcome ? <OutcomeChip outcome={r.last_outcome} /> : <span className="muted">Not called</span>,
                attempts: r.attempts,
                dnc: r.dnc,
                created: fmtDate(r.created_at, { time: false }),
              }))}
              lists={lists.map((l) => ({ id: l.id, name: l.name }))}
              filter={Object.fromEntries(Object.entries(base).filter(([, v]) => v)) as Record<string, string>}
              total={data.total}
              canEdit={canEdit}
              canDelete={hasPermission(user, "leads.delete")}
            />
            <Pager page={page} pageSize={50} total={data.total} hrefFor={(p) => `/app/leads${qs(base, { page: p })}`} />
          </>
        )}
      </section>
    </>
  );
}
