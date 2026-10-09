/**
 * Explicit call lifecycle. Every state change goes through `canTransition`;
 * webhook delivery order is not guaranteed, so late or duplicate events
 * that would move a call backwards are rejected instead of applied.
 */

export const CALL_STATES = [
  "queued",
  "ringing",
  "answered",
  "in_progress",
  "voicemail",
  "transferring",
  "transferred",
  "completed",
  "failed",
] as const;

export type CallState = (typeof CALL_STATES)[number];

const TRANSITIONS: Record<CallState, readonly CallState[]> = {
  queued: ["ringing", "answered", "in_progress", "completed", "failed"],
  ringing: ["answered", "in_progress", "voicemail", "completed", "failed"],
  answered: ["in_progress", "voicemail", "transferring", "completed", "failed"],
  in_progress: ["voicemail", "transferring", "completed", "failed"],
  voicemail: ["completed", "failed"],
  transferring: ["transferred", "in_progress", "completed", "failed"],
  transferred: ["completed"],
  completed: [],
  failed: [],
};

export const TERMINAL_STATES: readonly CallState[] = ["completed", "failed"];
/** States shown on the Live Monitor. Transferred calls leave the list. */
export const LIVE_STATES: readonly CallState[] = ["queued", "ringing", "answered", "in_progress", "voicemail", "transferring"];

export function isCallState(s: string): s is CallState {
  return (CALL_STATES as readonly string[]).includes(s);
}

export function canTransition(from: CallState, to: CallState): boolean {
  if (from === to) return false;
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: CallState,
    public readonly to: CallState,
  ) {
    super(`Invalid call state transition ${from} -> ${to}`);
  }
}

export function assertTransition(from: CallState, to: CallState) {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export const CALL_STATE_LABEL: Record<CallState, string> = {
  queued: "Queued",
  ringing: "Ringing",
  answered: "Answered",
  in_progress: "In conversation",
  voicemail: "Voicemail",
  transferring: "Transferring",
  transferred: "Transferred",
  completed: "Completed",
  failed: "Failed",
};
