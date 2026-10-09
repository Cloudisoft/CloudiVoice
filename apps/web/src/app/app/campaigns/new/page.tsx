import { listLeadLists } from "@cloudivoice/core/services/leads";
import { PageHeader } from "@/components/ui/kit";
import { tenant } from "@/lib/session";
import { CampaignForm } from "../CampaignForm";

export const metadata = { title: "New campaign" };

export default async function NewCampaignPage() {
  const data = await tenant(async (tx) => ({
    agents: await tx<{ id: string; name: string; status: string }[]>`select id, name, status from agents order by name`,
    lists: await listLeadLists(tx),
    numbers: await tx<{ id: string; e164: string; label: string | null }[]>`select id, e164, label from phone_numbers where status = 'active' and voice_outbound order by created_at`,
    org: (await tx<{ calling_window_start: string; calling_window_end: string }[]>`select calling_window_start, calling_window_end from organizations`)[0]!,
  }), "campaigns.edit");
  return (
    <>
      <PageHeader title="New campaign" crumbs={[{ href: "/app/campaigns", label: "Campaigns" }]} sub="Campaigns start as drafts. Preflight checks run before the first call." />
      <CampaignForm
        d={{
          name: "",
          agent_id: data.agents.find((a) => a.status === "active")?.id ?? null,
          list_ids: [],
          number_ids: data.numbers.map((n) => n.id),
          transfer_number: "",
          intro_name: "",
          voicemail_message: "",
          max_concurrency: 2,
          calls_per_minute: 10,
          max_attempts: 3,
          window_start: "",
          window_end: "",
          retry_rules: { no_answer: { retry: true, delay_minutes: 120 }, busy: { retry: true, delay_minutes: 30 }, voicemail: { retry: true, delay_minutes: 240 }, failed: { retry: true, delay_minutes: 60 }, callback_requested: { retry: true, delay_minutes: 1440 } },
        }}
        agents={data.agents}
        lists={data.lists.map((l) => ({ id: l.id, name: l.name, total: l.total }))}
        numbers={data.numbers}
        orgWindow={`${data.org.calling_window_start.slice(0, 5)}–${data.org.calling_window_end.slice(0, 5)}`}
      />
    </>
  );
}
