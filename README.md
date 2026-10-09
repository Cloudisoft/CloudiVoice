# CloudiVoice — by Cloudisoft

India-first AI voice agents that sound remarkably human. Visitors hear a real
sample call in the hero, talk to a live demo agent in their browser, sign up,
build their own agent in Hindi or English, connect a number and run campaigns —
with every call recorded as a searchable record with transcript, outcome and cost.

```
apps/web     Next.js 15 — marketing site, hero demo, auth, onboarding, dashboard, APIs
apps/voice   Voice gateway + worker — telephony webhooks, real-time media streams,
             browser live demos, campaign dialer, reconciliation, recording backfill
packages/core  Shared domain logic — Postgres schema & migrations (row-level tenant
             isolation), call state machine, outcomes/retries, dialer, leads, agents,
             speech + reasoning layers, telephony adapter, pricing
tools/sample-audio  Generator for the hero's sample-call recordings + transcripts
```

## How a call works

```
caller ⇄ telephony connection ⇄ voice gateway ── turn detection ─► speech-to-text
                                      ▲                                   │
                                      └── text-to-speech ◄── reasoning ◄──┘  (tools: book, callback, transfer, DNC, knowledge)
```

- Replies stream sentence by sentence, so speech starts before the full reply is generated.
- Callers can interrupt (barge-in clears queued audio). Fillers like “haan”, “hmm”
  don't trigger new answers. Quiet callers get check-ins; calls end politely.
- Hindi and Indian English with natural code-switching. Hindi verb forms follow the
  agent voice's gender. Other Indian languages are listed as *in validation* until
  enabled with `ENABLED_LANGUAGES`.
- The same engine powers phone calls, the public website demo (isolated demo
  agents, synthetic data, rate limits and daily ceilings) and in-dashboard browser tests.

## Local development

Requirements: Node 20+, Postgres 14+.

```bash
cp .env.example .env            # fill in what you have; everything optional in dev
npm install
npm run migrate                 # or let the apps migrate on boot
npm run dev                     # web on http://localhost:3000
npm run dev:voice               # voice gateway + worker on http://localhost:8080
```

Without speech/reasoning/telephony keys the product still runs end to end: sample
calls play, sign-up, onboarding, agent builder, lead import, campaigns (preflight
explains what's missing), call records and settings all work. Live demo, browser
tests and phone calls switch on automatically once the keys are set.

## Quality checks

```bash
npm run typecheck                                 # all workspaces
npm run lint                                      # web (ESLint, zero warnings)
TEST_DATABASE_URL=postgres://…/cloudivoice_test npm test   # unit + real-Postgres + conversation-engine tests
npm run build                                     # production build of the web app
npm run check:brand                               # no carrier names in customer-facing code/bundles
```

The database tests run against real Postgres (not a fake) and prove that one
organization cannot read, update, delete or insert another organization's rows.

## Deploying

Run two services from this repository, both with the same environment:

| Service | Command | Notes |
| --- | --- | --- |
| Web | `npm run build && npm run start` | Serves the site and dashboard. |
| Voice | `npm run start:voice` | Needs a stable public HTTPS URL (`VOICE_PUBLIC_URL`) for webhooks and WebSockets. Runs the dialer and background jobs; set `DISABLE_WORKER=1` on extra replicas. |

Both apply numbered SQL migrations on boot (advisory-locked). Recordings are stored
under `STORAGE_DIR` (mount a persistent volume) and served only through
short-lived signed links to authorized users.

Telephony setup for operators: see `docs/internal/telephony.md` (internal).

## Sample audio

The hero's recordings are synthesized sample conversations (Apache-2.0 Kokoro
voices) with fictional businesses, labelled as such on the page and verified for
intelligibility with an independent speech recognizer. Replace them with
recordings from the production voice stack as soon as they're available — see
`tools/sample-audio/README.md`.
