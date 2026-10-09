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
  const [orgs, liveCount, onboarding] = await Promise.all([
    userOrgs(user.userId),
    withTenant(user.orgId, async (tx) => {
      const [r] = await tx<{ n: number }[]>`select count(*)::int as n from calls where state in ('ringing','answered','in_progress','transferring') and created_at > now() - interval '3 hours'`;
      return r?.n ?? 0;
    }),
    withTenant(user.orgId, async (tx) => {
      const [o] = await tx<{ onboarding_completed_at: Date | null }[]>`select onboarding_completed_at from organizations`;
      return o?.onboarding_completed_at ?? null;
    }),
  ]);
  if (!onboarding && user.role === "admin") {
    const agents = await withTenant(user.orgId, (tx) => tx`select 1 from agents limit 1`);
    if (agents.length === 0) redirect("/onboarding");
  }

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
