import { allLanguages } from "@cloudivoice/core/languages";
import { listLeadLists } from "@cloudivoice/core/services/leads";
import { PageHeader } from "@/components/ui/kit";
import { tenant } from "@/lib/session";
import { AddLeadForm } from "./AddLeadForm";

export const metadata = { title: "Add lead" };

export default async function NewLeadPage({ searchParams }: { searchParams: Promise<{ list?: string }> }) {
  const sp = await searchParams;
  const lists = await tenant((tx) => listLeadLists(tx), "leads.edit");
  return (
    <>
      <PageHeader
        title="Add a lead"
        crumbs={[{ href: "/app/leads", label: "Leads" }]}
        sub="Enter a contact by hand. The number is cleaned to +91 format, duplicates are caught and Do-Not-Call numbers are flagged — just like an import."
      />
      <AddLeadForm
        lists={lists.map((l) => ({ id: l.id, name: l.name }))}
        languages={allLanguages().map((l) => ({ code: l.code, name: l.name }))}
        defaultList={sp.list && lists.some((l) => l.id === sp.list) ? sp.list : ""}
      />
    </>
  );
}
