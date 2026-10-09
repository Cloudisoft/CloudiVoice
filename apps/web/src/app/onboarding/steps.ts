export const STEPS = ["business", "voice", "agent", "instructions", "knowledge", "telephony", "test", "checks"] as const;
export type Step = (typeof STEPS)[number];
