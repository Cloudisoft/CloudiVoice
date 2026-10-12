import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { switchOrg, userOrgs } from "@cloudivoice/core/services/auth";
import { withTenant } from "@cloudivoice/core/db/client";
import { Sidebar, type NavItem } from "@/components/dash/Sidebar";
import { hasPermission, requireOrgUser, sessionToken } from "@/lib/session";
import { logoutAction } from "../(auth)/actions";
import "./dashboard.css";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireOrgUser();
  // One round trip for everything the shell needs (alongside the org list).
  const [orgs, shell] = await Promise.all([
    userOrgs(user.userId),
    withTenant(user.orgId, async (tx) => {
      const [r] = await tx<{ live: number; onboarded: boolean; has_agent: boolean }[]>`
        select (select count(*)::int from calls where state in ('ringing','answered','in_progress','transferring') and created_at > now() - interval '3 hours') as live,
               (select onboarding_completed_at is not null from organizations limit 1) as onboarded,
               exists (select 1 from agents) as has_agent`;
      return r!;
    }),
  ]);
  const liveCount = shell.live;
  if (!shell.onboarded && user.role === "admin" && !shell.has_agent) redirect("/onboarding");

  const items: NavItem[] = [
    { href: "/app", label: "Overview", icon: "home", group: "main" },
    { href: "/app/agents", label: "AI Agents", icon: "agent", group: "Build" },
    { href: "/app/knowledge", label: "Knowledge Base", icon: "book", group: "Build" },
    { href: "/app/leads", label: "Leads", icon: "leads", group: "Reach" },
    { href: "/app/lists", label: "Lead Lists", icon: "list", group: "Reach" },
    { href: "/app/numbers", label: "Phone Numbers", icon: "phone", group: "Reach" },
    { href: "/app/campaigns", label: "Campaigns", icon: "campaign", group: "Reach" },
    { href: "/app/live", label: "Live Monitor", icon: "live", group: "Operate", count: liveCount },
    { href: "/app/calls", label: "Call Records", icon: "records", group: "Operate" },
    { href: "/app/callbacks", label: "Callbacks", icon: "callback", group: "Operate" },
    { href: "/app/analytics", label: "Analytics & QA", icon: "chart", group: "Operate" },
    { href: "/app/settings", label: "Settings", icon: "settings", group: "Account" },
  ];
  if (hasPermission(user, "billing.view")) items.push({ href: "/app/billing", label: "Usage & Billing", icon: "wallet", group: "Account" });

  async function switchOrgAction(orgId: string) {
    "use server";
    const token = await sessionToken();
    const u = await requireOrgUser();
    if (token) await switchOrg(token, u.userId, orgId);
    revalidatePath("/app", "layout");
  }

  return (
    <div className="dash">
      <Sidebar
        items={items}
        user={{ name: user.name, email: user.email }}
        org={{ id: user.orgId, name: user.orgName, role: user.role }}
        orgs={orgs.map((o) => ({ id: o.id, name: o.name }))}
        switchOrg={switchOrgAction}
        logout={logoutAction}
      />
      <main id="main" className="dash-main">
        {children}
      </main>
    </div>
  );
}
