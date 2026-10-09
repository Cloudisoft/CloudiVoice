import Link from "next/link";

export const metadata = { title: "Guides", description: "How to build agents, run campaigns, reset leads and read results in CloudiVoice." };

export default function ResourcesPage() {
  return (
    <section className="prose-page">
      <div className="container prose">
        <div className="section-index">
          <span className="mono">R</span>
          <span className="rule" aria-hidden="true" />
          <span className="label">Guides</span>
        </div>
        <h1>Getting the most out of CloudiVoice</h1>
        <p>Short, practical guides for teams running AI voice agents. If something here doesn’t match what you see, your dashboard is the source of truth.</p>
        <nav className="toc" aria-label="On this page">
          <a className="chip" href="#build">Build an agent</a>
          <a className="chip" href="#leads">Import leads</a>
          <a className="chip" href="#campaigns">Run a campaign</a>
          <a className="chip" href="#reset">Reset leads</a>
          <a className="chip" href="#results">Read results</a>
          <a className="chip" href="#compliance">Compliance</a>
        </nav>

        <h2 id="build">Build and test an agent</h2>
        <ol>
          <li>Go to <b>AI Agents → New agent</b> and start from a template (receptionist, sales, support, recruitment or follow-up).</li>
          <li>Pick the primary language and voice. Hindi and Indian English are live; other Indian languages appear once validated.</li>
          <li>Write instructions as you would brief a new team member: hours, prices, policies, and what to ask in what order.</li>
          <li>Upload FAQs or price lists to the <b>Knowledge Base</b> so the agent answers from facts.</li>
          <li>Use <b>Talk in your browser</b> or <b>Call me now</b> to test. Every save is a new version — restore any earlier version in one click.</li>
          <li>When it sounds right, press <b>Activate agent</b>.</li>
        </ol>

        <h2 id="leads">Import leads</h2>
        <p>Upload a CSV or Excel (.xlsx) file from <b>Leads → Import</b>. Map your columns, choose a list and import. We:</p>
        <ul>
          <li>normalise every number to +91 format, so <code>98765 43210</code>, <code>+91-98765-43210</code> and <code>09876543210</code> are the same lead;</li>
          <li>skip duplicates and report invalid numbers with examples;</li>
          <li>flag numbers on your Do Not Call list so they’re never dialled;</li>
          <li>keep extra columns as custom fields you can use in scripts, e.g. <code>{"{{course}}"}</code>.</li>
        </ul>

        <h2 id="campaigns">Run a campaign</h2>
        <ol>
          <li>Create a campaign with an agent, one or more lead lists and a pool of caller numbers.</li>
          <li>Set concurrency and calls per minute. Gentle pacing protects your numbers from spam flags.</li>
          <li>Set calling hours (in the lead’s local time) and retry rules per outcome.</li>
          <li>Press <b>Start</b>. Preflight checks confirm the agent, numbers, leads, connection and hours first.</li>
          <li>Watch live counts on the campaign page and transcripts in the <b>Live Monitor</b>.</li>
          <li><b>Pause</b> stops new calls only — calls in progress finish naturally. <b>Stop</b> ends the campaign.</li>
        </ol>
        <p>Fresh leads are always called before retries. Only one worker dials a campaign at a time, so a lead is never called twice by accident.</p>

        <h2 id="reset">Reset leads for another round</h2>
        <p>
          On <b>Lead Lists</b>, use <b>Reset for redial</b> to put leads back in line — for example everyone who didn’t answer or reached voicemail. Leads marked Do Not Call, Not in service, Disconnected, Not interested or Wrong number are never reset.
        </p>

        <h2 id="results">Read your results</h2>
        <ul>
          <li><b>Call Records</b> show every call with its timeline, transcript, outcome, cost and the reason it ended in plain words — e.g. “The call never connected.”</li>
          <li>Each automatic outcome has a <b>confidence score</b> and a short reason. Managers can override it; overrides are never replaced.</li>
          <li><b>Analytics &amp; QA</b> compares campaigns and caller numbers. A number with a very low connect rate is flagged so you can replace it.</li>
          <li>Answered calls get an AI quality score against your rubric, with notes explaining the score.</li>
          <li>Export calls or leads to CSV at any time.</li>
        </ul>

        <h2 id="compliance">Compliance basics</h2>
        <ul>
          <li>Calls are placed only inside your calling hours, by default 9 AM–9 PM, in the lead’s local time.</li>
          <li>The Do Not Call list is checked before every call. When a caller asks not to be called again, the agent adds them automatically.</li>
          <li>Turn on call recording only where you have the required consent; the agent can read your recording disclosure at the start of each call.</li>
          <li>Set how long transcripts and recordings are kept under <b>Settings → Organization</b>.</li>
          <li>Make sure your use of outbound calling follows applicable telemarketing regulations and registrations.</li>
        </ul>

        <div className="hero-ctas">
          <Link href="/signup" className="btn btn-accent">
            Create your free agent
          </Link>
          <Link href="/#demo" className="btn btn-ghost">
            Hear a sample call
          </Link>
        </div>
      </div>
    </section>
  );
}
