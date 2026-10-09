import { getOrg } from "@cloudivoice/core/services/org";
import { hasPermission, tenant } from "@/lib/session";
import { agentOptions } from "@/lib/options";
import { OrgForm } from "./OrgForm";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { org, user } = await tenant(async (tx, user) => ({ org: await getOrg(tx), user }));
  return (
    <OrgForm
      readOnly={!hasPermission(user, "settings.manage")}
      languages={agentOptions().languages}
      v={{
        name: org.name,
        industry: org.industry ?? "",
        website: org.website ?? "",
        timezone: org.timezone,
        default_language: org.default_language,
        calling_window_start: org.calling_window_start.slice(0, 5),
        calling_window_end: org.calling_window_end.slice(0, 5),
        calling_days: org.calling_days,
        record_calls: org.record_calls,
        recording_disclosure: org.recording_disclosure,
        retention_days: org.retention_days,
        max_concurrency: org.max_concurrency,
        monthly_spend_limit: org.monthly_spend_limit_paise ? String(Number(org.monthly_spend_limit_paise) / 100) : "",
      }}
    />
  );
}
