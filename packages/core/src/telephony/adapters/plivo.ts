/**
 * INTERNAL carrier adapter. This is the only module that knows the
 * carrier's API. Nothing from here may reach customer-facing UI, errors
 * or public docs — callers receive neutral types and TelephonyError.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { EndReason } from "../../outcomes";
import {
  type AvailableNumber,
  type CallStatusReport,
  type CarrierNumber,
  type PlaceCallInput,
  type PlacedCall,
  type TelephonyAdapter,
  TelephonyError,
} from "../types";

const API = "https://api.plivo.com/v1";

function xmlEscape(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

function toCarrierNumber(e164: string) {
  return e164.replace(/^\+/, "");
}
function fromCarrierNumber(n: string) {
  return n.startsWith("+") ? n : `+${n}`;
}

// ---- Webhook signature (V3): ported from the carrier's official SDK ----
function sortedQuery(params: Record<string, string[]>) {
  return Object.keys(params)
    .sort()
    .flatMap((k) => [...params[k]!].sort().map((v) => `${k}=${v}`))
    .join("&");
}

export function buildSignatureBase(method: string, uri: string, params: Record<string, string>): string {
  const u = new URL(uri);
  const base = `${u.protocol}//${u.host}${u.pathname}`;
  const query: Record<string, string[]> = {};
  u.searchParams.forEach((v, k) => (query[k] ??= []).push(v));
  if (method === "GET") {
    for (const [k, v] of Object.entries(params)) (query[k] ??= []).push(v);
    const qs = sortedQuery(query);
    return qs ? `${base}?${qs}` : base;
  }
  const hasParams = Object.keys(params).length > 0;
  const qs = sortedQuery(query);
  let url = base;
  if (qs.length > 0 || hasParams) url += `?${qs}`;
  if (qs.length > 0 && hasParams) url += ".";
  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join("");
  return url + paramString;
}

export function computeSignature(authToken: string, base: string, nonce: string) {
  return createHmac("sha256", authToken).update(`${base}.${nonce}`).digest("base64");
}

export function verifySignatureV3(
  authToken: string,
  method: string,
  uri: string,
  nonce: string,
  signatureHeader: string,
  params: Record<string, string>,
): boolean {
  const expected = Buffer.from(computeSignature(authToken, buildSignatureBase(method, uri, params), nonce));
  return signatureHeader.split(",").some((sig) => {
    const given = Buffer.from(sig.trim());
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

// ---- Hangup cause mapping ----
export function mapHangupCause(params: Record<string, string>): EndReason {
  const name = `${params.HangupCauseName ?? ""} ${params.HangupCause ?? ""}`.toLowerCase();
  const source = (params.HangupSource ?? "").toLowerCase();
  const duration = Number(params.Duration ?? params.BillDuration ?? "0");
  const answered = Boolean(params.AnswerTime) || duration > 0;
  if (/machine/.test(name)) return "machine_detected";
  if (/busy/.test(name)) return "busy";
  if (/unallocated|invalid (destination|number)|invalid_number/.test(name)) return "invalid_number";
  if (/not in service|no route|unknown subscriber|number changed|not_in_service/.test(name)) return "not_in_service";
  if (/reject|declin/.test(name)) return "rejected";
  if (/no answer|no_answer|ring timeout|timeout/.test(name) && !answered) return "no_answer";
  if (/cancel|originator_cancel/.test(name) && !answered) return "cancelled";
  if (/time limit|max.*duration/.test(name)) return "max_duration";
  if (/network|temporary|congestion|unavailable|failure|error/.test(name) && !answered) return "network_error";
  if (!answered) return "never_connected";
  if (/callee|customer|destination/.test(source) || /end of xml|normal/.test(name)) {
    return source.includes("caller") || source.includes("api") || source.includes("plivo") ? "agent_ended" : "caller_hung_up";
  }
  return "completed_normally";
}

export class PrimaryCarrierAdapter implements TelephonyAdapter {
  readonly key = "primary";

  constructor(
    private readonly authId: string,
    private readonly authToken: string,
    private readonly answerBaseUrl: string,
  ) {}

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}/Account/${this.authId}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.authId}:${this.authToken}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      const customer =
        res.status === 401 || res.status === 403
          ? "The telephony connection rejected our credentials. Check your connection settings."
          : res.status === 404
            ? "The call or number was not found on the telephony connection."
            : res.status === 429
              ? "Too many calls are being placed right now. Calls will retry automatically."
              : "The telephony connection could not complete the request.";
      throw new TelephonyError(customer, `carrier ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`, res.status);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  async placeCall(input: PlaceCallInput): Promise<PlacedCall> {
    const q = `callId=${encodeURIComponent(input.callId)}`;
    const body: Record<string, unknown> = {
      from: toCarrierNumber(input.from),
      to: toCarrierNumber(input.to),
      answer_url: `${this.answerBaseUrl}/telephony/answer?${q}`,
      answer_method: "POST",
      hangup_url: `${this.answerBaseUrl}/telephony/hangup?${q}`,
      hangup_method: "POST",
      ring_url: `${this.answerBaseUrl}/telephony/ring?${q}`,
      ring_method: "POST",
      ring_timeout: input.ringTimeoutSec ?? 35,
      time_limit: input.timeLimitSec ?? 1800,
    };
    if (input.machineDetection) {
      body.machine_detection = "true";
      // Kept well inside the documented 2000–10000 ms range.
      body.machine_detection_time = 4000;
      body.machine_detection_url = `${this.answerBaseUrl}/telephony/machine?${q}`;
      body.machine_detection_method = "POST";
    }
    const res = await this.api<{ request_uuid?: string | string[] }>("POST", "/Call/", body);
    const id = Array.isArray(res.request_uuid) ? res.request_uuid[0] : res.request_uuid;
    if (!id) throw new TelephonyError("The call could not be started.", "carrier returned no request id");
    return { providerCallId: id };
  }

  async hangup(providerCallId: string) {
    try {
      await this.api("DELETE", `/Call/${encodeURIComponent(providerCallId)}/`);
    } catch (e) {
      if (e instanceof TelephonyError && e.status === 404) return; // already ended
      throw e;
    }
  }

  async transfer(providerCallId: string, toE164: string, callerId: string, callId: string) {
    const url = `${this.answerBaseUrl}/telephony/transfer-xml?callId=${encodeURIComponent(callId)}&to=${encodeURIComponent(toE164)}&from=${encodeURIComponent(callerId)}`;
    await this.api("POST", `/Call/${encodeURIComponent(providerCallId)}/`, {
      legs: "aleg",
      aleg_url: url,
      aleg_method: "POST",
    });
  }

  async getCallStatus(providerCallId: string): Promise<CallStatusReport> {
    try {
      const live = await this.api<{ call_status?: string }>("GET", `/Call/${encodeURIComponent(providerCallId)}/?status=live`);
      if (live.call_status) {
        return {
          state: live.call_status === "ringing" ? "ringing" : "in_progress",
          endReason: null,
          durationSec: null,
          answeredAt: null,
          endedAt: null,
        };
      }
    } catch (e) {
      if (!(e instanceof TelephonyError) || e.status !== 404) throw e;
    }
    try {
      const cdr = await this.api<{
        hangup_cause_name?: string;
        hangup_source?: string;
        call_duration?: number;
        answer_time?: string | null;
        end_time?: string | null;
      }>("GET", `/Call/${encodeURIComponent(providerCallId)}/`);
      const params: Record<string, string> = {
        HangupCauseName: cdr.hangup_cause_name ?? "",
        HangupSource: cdr.hangup_source ?? "",
        Duration: String(cdr.call_duration ?? 0),
        AnswerTime: cdr.answer_time ?? "",
      };
      return {
        state: "completed",
        endReason: mapHangupCause(params),
        durationSec: cdr.call_duration ?? 0,
        answeredAt: cdr.answer_time ? new Date(`${cdr.answer_time}Z`.replace(" ", "T").replace(/\+\d\d:\d\dZ$/, "Z")) : null,
        endedAt: cdr.end_time ? new Date(`${cdr.end_time}Z`.replace(" ", "T").replace(/\+\d\d:\d\dZ$/, "Z")) : null,
      };
    } catch (e) {
      if (e instanceof TelephonyError && e.status === 404) {
        return { state: "unknown", endReason: null, durationSec: null, answeredAt: null, endedAt: null };
      }
      throw e;
    }
  }

  async listNumbers(): Promise<CarrierNumber[]> {
    const out: CarrierNumber[] = [];
    for (let offset = 0; offset < 2000; offset += 20) {
      const page = await this.api<{
        objects?: { number: string; alias?: string | null; region?: string | null; number_type?: string; voice_enabled?: boolean }[];
        meta?: { next?: string | null };
      }>("GET", `/Number/?limit=20&offset=${offset}`);
      for (const n of page.objects ?? []) {
        out.push({
          e164: fromCarrierNumber(n.number),
          providerRef: n.number,
          label: null, // carrier aliases may contain vendor names; never surface them
          region: n.region ?? null,
          numberType: n.number_type ?? null,
          voiceEnabled: n.voice_enabled !== false,
        });
      }
      if (!page.meta?.next) break;
    }
    return out;
  }

  async searchNumbers(query: { countryIso: string; pattern?: string; type?: string }): Promise<AvailableNumber[]> {
    const qs = new URLSearchParams({ country_iso: query.countryIso, limit: "20", services: "voice" });
    if (query.pattern) qs.set("pattern", query.pattern);
    if (query.type) qs.set("type", query.type);
    const res = await this.api<{
      objects?: { number: string; region?: string; type?: string; monthly_rental_rate?: string; setup_rate?: string; voice_enabled?: boolean }[];
    }>("GET", `/PhoneNumber/?${qs}`);
    // Rates are reported in USD by the carrier; they are converted by the
    // pricing layer, never shown raw.
    return (res.objects ?? []).map((n) => ({
      e164: fromCarrierNumber(n.number),
      region: n.region ?? null,
      numberType: n.type ?? null,
      monthlyRentalPaise: null,
      setupFeePaise: null,
      voiceEnabled: n.voice_enabled !== false,
    }));
  }

  async buyNumber(e164: string): Promise<CarrierNumber> {
    await this.api("POST", `/PhoneNumber/${toCarrierNumber(e164)}/`, {});
    return { e164, providerRef: toCarrierNumber(e164), label: null, region: null, numberType: null, voiceEnabled: true };
  }

  async startRecording(providerCallId: string, callbackUrl: string) {
    await this.api("POST", `/Call/${encodeURIComponent(providerCallId)}/Record/`, {
      file_format: "mp3",
      callback_url: callbackUrl,
      callback_method: "POST",
      record_channel_type: "stereo",
    });
  }

  async downloadRecording(sourceUrl: string): Promise<Uint8Array> {
    const u = new URL(sourceUrl);
    if (u.protocol !== "https:" || !/(^|\.)plivo\.com$/.test(u.hostname)) {
      throw new TelephonyError("The recording link was not recognised.", `refusing to fetch recording from ${u.hostname}`);
    }
    const res = await fetch(u, { headers: { Authorization: `Basic ${Buffer.from(`${this.authId}:${this.authToken}`).toString("base64")}` } });
    if (!res.ok) throw new TelephonyError("The recording is not available yet.", `recording download ${res.status}`, res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  verifyWebhook(req: { method: string; url: string; headers: Headers; params: Record<string, string> }) {
    const nonce = req.headers.get("x-plivo-signature-v3-nonce");
    const sig = req.headers.get("x-plivo-signature-v3");
    const maSig = req.headers.get("x-plivo-signature-ma-v3");
    if (!nonce || (!sig && !maSig)) return false;
    return [sig, maSig].some(
      (s) => s && verifySignatureV3(this.authToken, req.method.toUpperCase(), req.url, nonce, s, req.params),
    );
  }

  endReasonFromWebhook(params: Record<string, string>) {
    return mapHangupCause(params);
  }

  streamResponse(opts: { streamUrl: string; statusUrl: string; format: "mulaw-8k" | "l16-16k"; maxSeconds: number; extra: Record<string, string> }) {
    const contentType = opts.format === "l16-16k" ? "audio/x-l16;rate=16000" : "audio/x-mulaw;rate=8000";
    const extra = Object.entries(opts.extra)
      .map(([k, v]) => `${k}=${v}`)
      .join(";");
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" audioTrack="inbound" contentType="${contentType}" streamTimeout="${opts.maxSeconds}" noiseCancellation="true" noiseCancellationLevel="70" statusCallbackUrl="${xmlEscape(opts.statusUrl)}" statusCallbackMethod="POST" extraHeaders="${xmlEscape(extra)}">${xmlEscape(opts.streamUrl)}</Stream>
</Response>`;
  }

  transferResponse(opts: { toE164: string; callerId: string; actionUrl: string }) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${xmlEscape(toCarrierNumber(opts.callerId))}" timeout="30" action="${xmlEscape(opts.actionUrl)}" method="POST" redirect="true">
    <Number>${xmlEscape(toCarrierNumber(opts.toE164))}</Number>
  </Dial>
</Response>`;
  }

  sayAndHangupResponse(text: string, language: string) {
    const lang = language === "hi-IN" ? "hi-IN" : "en-IN";
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak language="${lang}">${xmlEscape(text)}</Speak>
  <Hangup/>
</Response>`;
  }
}
