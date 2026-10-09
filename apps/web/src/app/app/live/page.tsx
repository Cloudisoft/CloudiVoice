import { PageHeader } from "@/components/ui/kit";
import { hasPermission, requirePermission } from "@/lib/session";
import { LiveMonitor } from "./LiveMonitor";

export const metadata = { title: "Live Monitor" };

export default async function LivePage() {
  const user = await requirePermission("calls.view");
  return (
    <>
      <PageHeader title="Live Monitor" sub="Every call in progress, with its transcript updating live. Supervisors can transfer or end a call." />
      <LiveMonitor canSupervise={hasPermission(user, "calls.supervise")} canTransfer={hasPermission(user, "calls.supervise")} />
    </>
  );
}
