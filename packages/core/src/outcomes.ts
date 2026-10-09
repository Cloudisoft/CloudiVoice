/**
 * Call outcomes (dispositions) and the logic that derives one automatically
 * from how a call ended, what was said, and what the agent did.
 * Every derived outcome carries a confidence score and a plain-language
 * reason. Supervisor overrides are never overwritten.
 */

export const OUTCOMES = {
  answered: "Answered",
  interested: "Interested",
  qualified: "Qualified",
  appointment_booked: "Appointment booked",
  callback_requested: "Callback requested",
  transferred: "Transferred",
  not_interested: "Not interested",
  disqualified: "Disqualified",
  no_answer: "No answer",
  busy: "Busy",
  voicemail: "Voicemail",
  dnc: "Do not call",
  wrong_number: "Wrong number",
  not_in_service: "Not in service",
  disconnected: "Disconnected",
  failed: "Failed",
} as const;

export type Outcome = keyof typeof OUTCOMES;

/** Outcomes whose leads may never be reset or redialled automatically. */
export const PERMANENT_OUTCOMES: readonly Outcome[] = ["dnc", "not_in_service", "disconnected", "not_interested", "wrong_number"];

/** Provider-neutral reasons a call ended. Adapters map carrier codes to these. */
export const END_REASONS = {
  completed_normally: "The conversation ended normally.",
  caller_hung_up: "The person hung up.",
  agent_ended: "The agent ended the call after a goodbye.",
  no_answer: "The call rang but nobody picked up.",
  never_connected: "The call never connected.",
  busy: "The line was busy.",
  rejected: "The call was declined.",
  invalid_number: "The number is not valid.",
  not_in_service: "The number is not in service.",
  network_error: "The phone network could not complete the call.",
  machine_detected: "An answering machine or voicemail picked up.",
  transferred: "The call was handed to a person.",
  max_duration: "The call reached its maximum allowed length.",
  silence_timeout: "The line stayed silent, so the agent ended the call politely.",
  cancelled: "The call was cancelled before it connected.",
  dial_timeout: "The call did not ring through in time.",
  unknown: "The call ended for an unknown reason.",
} as const;

export type EndReason = keyof typeof END_REASONS;

export function endReasonText(reason: string | null | undefined): string {
  if (!reason) return "";
  return (END_REASONS as Record<string, string>)[reason] ?? END_REASONS.unknown;
}

export interface OutcomeSignals {
  endReason: EndReason;
  answered: boolean;
  durationSec: number;
  /** Lines spoken by the caller (lowercased text). */
  callerLines: string[];
  /** Actions the agent took during the call. */
  tools: string[];
  voicemailDetected?: boolean;
  transferStatus?: "transferred" | "failed" | "no_answer" | null;
}

export interface DerivedOutcome {
  outcome: Outcome;
  confidence: number;
  reason: string;
}

const VOICEMAIL_PHRASES = [
  "leave a message",
  "after the tone",
  "after the beep",
  "is not available",
  "person you are trying to reach",
  "the number you have dialled",
  "the number you have dialed",
  "कृपया संदेश",
  "उपलब्ध नहीं",
  "स्विच ऑफ",
  "switched off",
  "not reachable",
];

const NOT_INTERESTED = ["not interested", "no thanks", "no thank you", "don't call", "do not call", "दिलचस्पी नहीं", "interest नहीं", "मत करो कॉल", "रुचि नहीं"];
const WRONG_NUMBER = ["wrong number", "galat number", "गलत नंबर"];

export function deriveOutcome(s: OutcomeSignals): DerivedOutcome {
  const text = s.callerLines.join(" \n ").toLowerCase();
  const has = (list: string[]) => list.some((p) => text.includes(p.toLowerCase()));

  if (s.tools.includes("add_to_dnc")) return { outcome: "dnc", confidence: 0.98, reason: "The person asked not to be called again." };
  if (s.transferStatus === "transferred" || s.endReason === "transferred")
    return { outcome: "transferred", confidence: 0.97, reason: "The call was handed to a person." };

  switch (s.endReason) {
    case "busy":
      return { outcome: "busy", confidence: 0.95, reason: END_REASONS.busy };
    case "invalid_number":
    case "not_in_service":
      return { outcome: "not_in_service", confidence: 0.9, reason: END_REASONS[s.endReason] };
    case "no_answer":
    case "never_connected":
    case "dial_timeout":
    case "cancelled":
      // Lesson learned: calls that never connected are No Answer and retried,
      // not "hung up".
      return { outcome: "no_answer", confidence: 0.9, reason: END_REASONS[s.endReason] };
    case "rejected":
      return { outcome: "no_answer", confidence: 0.7, reason: END_REASONS.rejected };
    case "network_error":
      return { outcome: "failed", confidence: 0.8, reason: END_REASONS.network_error };
    case "machine_detected":
      return { outcome: "voicemail", confidence: 0.9, reason: END_REASONS.machine_detected };
    default:
      break;
  }

  if (s.voicemailDetected || has(VOICEMAIL_PHRASES))
    return { outcome: "voicemail", confidence: s.voicemailDetected ? 0.9 : 0.75, reason: "The greeting sounded like voicemail." };

  if (!s.answered || (s.durationSec < 2 && s.callerLines.length === 0))
    return { outcome: "no_answer", confidence: 0.7, reason: "Nobody spoke on the line." };

  if (s.tools.includes("book_appointment")) return { outcome: "appointment_booked", confidence: 0.92, reason: "The agent booked an appointment." };
  if (s.tools.includes("schedule_callback")) return { outcome: "callback_requested", confidence: 0.9, reason: "The person asked to be called back later." };
  if (s.tools.includes("mark_disqualified")) return { outcome: "disqualified", confidence: 0.85, reason: "The person did not meet the qualification criteria." };
  if (s.tools.includes("mark_qualified")) return { outcome: "qualified", confidence: 0.85, reason: "The person met the qualification criteria." };
  if (has(WRONG_NUMBER)) return { outcome: "wrong_number", confidence: 0.75, reason: "The person said this is the wrong number." };
  if (has(NOT_INTERESTED)) return { outcome: "not_interested", confidence: 0.75, reason: "The person said they were not interested." };
  if (s.tools.includes("save_caller_details")) return { outcome: "interested", confidence: 0.65, reason: "The person shared their details." };
  if (s.callerLines.length === 0) return { outcome: "no_answer", confidence: 0.6, reason: "The call connected but the person never spoke." };
  return { outcome: "answered", confidence: 0.6, reason: "The person answered and spoke with the agent." };
}

export interface RetryRule {
  retry: boolean;
  delay_minutes: number;
}
export type RetryRules = Partial<Record<Outcome, RetryRule>> & Record<string, RetryRule | undefined>;

/** Whether a lead should be re-queued after this outcome, and when. */
export function retryDecision(
  outcome: Outcome,
  attempts: number,
  maxAttempts: number,
  rules: RetryRules,
  now = new Date(),
): { retry: false } | { retry: true; at: Date } {
  if (PERMANENT_OUTCOMES.includes(outcome)) return { retry: false };
  if (attempts >= maxAttempts) return { retry: false };
  const rule = rules[outcome];
  if (!rule?.retry) return { retry: false };
  return { retry: true, at: new Date(now.getTime() + Math.max(1, rule.delay_minutes) * 60_000) };
}
