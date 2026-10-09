import { parseAgentConfig } from "@cloudivoice/core/agentConfig";
import { liveStackStatus } from "@cloudivoice/core/env";
import { DEMO_SCENARIOS, getDemoScenario } from "@cloudivoice/core/demoScenarios";
import Link from "next/link";
import { AgentEditor } from "@/components/dash/AgentEditor";
import { PageHeader } from "@/components/ui/kit";
import { agentOptions } from "@/lib/options";
import { requirePermission } from "@/lib/session";

export const metadata = { title: "New agent" };

export default async function NewAgentPage({ searchParams }: { searchParams: Promise<{ template?: string; lang?: string }> }) {
  const user = await requirePermission("agents.edit");
  const sp = await searchParams;
  const tpl = sp.template ? getDemoScenario(sp.template) : undefined;
  const lang = sp.lang === "en-IN" ? "en-IN" : "hi-IN";
  const config = tpl
    ? { ...tpl.config(lang), company_name: user.orgName, max_duration_sec: 900, knowledge_enabled: true }
    : parseAgentConfig({ company_name: user.orgName, primary_language: lang });
  const opts = agentOptions();
  return (
    <>
      <PageHeader title="New agent" crumbs={[{ href: "/app/agents", label: "AI Agents" }]} sub="Start from a template or from scratch. You can test before activating." />
      <div className="pill-tabs" style={{ marginBottom: 18, flexWrap: "wrap" }}>
        <Link href={`/app/agents/new?lang=${lang}`} aria-current={!tpl ? "page" : undefined}>
          Blank
        </Link>
        {DEMO_SCENARIOS.map((s) => (
          <Link key={s.id} href={`/app/agents/new?template=${s.id}&lang=${lang}`} aria-current={tpl?.id === s.id ? "page" : undefined}>
            {s.label}
          </Link>
        ))}
      </div>
      <AgentEditor
        key={`${tpl?.id ?? "blank"}-${lang}`}
        name={tpl ? `${tpl.label} agent` : ""}
        config={config}
        useCases={opts.useCases}
        languages={opts.languages}
        voices={opts.voices}
        canPreview={liveStackStatus().speech}
      />
    </>
  );
}
