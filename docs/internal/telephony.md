# Telephony connection — internal developer notes

> **Internal only.** The carrier's name must never appear in customer-facing UI,
> errors, public docs or browser bundles. `npm run check:brand` enforces this.

CloudiVoice uses **Plivo** as its telephony carrier for Indian numbers. All carrier
code lives in `packages/core/src/telephony/adapters/plivo.ts` behind the neutral
`TelephonyAdapter` interface (`packages/core/src/telephony/types.ts`). The rest of
the codebase, and every screen, only knows "the telephony connection".

## Account setup

1. Create (or use) the Cloudisoft Plivo account. Complete India KYC so Indian
   numbers can be rented and used for outbound/inbound voice.
2. Set `TELEPHONY_PROVIDER=plivo`, `TELEPHONY_AUTH_ID`, `TELEPHONY_AUTH_TOKEN` on
   **both** the web and voice services.
3. Deploy the voice gateway at a stable public HTTPS URL and set `VOICE_PUBLIC_URL`.
4. Create a Plivo **Application** whose:
   - Answer URL = `${VOICE_PUBLIC_URL}/telephony/answer` (POST)
   - Hangup URL = `${VOICE_PUBLIC_URL}/telephony/hangup` (POST)
   Assign every inbound number to that application. Outbound calls carry their own
   answer/hangup URLs (with our `callId`) automatically.
5. In the dashboard, Phone Numbers → *Sync numbers from connection* imports rented
   numbers. Search/Buy uses the PhoneNumber API (India numbers may need documents).

## Call flow

```
dialer / test call ──► POST /v1/Account/{id}/Call/        (answer_url has ?callId=)
carrier ──► POST /telephony/ring | /answer | /machine | /hangup   (V3 signature verified, stored first, idempotent)
/answer ──► <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">wss://…/media?token=…</Stream>
carrier ⇄ WS /media   start → media (20 ms base64 µ-law) → stop
          we send playAudio / clearAudio (barge-in) / checkpoint
transfer ──► POST /Call/{uuid}/ legs=aleg aleg_url=/telephony/transfer-xml → <Dial action=/telephony/transfer-result>
recording ──► POST /Call/{uuid}/Record/ → callback /telephony/recording → worker copies MP3 to private storage
```

- Signature validation (`X-Plivo-Signature-V3`, `-Ma-V3`, `-V3-Nonce`) is ported from
  the official SDK and unit-tested against the documented example.
- The media WebSocket is authenticated with our own short-lived signed token.
- `TELEPHONY_STREAM_FORMAT=l16-16k` switches to 16 kHz linear PCM for wider-band
  audio; verify on a real call before enabling (byte order must match).
- Machine detection uses `machine_detection=true`, `machine_detection_time=4000`
  (documented range 2000–10000). A transcript-based backup detector also runs.
- Hangup causes are mapped to neutral end reasons in `mapHangupCause`.

## Verification checklist before go-live

- [ ] Inbound call to a synced number reaches the assigned agent.
- [ ] Outbound test call from an agent page connects; transcript appears live.
- [ ] Voicemail: machine detected → voicemail message plays → call ends.
- [ ] "Talk to a person" transfers immediately to the transfer number; caller ID shown.
- [ ] Transfer to an unanswered number falls back gracefully.
- [ ] Silent caller → two check-ins → polite end.
- [ ] Large rupee amount spoken in words; phone numbers read in groups.
- [ ] Recording (if enabled) appears on the call record after the backfill job.
- [ ] Hangup webhook missing → reconciliation closes the call within minutes.
