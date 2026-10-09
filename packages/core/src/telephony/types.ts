import type { EndReason } from "../outcomes";

/**
 * Provider-neutral telephony contract. UI, errors and logs shown to
 * customers only ever see these neutral types — never a carrier name.
 */

export interface PlaceCallInput {
  from: string;
  to: string;
  /** Our call id, echoed back on every webhook. */
  callId: string;
  ringTimeoutSec?: number;
  timeLimitSec?: number;
  machineDetection?: boolean;
}

export interface PlacedCall {
  providerCallId: string;
}

export interface CarrierNumber {
  e164: string;
  providerRef: string;
  label: string | null;
  region: string | null;
  numberType: string | null;
  voiceEnabled: boolean;
}

export interface AvailableNumber {
  e164: string;
  region: string | null;
  numberType: string | null;
  monthlyRentalPaise: number | null;
  setupFeePaise: number | null;
  voiceEnabled: boolean;
}

export interface CallStatusReport {
  state: "ringing" | "in_progress" | "completed" | "unknown";
  endReason: EndReason | null;
  durationSec: number | null;
  answeredAt: Date | null;
  endedAt: Date | null;
}

export interface TelephonyAdapter {
  readonly key: string;
  placeCall(input: PlaceCallInput): Promise<PlacedCall>;
  hangup(providerCallId: string): Promise<void>;
  transfer(providerCallId: string, toE164: string, callerId: string, callId: string): Promise<void>;
  getCallStatus(providerCallId: string): Promise<CallStatusReport>;
  listNumbers(): Promise<CarrierNumber[]>;
  searchNumbers(query: { countryIso: string; pattern?: string; type?: string }): Promise<AvailableNumber[]>;
  buyNumber(e164: string): Promise<CarrierNumber>;
  startRecording(providerCallId: string, callbackUrl: string): Promise<void>;
  /** Verify that a webhook genuinely came from the carrier. */
  verifyWebhook(req: { method: string; url: string; headers: Headers; params: Record<string, string> }): boolean;
  /** Map a carrier hangup payload to a neutral end reason. */
  endReasonFromWebhook(params: Record<string, string>): EndReason;
  /** Build the XML document that connects an answered call to our media stream. */
  streamResponse(opts: { streamUrl: string; statusUrl: string; format: "mulaw-8k" | "l16-16k"; maxSeconds: number; extra: Record<string, string> }): string;
  /** Build the XML that bridges the caller to a human. */
  transferResponse(opts: { toE164: string; callerId: string; actionUrl: string }): string;
  /** XML for a short spoken message followed by hangup (e.g. outside hours). */
  sayAndHangupResponse(text: string, language: string): string;
}

/** Plain-language error for customers; the technical cause goes to logs. */
export class TelephonyError extends Error {
  constructor(
    public readonly customerMessage: string,
    public readonly technical: string,
    public readonly status?: number,
  ) {
    super(customerMessage);
  }
}
