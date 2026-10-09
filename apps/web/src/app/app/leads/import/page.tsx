import { listLeadLists } from "@cloudivoice/core/services/leads";
import { PageHeader } from "@/components/ui/kit";
import { tenant } from "@/lib/session";
import { ImportWizard } from "./ImportWizard";

export const metadata = { title: "Import leads" };

export default async function ImportPage() {
  const lists = await tenant((tx) => listLeadLists(tx), "leads.edit");
  return (
    <>
      <PageHeader title="Import leads" crumbs={[{ href: "/app/leads", label: "Leads" }]} sub="Numbers are normalised to +91 (E.164), duplicates removed and DNC numbers flagged automatically." />
      <ImportWizard lists={lists.map((l) => ({ id: l.id, name: l.name }))} />
    </>
  );
}
