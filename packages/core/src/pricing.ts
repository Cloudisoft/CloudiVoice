/**
 * Configurable INR pricing. All amounts are integer paise. Operators set
 * real rates through PRICING_JSON; the defaults below are placeholders that
 * the marketing page and billing screens read from, so there is exactly one
 * source of truth for what customers are charged.
 */

export interface PricingConfig {
  currency: "INR";
  /** Per-minute components, billed per second of connected time. */
  perMinute: {
    telephony: number;
    speech_to_text: number;
    reasoning: number;
    text_to_speech: number;
    platform: number;
  };
  numberRentalMonthly: number;
  storagePerGbMonth: number;
  welcomeCredits: number;
  trial: { maxConcurrentCalls: number; maxMinutes: number; maxNumbers: number };
  plans: {
    id: string;
    name: string;
    monthlyFee: number;
    includedMinutes: number;
    concurrency: number;
    features: string[];
    highlight?: boolean;
  }[];
  exclusions: string[];
}

const DEFAULT_PRICING: PricingConfig = {
  currency: "INR",
  perMinute: {
    telephony: 45,
    speech_to_text: 40,
    reasoning: 60,
    text_to_speech: 60,
    platform: 45,
  },
  numberRentalMonthly: 50000,
  storagePerGbMonth: 2000,
  welcomeCredits: 100000,
  trial: { maxConcurrentCalls: 1, maxMinutes: 60, maxNumbers: 0 },
  plans: [
    {
      id: "starter",
      name: "Starter",
      monthlyFee: 0,
      includedMinutes: 0,
      concurrency: 2,
      features: ["Pay as you go", "1 AI agent", "Hindi & English", "Call records & transcripts", "Email support"],
    },
    {
      id: "growth",
      name: "Growth",
      monthlyFee: 999900,
      includedMinutes: 3000,
      concurrency: 10,
      features: ["Unlimited agents", "Campaigns & callbacks", "Knowledge base", "Analytics & QA scoring", "Human handoff", "Priority support"],
      highlight: true,
    },
    {
      id: "scale",
      name: "Scale",
      monthlyFee: 4999900,
      includedMinutes: 18000,
      concurrency: 50,
      features: ["Everything in Growth", "Role-based access & audit logs", "Custom retention", "Dedicated onboarding", "Volume rates"],
    },
  ],
  exclusions: ["GST is charged additionally as applicable.", "Number rental and one-time number setup are billed separately.", "Recording storage beyond retention period is billed per GB-month."],
};

export function pricing(): PricingConfig {
  const raw = typeof process !== "undefined" ? process.env.PRICING_JSON : undefined;
  if (!raw) return DEFAULT_PRICING;
  try {
    const custom = JSON.parse(raw) as Partial<PricingConfig>;
    return { ...DEFAULT_PRICING, ...custom, perMinute: { ...DEFAULT_PRICING.perMinute, ...custom.perMinute } };
  } catch {
    return DEFAULT_PRICING;
  }
}

export function aiPerMinute(p = pricing()) {
  const m = p.perMinute;
  return m.speech_to_text + m.reasoning + m.text_to_speech + m.platform;
}

export function allInPerMinute(p = pricing()) {
  return aiPerMinute(p) + p.perMinute.telephony;
}

/** "₹1,23,456.70" in Indian digit grouping. */
export function formatInr(paise: number | bigint, opts: { decimals?: boolean } = {}) {
  const rupees = Number(paise) / 100;
  const decimals = opts.decimals ?? !Number.isInteger(rupees);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/** Cost lines for a call of `seconds` connected time. */
export function callCostLines(seconds: number, p = pricing()) {
  const minutes = seconds / 60;
  return (Object.entries(p.perMinute) as [keyof PricingConfig["perMinute"], number][]).map(([category, rate]) => ({
    category,
    quantity: Number(minutes.toFixed(3)),
    unit: "minute",
    amount: Math.round(rate * minutes),
  }));
}
