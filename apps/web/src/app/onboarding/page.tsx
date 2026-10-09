import Link from "next/link";
import { redirect } from "next/navigation";
import { defaultOpening, USE_CASES } from "@cloudivoice/core/agentConfig";
import { getDemoScenario } from "@cloudivoice/core/demoScenarios";
import { liveStackStatus } from "@cloudivoice/core/env";
import { getAgent } from "@cloudivoice/core/services/agents";
import { getOrg } from "@cloudivoice/core/services/org";
import { Logo } from "@/components/brand/Logo";
import { AgentTest } from "@/components/dash/AgentTest";
import { agentOptions } from "@/lib/options";
import { requireOrgUser, tenant } from "@/lib/session";
import { UploadForm } from "../app/knowledge/UploadForm";
import { agentStep, advanceStep, businessStep, finishOnboarding, instructionsStep, voiceStep } from "./actions";
import { STEPS, type Step } from "./steps";
import "../app/dashboard.css";
import "./onboarding.css";

export const metadata = { title: "Set up your workspace" };

const TITLES: Record<Step, [string, string]> = {
  business: ["Tell us about your business", "This helps your agent introduce itself correctly and call within the right hours."],
  voice: ["Choose a language and voice", "You can change these any time and test how they sound."],
  agent: ["Create your agent", "Who is calling, on whose behalf, and how it opens the conversation."],
  instructions: ["Instructions and goals", "What the agent should know and achieve on every call."],
  knowledge: ["Add knowledge (optional)", "Upload FAQs, price lists or policies so the agent answers from facts."],
  telephony: ["Phone numbers", "Connect a number to make and receive real calls."],
  test: ["Test your agent", "Talk to it in your browser or get a call on your phone."],
  checks: ["Ready to deploy?", "A final check before you go live."],
};

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOrgUser();
  if (user.role !== "admin") redirect("/app");
  const sp = await searchParams;
  const { org, agent, numbers, docs } = await tenant(async (tx) => {
    const [a] = await tx<{ id: string }[]>`select id from agents order by created_at limit 1`;
    return {
      org: await getOrg(tx),
      agent: a ? await getAgent(tx, a.id) : null,
      numbers: await tx<{ id: string; e164: string; inbound_agent_id: string | null }[]>`select id, e164, inbound_agent_id from phone_numbers where status = 'active' order by created_at`,
      docs: (await tx<{ n: number }[]>`select count(*)::int as n from knowledge_documents where status = 'ready'`)[0]!.n,
    };
  });
  if (org.onboarding_completed_at && !sp.step) redirect("/app");
  const saved = (sp.step ?? org.onboarding_step) as Step;
  let step: Step = STEPS.includes(saved) ? saved : "business";
  if (!agent && STEPS.indexOf(step) > STEPS.indexOf("voice")) step = "voice";
  const idx = STEPS.indexOf(step);
  const scenario = getDemoScenario(sp.scenario ?? "");
  const lang = sp.lang === "en-IN" || sp.lang === "hi-IN" ? sp.lang : undefined;
  const carry = (
    <>
      {scenario && <input type="hidden" name="scenario" value={scenario.id} />}
      {lang && <input type="hidden" name="lang" value={lang} />}
    </>
  );
  const opts = agentOptions();
  const stack = liveStackStatus();
  const cfg = agent?.config;
  const nav = (to: Step, label: string, cls = "btn btn-ghost") => (
    <form action={advanceStep}>
      <input type="hidden" name="to" value={to} />
      {carry}
      <button className={cls}>{label}</button>
    </form>
  );
  const backQs = new URLSearchParams({ step: STEPS[Math.max(0, idx - 1)]! });
  if (scenario) backQs.set("scenario", scenario.id);
  if (lang) backQs.set("lang", lang);
  const back =
    idx > 0 ? (
      <Link href={`/onboarding?${backQs}`} className="btn btn-quiet">
        Back
      </Link>
    ) : null;

  return (
    <div className="onb">
      <header className="onb-head">
        <Logo href="/onboarding" />
        <Link href="/app" className="btn btn-quiet btn-sm">
          Skip setup
        </Link>
      </header>
      <main id="main" className="onb-main">
        <div className="steps-rail" aria-label={`Step ${idx + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <span key={s} className={i < idx ? "done" : i === idx ? "current" : ""}>
              <i />
              {i + 1}. {s === "telephony" ? "Numbers" : s[0]!.toUpperCase() + s.slice(1)}
            </span>
          ))}
        </div>
        <h1 className="onb-title">{TITLES[step][0]}</h1>
        <p className="onb-sub">{TITLES[step][1]}</p>
        {scenario && idx <= 2 && (
          <div className="notice" style={{ marginBottom: 18 }}>
            Starting from the <b>&nbsp;{scenario.label}&nbsp;</b> demo you tried{lang ? ` in ${lang === "hi-IN" ? "Hindi" : "English"}` : ""}.
          </div>
        )}

        {step === "business" && (
          <form action={businessStep} className="panel panel-body form-grid">
            {carry}
            <div className="field">
              <label htmlFor="b-name">Business name</label>
              <input id="b-name" name="name" className="input" defaultValue={org.name} required />
            </div>
            <div className="field">
              <label htmlFor="b-ind">Industry</label>
              <select id="b-ind" name="industry" className="select" defaultValue={org.industry ?? ""}>
                <option value="">Choose…</option>
                {["Healthcare", "Real estate", "Education", "Financial services", "Retail & e-commerce", "Recruitment & staffing", "Professional services", "Other"].map((i) => (
                  <option key={i}>{i}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="b-web">Website</label>
              <input id="b-web" name="website" className="input" defaultValue={org.website ?? ""} placeholder="https://" />
            </div>
            <div className="field">
              <label htmlFor="b-size">Team size</label>
              <select id="b-size" name="team_size" className="select" defaultValue={org.team_size ?? ""}>
                <option value="">Choose…</option>
                {["1–10", "11–50", "51–200", "200+"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="b-tz">Time zone</label>
              <select id="b-tz" name="timezone" className="select" defaultValue={org.timezone}>
                <option value="Asia/Kolkata">India (IST)</option>
                <option value="Asia/Dubai">UAE (GST)</option>
                <option value="Asia/Singapore">Singapore</option>
                <option value="Europe/London">UK</option>
              </select>
            </div>
            <div className="form-actions span-2">
              <button className="btn btn-accent">Continue</button>
            </div>
          </form>
        )}

        {step === "voice" && (
          <form action={voiceStep} className="panel panel-body form-grid">
            {carry}
            <div className="field">
              <label htmlFor="v-lang">Primary language</label>
              <select id="v-lang" name="primary_language" className="select" defaultValue={cfg?.primary_language ?? lang ?? org.default_language}>
                {opts.languages.map((l) => (
                  <option key={l.value} value={l.value} disabled={l.disabled}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="v-voice">Voice</label>
              <select id="v-voice" name="voice" className="select" defaultValue={cfg?.voice ?? scenario?.config("hi-IN").voice ?? "priya"}>
                {opts.voices.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label} — {v.gender}, {v.style.toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="v-tone">Tone</label>
              <select id="v-tone" name="tone" className="select" defaultValue={cfg?.tone ?? "warm"}>
                <option value="warm">Warm</option>
                <option value="professional">Professional</option>
                <option value="energetic">Energetic</option>
                <option value="calm">Calm</option>
              </select>
            </div>
            <p className="field-hint span-2">Hindi and Indian English are live. Gujarati, Marathi, Bengali, Tamil, Telugu, Kannada and Malayalam are being validated and will appear here once ready.</p>
            <div className="form-actions span-2">
              {back}
              <button className="btn btn-accent">Continue</button>
            </div>
          </form>
        )}

        {step === "agent" && cfg && agent && (
          <form action={agentStep} className="panel panel-body form-grid">
            {carry}
            <div className="field">
              <label htmlFor="g-name">Agent name (internal)</label>
              <input id="g-name" name="name" className="input" defaultValue={agent.name} />
            </div>
            <div className="field">
              <label htmlFor="g-use">Use case</label>
              <select id="g-use" name="use_case" className="select" defaultValue={cfg.use_case}>
                {Object.entries(USE_CASES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="g-persona">Introduces itself as</label>
              <input id="g-persona" name="persona_name" className="input" defaultValue={cfg.persona_name} />
            </div>
            <div className="field">
              <label htmlFor="g-company">On behalf of</label>
              <input id="g-company" name="company_name" className="input" defaultValue={cfg.company_name || org.name} />
            </div>
            <div className="field span-2">
              <label htmlFor="g-open">Opening line</label>
              <textarea id="g-open" name="opening_line" className="textarea" style={{ minHeight: 80 }} defaultValue={cfg.opening_line || defaultOpening(cfg.use_case, cfg.primary_language, cfg.voice)} />
              <span className="field-hint">
                Use <code className="mono">{"{{first_name}}"}</code>, <code className="mono">{"{{agent_name}}"}</code> and <code className="mono">{"{{company}}"}</code>.
              </span>
            </div>
            <div className="form-actions span-2">
              {back}
              <button className="btn btn-accent">Continue</button>
            </div>
          </form>
        )}

        {step === "instructions" && cfg && (
          <form action={instructionsStep} className="panel panel-body form-grid">
            {carry}
            <div className="field span-2">
              <label htmlFor="n-ins">What should the agent know?</label>
              <textarea id="n-ins" name="instructions" className="textarea" style={{ minHeight: 180 }} defaultValue={cfg.instructions.replace(/Sunrise Multispeciality Clinic|Skyline Homes|QuickCart|TalentBridge Staffing|Brightpath Academy/g, org.name)} placeholder="Opening hours, services, prices, policies, what to ask and in what order…" />
            </div>
            <div className="field">
              <label htmlFor="n-goals">Goals (one per line)</label>
              <textarea id="n-goals" name="goals" className="textarea" defaultValue={cfg.goals.join("\n")} />
            </div>
            <div className="field">
              <label htmlFor="n-qual">Qualification criteria (optional)</label>
              <textarea id="n-qual" name="qualification_criteria" className="textarea" defaultValue={cfg.qualification_criteria} />
            </div>
            <div className="field">
              <label htmlFor="n-tr">Transfer number for human handoff (optional)</label>
              <input id="n-tr" name="transfer_number" className="input" inputMode="tel" defaultValue={cfg.transfer_number} placeholder="98765 43210" />
            </div>
            <div className="form-actions span-2">
              {back}
              <button className="btn btn-accent">Continue</button>
            </div>
          </form>
        )}

        {step === "knowledge" && (
          <div className="stack">
            <section className="panel panel-body">
              <UploadForm agents={[]} />
              <p className="field-hint">{docs ? `${docs} document(s) ready.` : "You can also do this later from Knowledge Base."}</p>
            </section>
            <div className="form-actions">
              {back}
              {nav("telephony", docs ? "Continue" : "Skip for now", "btn btn-accent")}
            </div>
          </div>
        )}

        {step === "telephony" && (
          <div className="stack">
            <section className="panel panel-body">
              <ul className="checklist">
                <li>
                  <span className={`mark ${stack.telephony ? "mark-ok" : "mark-bad"}`}>{stack.telephony ? "✓" : "!"}</span>
                  <span>
                    <b>Telephony connection</b>
                    <span className="d">{stack.telephony ? "Connected and ready." : "Not configured for this workspace yet — Cloudisoft will enable it for your account."}</span>
                  </span>
                  <span />
                </li>
                <li>
                  <span className={`mark ${numbers.length ? "mark-ok" : "mark-warn"}`}>{numbers.length ? "✓" : "•"}</span>
                  <span>
                    <b>Phone numbers</b>
                    <span className="d">{numbers.length ? numbers.map((n) => n.e164).join(", ") : "No number yet. You can still test in your browser."}</span>
                  </span>
                  {stack.telephony && (
                    <Link href="/app/numbers" className="btn btn-ghost btn-sm">
                      Manage numbers
                    </Link>
                  )}
                </li>
              </ul>
            </section>
            <div className="form-actions">
              {back}
              {nav("test", "Continue", "btn btn-accent")}
            </div>
          </div>
        )}

        {step === "test" && agent && (
          <div className="stack">
            <AgentTest agentId={agent.id} browserReady={stack.browserDemo} phoneReady={stack.phoneCalls && numbers.length > 0} numbers={numbers} />
            <div className="form-actions">
              {back}
              {nav("checks", "Continue", "btn btn-accent")}
            </div>
          </div>
        )}

        {step === "checks" && agent && (
          <form action={finishOnboarding} className="stack">
            <section className="panel panel-body">
              <ul className="checklist">
                {[
                  { ok: true, t: "Agent configured", d: `${agent.name} · ${USE_CASES[agent.config.use_case]}` },
                  { ok: Boolean(agent.config.instructions), t: "Instructions added", d: agent.config.instructions ? "The agent knows your business basics." : "Add business details so the agent doesn’t have to guess." },
                  { ok: stack.speech && stack.llm, t: "Voice engine", d: stack.speech && stack.llm ? "Ready" : "Not configured yet — calls can’t run until it is." },
                  { ok: stack.telephony, t: "Telephony connection", d: stack.telephony ? "Ready" : "Not configured yet." },
                  { ok: numbers.length > 0, t: "Phone number", d: numbers.length ? `${numbers.length} active` : "Add a number to make real calls." },
                  { ok: true, t: "Calling hours", d: `${org.calling_window_start.slice(0, 5)}–${org.calling_window_end.slice(0, 5)} ${org.timezone}, DNC checked before every call` },
                ].map((c) => (
                  <li key={c.t}>
                    <span className={`mark ${c.ok ? "mark-ok" : "mark-warn"}`}>{c.ok ? "✓" : "•"}</span>
                    <span>
                      <b>{c.t}</b>
                      <span className="d">{c.d}</span>
                    </span>
                    <span />
                  </li>
                ))}
              </ul>
              <label className="check" style={{ marginTop: 10 }}>
                <input type="checkbox" name="activate" defaultChecked={stack.speech && stack.llm} />
                <span>Activate {agent.name} now</span>
              </label>
            </section>
            <div className="form-actions">
              {back}
              <button className="btn btn-accent">Go to dashboard</button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
