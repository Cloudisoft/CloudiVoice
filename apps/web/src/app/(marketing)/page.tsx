import Link from "next/link";
import { DEMO_SCENARIOS } from "@cloudivoice/core/demoScenarios";
import { allLanguages } from "@cloudivoice/core/languages";
import { env, liveStackStatus } from "@cloudivoice/core/env";
import { aiPerMinute, formatInr, pricing } from "@cloudivoice/core/pricing";
import { DemoConsole } from "@/components/demo/DemoConsole";
import { ArrowIcon } from "@/components/demo/DemoConsole";
import { HearItButton } from "@/components/marketing/HearItButton";
import { loadSamples, toMeta } from "@/lib/samples";

export const dynamic = "force-dynamic";

const CAPABILITIES: { title: string; body: string; status: "live" | "validation" | "roadmap"; tag: string }[] = [
  { tag: "IN / OUT", title: "Inbound & outbound calling", body: "Answer every call on your number and run outbound campaigns with pacing, calling hours and concurrency limits.", status: "live" },
  { tag: "HI · EN", title: "Multilingual conversations", body: "Hindi, Indian English and natural Hinglish code-switching today. Gujarati, Marathi, Bengali, Tamil, Telugu, Kannada and Malayalam are in validation.", status: "live" },
  { tag: "QUALIFY", title: "Lead qualification", body: "Ask your questions in your order, score against your criteria and hand hot leads to your team.", status: "live" },
  { tag: "BOOK", title: "Appointments", body: "Offer slots, confirm details read back on file, and book — with dates and times understood in IST.", status: "live" },
  { tag: "SUPPORT", title: "Customer support", body: "Answer from your knowledge base — PDFs, Word files, FAQs — instead of guessing.", status: "live" },
  { tag: "SCREEN", title: "Recruitment screening", body: "Screen candidates on experience, notice period and salary, then schedule interviews.", status: "live" },
  { tag: "RETRY", title: "Callbacks & retries", body: "“Call me tomorrow at 3” becomes a scheduled callback. Retries follow per-outcome rules.", status: "live" },
  { tag: "HANDOFF", title: "Human handoff", body: "When a caller asks for a person, the agent transfers in the same breath — no extra questions.", status: "live" },
  { tag: "INSIGHT", title: "Analytics & QA", body: "Outcomes with confidence and plain-language reasons, AI quality scores and supervisor overrides.", status: "live" },
  { tag: "RECORD", title: "Transcripts & recordings", body: "Every line saved as it is spoken. Recordings kept in private storage with your retention rules.", status: "live" },
];

const INDUSTRIES = [
  { k: "01", name: "Recruitment & staffing", uses: ["Candidate screening", "Interview scheduling", "Joining reminders"] },
  { k: "02", name: "Healthcare", uses: ["Appointment booking", "Reminders & rescheduling", "Lab report follow-ups"] },
  { k: "03", name: "Real estate", uses: ["Enquiry qualification", "Site-visit booking", "Re-engaging old leads"] },
  { k: "04", name: "Education", uses: ["Admission enquiries", "Counselling calls", "Fee & batch reminders"] },
  { k: "05", name: "Financial services", uses: ["Loan lead qualification", "Document reminders", "Renewal follow-ups"] },
  { k: "06", name: "Retail & e-commerce", uses: ["Order status", "COD confirmation", "Returns & refunds"] },
  { k: "07", name: "Professional services", uses: ["Front-desk calls", "Consultation booking", "Callback handling"] },
];

const TRUST = [
  { t: "Usage limits you set", d: "Cap concurrency, calls per minute and monthly spend per organization." },
  { t: "Clear costs", d: "Per-minute rates in rupees, split by telephony, speech, reasoning and platform — visible per call." },
  { t: "Full call history", d: "Searchable records with timeline, transcript, outcome and end reason in plain words." },
  { t: "Role-based access", d: "Admin, manager, operator and viewer roles, with every sensitive action audit-logged." },
  { t: "Privacy & retention", d: "Data isolated per organization. Recordings private, with expiring links and retention you choose." },
  { t: "Do-not-call built in", d: "DNC checked before every call. Calling hours enforced in the lead’s local time." },
  { t: "Connection health", d: "See the status of your telephony connection and voice engine at a glance." },
  { t: "Human escalation", d: "Configure a transfer number and the agent hands over whenever a caller asks." },
];

export default async function HomePage() {
  const samples = await loadSamples();
  const initial = samples.find((s) => s.id === "receptionist-hi") ?? samples[0]!;
  const languages = allLanguages().map((l) => ({ code: l.code, name: l.name, native: l.native, status: l.status }));
  const p = pricing();
  const stack = liveStackStatus();

  return (
    <>
      {/* ------------------------------------------------------------ HERO */}
      <section className="hero" aria-labelledby="hero-title">
        <div className="container hero-grid">
          <div className="hero-copy">
            <div className="section-index">
              <span className="mono">01</span>
              <span className="rule" aria-hidden="true" />
              <span className="label">Voice AI</span>
            </div>

            <p className="price-pill mono">
              <span>
                Telephony from <b>{formatInr(p.perMinute.telephony, { decimals: true })}</b>/min
              </span>
              <span className="sep" aria-hidden="true" />
              <span>
                AI agent <b>{formatInr(aiPerMinute(p), { decimals: true })}</b>/min excl. telephony
              </span>
            </p>

            <h1 id="hero-title" className="hero-title">
              AI Voice Agents That Sound <span className="underline-mark">Remarkably</span> <span className="underline-mark">Human.</span>
            </h1>
            <p className="hero-sub">
              Turn conversations into business outcomes. Build intelligent voice agents that speak Hindi, English, and regional languages to qualify leads, book appointments, support customers, and
              automate everyday business conversations.
            </p>

            <div className="hero-ctas">
              <HearItButton className="btn btn-lg btn-primary btn-caps">
                <PlayGlyph /> Hear it for yourself
              </HearItButton>
              <Link href="/signup" className="btn btn-lg btn-ghost btn-caps">
                Build your first agent <ArrowIcon />
              </Link>
            </div>
            <p className="trust-line">
              Designed for Indian businesses. Built to scale with you. <span className="mono credits">{formatInr(p.welcomeCredits)} in free credits.</span>
            </p>


          </div>

          <div className="hero-demo" id="demo">
            <DemoConsole
              initial={initial}
              samples={samples.map(toMeta)}
              scenarios={DEMO_SCENARIOS.map((s) => ({ id: s.id, label: s.label, business: s.business, blurb: s.blurb }))}
              languages={languages}
              liveEnabled={stack.browserDemo}
              liveMaxSeconds={env.demoMaxSeconds}
            />
          </div>

            <dl className="hero-facts">
            <div>
              <dt className="label">Languages</dt>
              <dd>
                Hindi · English<span className="fact-sub">+7 Indian languages in validation</span>
              </dd>
            </div>
            <div>
              <dt className="label">Billing</dt>
              <dd>
                Per second, in ₹<span className="fact-sub">Itemised on every call</span>
              </dd>
            </div>
            <div>
              <dt className="label">Setup</dt>
              <dd>
                No code<span className="fact-sub">Build → test → deploy</span>
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ------------------------------------------------------------ PLATFORM */}
      <section className="section" id="platform" aria-labelledby="platform-title">
        <div className="container">
          <div className="section-head">
            <div className="section-index">
              <span className="mono">02</span>
              <span className="rule" aria-hidden="true" />
              <span className="label">Platform</span>
            </div>
            <h2 id="platform-title" className="section-title">
              One Platform. <span className="muted-title">Endless Conversations.</span>
            </h2>
            <p className="section-sub">Everything a voice operation needs — from the first “hello” to the outcome in your dashboard — in one place.</p>
          </div>
          <ul className="cap-grid" id="solutions">
            {CAPABILITIES.map((c) => (
              <li key={c.title} className="cap">
                <div className="cap-top">
                  <span className="mono cap-tag">{c.tag}</span>
                  <span className={`chip ${c.status === "live" ? "chip-ok" : c.status === "validation" ? "chip-warn" : "chip-info"} chip-dot`}>
                    {c.status === "live" ? "Available" : c.status === "validation" ? "In validation" : "Planned"}
                  </span>
                </div>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------------ HOW IT WORKS */}
      <section className="section section-alt" aria-labelledby="how-title">
        <div className="container">
          <div className="section-head">
            <div className="section-index">
              <span className="mono">03</span>
              <span className="rule" aria-hidden="true" />
              <span className="label">How it works</span>
            </div>
            <h2 id="how-title" className="section-title">From idea to live calls in an afternoon.</h2>
          </div>
          <ol className="steps">
            <li className="step">
              <span className="step-k mono">01</span>
              <h3>Build</h3>
              <p>Configure your agent’s language, voice, instructions and knowledge. Start from a template for your use case.</p>
              <div className="step-visual mono" aria-hidden="true">
                <span>language</span>
                <b>hi-IN ⇄ en-IN</b>
                <span>voice</span>
                <b>Priya · warm</b>
                <span>knowledge</span>
                <b>clinic-faq.pdf ✓</b>
              </div>
            </li>
            <li className="step">
              <span className="step-k mono">02</span>
              <h3>Test</h3>
              <p>Listen, talk to it in your browser or on your phone, and refine. Every change is saved as a version you can roll back.</p>
              <div className="step-visual mono" aria-hidden="true">
                <span>v3</span>
                <b>“Offer evening slots first”</b>
                <span>test call</span>
                <b>completed · 1m 12s</b>
              </div>
            </li>
            <li className="step">
              <span className="step-k mono">03</span>
              <h3>Deploy</h3>
              <p>Connect an eligible number, set calling hours and rules, pass the preflight checks — then launch when you’re ready.</p>
              <div className="step-visual mono" aria-hidden="true">
                <span>preflight</span>
                <b>agent ✓ numbers ✓ hours ✓</b>
                <span>campaign</span>
                <b>running · 4 concurrent</b>
              </div>
            </li>
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------------ INDUSTRIES */}
      <section className="section" id="industries" aria-labelledby="ind-title">
        <div className="container">
          <div className="section-head">
            <div className="section-index">
              <span className="mono">04</span>
              <span className="rule" aria-hidden="true" />
              <span className="label">Industries</span>
            </div>
            <h2 id="ind-title" className="section-title">Built for the calls Indian businesses make every day.</h2>
          </div>
          <ul className="ind-grid">
            {INDUSTRIES.map((i) => (
              <li key={i.k} className="ind">
                <span className="mono ind-k">{i.k}</span>
                <h3>{i.name}</h3>
                <ul>
                  {i.uses.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </li>
            ))}
            <li className="ind ind-cta">
              <h3>Your use case?</h3>
              <p>If a conversation follows a pattern, an agent can handle it.</p>
              <Link href="/signup" className="btn btn-ghost btn-sm">
                Start building <ArrowIcon />
              </Link>
            </li>
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------------ TRUST */}
      <section className="section section-alt" aria-labelledby="trust-title">
        <div className="container trust-grid">
          <div className="section-head sticky-head">
            <div className="section-index">
              <span className="mono">05</span>
              <span className="rule" aria-hidden="true" />
              <span className="label">Control</span>
            </div>
            <h2 id="trust-title" className="section-title">You stay in control of every call.</h2>
            <p className="section-sub">Guardrails are part of the product, not an add-on: limits, costs, history, access, privacy and escalation.</p>
          </div>
          <ul className="trust-list">
            {TRUST.map((t) => (
              <li key={t.t}>
                <h3>{t.t}</h3>
                <p>{t.d}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------------ PRICING */}
      <section className="section" id="pricing" aria-labelledby="pricing-title">
        <div className="container">
          <div className="section-head">
            <div className="section-index">
              <span className="mono">06</span>
              <span className="rule" aria-hidden="true" />
              <span className="label">Pricing</span>
            </div>
            <h2 id="pricing-title" className="section-title">Transparent, per-minute, in rupees.</h2>
            <p className="section-sub">Billed per second of connected time. Every component is itemised on each call, so you always know where the money goes.</p>
          </div>

          <div className="rate-card">
            <table className="rate-table">
              <caption className="sr-only">Per-minute rates</caption>
              <thead>
                <tr>
                  <th scope="col">Component</th>
                  <th scope="col">What it covers</th>
                  <th scope="col" className="num">
                    Per minute
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Telephony</td>
                  <td>Indian phone network, inbound or outbound</td>
                  <td className="num mono">{formatInr(p.perMinute.telephony, { decimals: true })}</td>
                </tr>
                <tr>
                  <td>Speech-to-text</td>
                  <td>Understanding the caller in Hindi, English and code-mixed speech</td>
                  <td className="num mono">{formatInr(p.perMinute.speech_to_text, { decimals: true })}</td>
                </tr>
                <tr>
                  <td>Reasoning</td>
                  <td>The agent’s thinking, tools and knowledge lookups</td>
                  <td className="num mono">{formatInr(p.perMinute.reasoning, { decimals: true })}</td>
                </tr>
                <tr>
                  <td>Text-to-speech</td>
                  <td>Natural Indian voices</td>
                  <td className="num mono">{formatInr(p.perMinute.text_to_speech, { decimals: true })}</td>
                </tr>
                <tr>
                  <td>Platform</td>
                  <td>Campaigns, analytics, transcripts, storage within retention</td>
                  <td className="num mono">{formatInr(p.perMinute.platform, { decimals: true })}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2}>
                    All-in, per connected minute
                  </th>
                  <td className="num mono total">{formatInr(aiPerMinute(p) + p.perMinute.telephony, { decimals: true })}</td>
                </tr>
              </tfoot>
            </table>
            <div className="rate-side">
              <div>
                <span className="label">Phone number</span>
                <p className="rate-big mono">
                  {formatInr(p.numberRentalMonthly)}
                  <small>/month</small>
                </p>
              </div>
              <div>
                <span className="label">Recording storage beyond retention</span>
                <p className="rate-big mono">
                  {formatInr(p.storagePerGbMonth)}
                  <small>/GB-month</small>
                </p>
              </div>
              <div>
                <span className="label">Free trial</span>
                <p className="rate-note">
                  {formatInr(p.welcomeCredits)} in credits, up to {p.trial.maxMinutes} minutes and {p.trial.maxConcurrentCalls} concurrent call while you test.
                </p>
              </div>
            </div>
          </div>

          <ul className="plans">
            {p.plans.map((plan) => (
              <li key={plan.id} className={`plan ${plan.highlight ? "plan-hl" : ""}`}>
                <div className="plan-head">
                  <h3>{plan.name}</h3>
                  {plan.highlight && <span className="chip chip-accent">Most teams</span>}
                </div>
                <p className="plan-price">
                  {plan.monthlyFee ? (
                    <>
                      <span className="mono">{formatInr(plan.monthlyFee)}</span>
                      <small>/month</small>
                    </>
                  ) : (
                    <span className="mono">Pay as you go</span>
                  )}
                </p>
                <p className="plan-sub">
                  {plan.includedMinutes ? `${plan.includedMinutes.toLocaleString("en-IN")} minutes included · ` : ""}
                  {plan.concurrency} concurrent calls
                </p>
                <ul className="plan-features">
                  {plan.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <Link href={`/signup?plan=${plan.id}`} className={`btn ${plan.highlight ? "btn-accent" : "btn-ghost"}`}>
                  Start free
                </Link>
              </li>
            ))}
          </ul>
          <ul className="exclusions">
            {p.exclusions.map((e) => (
              <li key={e}>{e}</li>
            ))}
            <li>Overage beyond included minutes is billed at the per-minute rates above.</li>
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------------ CLOSING */}
      <section className="closing" aria-labelledby="closing-title">
        <div className="container closing-inner">
          <h2 id="closing-title">Imagine what an AI agent could do for your business.</h2>
          <p>Start with a template, hear it in your language, and put it on a real call today.</p>
          <div className="hero-ctas center">
            <Link href="/signup" className="btn btn-lg btn-accent btn-caps">
              Create your free agent <ArrowIcon />
            </Link>
            <HearItButton className="btn btn-lg btn-ghost btn-caps">
              <PlayGlyph /> Hear a sample call
            </HearItButton>
          </div>
        </div>
      </section>
    </>
  );
}

function PlayGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4v16l14-8z" fill="currentColor" />
    </svg>
  );
}
