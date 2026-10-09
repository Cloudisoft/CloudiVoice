import { SettingsTabs } from "./SettingsTabs";
import { hasPermission, requireOrgUser } from "@/lib/session";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireOrgUser();
  const tabs = [
    { href: "/app/settings", label: "Organization" },
    { href: "/app/settings/team", label: "Team & roles" },
    ...(hasPermission(user, "integrations.manage") ? [{ href: "/app/settings/connections", label: "Connections" }] : []),
    { href: "/app/settings/security", label: "Security" },
    ...(hasPermission(user, "audit.view") ? [{ href: "/app/settings/audit", label: "Audit log" }, { href: "/app/settings/health", label: "System health" }] : []),
  ];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
        </div>
      </div>
      <SettingsTabs tabs={tabs} />
      {children}
    </>
  );
}
