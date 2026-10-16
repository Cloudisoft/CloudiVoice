import Link from "next/link";
import { DEMO_SCENARIOS } from "@cloudivoice/core/demoScenarios";
import { allLanguages } from "@cloudivoice/core/languages";
import { env, liveStackStatus } from "@cloudivoice/core/env";
import { DemoConsole } from "@/components/demo/DemoConsole";
import { ArrowIcon } from "@/components/demo/DemoConsole";
import { HearItButton } from "@/components/marketing/HearItButton";
import { CONTACT, mailLink, telLink, whatsappLink } from "@/lib/contact";
import { loadSamples, toMeta } from "@/lib/samples";

export const dynamic = "force-dynamic";

const CAPABILITIES: { title: string; body: string; status: "live" | "validation" | "roadmap"; tag: string }[] = [
  { tag: "IN / OUT", title: "Inbound & outbound calling", body: "Answer every call on your number and run outbound campaigns with pacing, calling hours and concurrency limits.", status: "live" },
  { tag: "11 LANGUAGES", title: "Multilingual conversations", body: "Hindi, Indian English, Gujarati, Marathi, Punjabi, Bengali, Tamil, Telugu, Kannada, Malayalam and Odia, with natural code-switching the way people really talk.", status: "live" },
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
                <b>Custom plans</b> built around your call volume
              </span>
              <span className="sep" aria-hidden="true" />
              <a href="#contact">Talk to us</a>
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
              Designed for Indian businesses. Built to scale with you.
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
                Hindi · English<span className="fact-sub">+ {languages.length - 2} regional Indian languages</span>
              </dd>
            </div>
            <div>
              <dt className="label">Pricing</dt>
              <dd>
                Custom<span className="fact-sub">Tailored to your volume</span>
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

      {/* ------------------------------------------------------------ CONTACT */}
      <section className="section" id="contact" aria-labelledby="contact-title">
        <div className="container">
          <div className="section-head">
            <div className="section-index">
              <span className="mono">06</span>
              <span className="rule" aria-hidden="true" />
              <span className="label">Pricing</span>
            </div>
            <h2 id="contact-title" className="section-title">Custom plans, built around your business.</h2>
            <p className="section-sub">
              Every business calls differently. Tell us your call volume, languages and use case, and we’ll put together a plan that fits — usually within a day.
            </p>
          </div>

          <div className="contact-grid">
            <div className="contact-card contact-card-wa">
              <span className="label">WhatsApp</span>
              <p>Message us any time — the quickest way to get a quote.</p>
              <div className="contact-actions">
                {CONTACT.phones.map((ph) => (
                  <a key={ph.digits} className="btn btn-accent" href={whatsappLink(ph.digits)} target="_blank" rel="noopener noreferrer">
                    <WhatsAppGlyph /> {ph.display}
                  </a>
                ))}
              </div>
            </div>
            <div className="contact-card">
              <span className="label">Call us</span>
              <p>Speak with our team about your requirements.</p>
              <div className="contact-actions">
                {CONTACT.phones.map((ph) => (
                  <a key={ph.digits} className="btn btn-ghost" href={telLink(ph.digits)}>
                    <PhoneGlyph /> {ph.display}
                  </a>
                ))}
              </div>
            </div>
            <div className="contact-card">
              <span className="label">Email</span>
              <p>Send us your use case and expected monthly minutes.</p>
              <div className="contact-actions">
                <a className="btn btn-ghost" href={mailLink()}>
                  <MailGlyph /> {CONTACT.email}
                </a>
              </div>
            </div>
          </div>

          <ul className="contact-points">
            <li>Free trial to test your agent before you commit</li>
            <li>Volume-based pricing in rupees, GST invoices</li>
            <li>Indian phone numbers, setup and onboarding help included</li>
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

function WhatsAppGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.8-1.3a.5.5 0 0 0 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.2-.2-.2-.5-.3Z"
      />
    </svg>
  );
}

function PhoneGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

function MailGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="m3 7 9 6 9-6" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4v16l14-8z" fill="currentColor" />
    </svg>
  );
}
