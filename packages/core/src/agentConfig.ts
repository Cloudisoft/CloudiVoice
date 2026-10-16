import { z } from "zod";
import { openingPhrase, phrases } from "./phrases";

export const USE_CASES = {
  receptionist: "Receptionist & appointment booking",
  sales: "Sales qualification",
  support: "Customer support",
  recruitment: "Recruitment screening",
  followup: "Follow-up & callbacks",
} as const;
export type UseCase = keyof typeof USE_CASES;

export const agentConfigSchema = z.object({
  persona_name: z.string().trim().min(1).max(40).default("Ananya"),
  company_name: z.string().trim().min(1).max(80).default("our company"),
  use_case: z.enum(["receptionist", "sales", "support", "recruitment", "followup"]).default("receptionist"),
  primary_language: z.string().default("hi-IN"),
  fallback_language: z.string().default("en-IN"),
  code_switching: z.boolean().default(true),
  voice: z.string().default("priya"),
  pace: z.number().min(0.7).max(1.4).default(1.05),
  tone: z.enum(["warm", "professional", "energetic", "calm"]).default("warm"),
  formality: z.enum(["formal", "neutral", "casual"]).default("neutral"),
  opening_line: z.string().trim().max(400).default(""),
  instructions: z.string().trim().max(8000).default(""),
  /** Names, brands and terms callers will say (comma or newline separated) — helps the agent hear them. */
  vocabulary: z.string().trim().max(1500).default(""),
  goals: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  qualification_criteria: z.string().trim().max(2000).default(""),
  transfer_number: z.string().trim().max(20).default(""),
  max_duration_sec: z.number().int().min(120).max(3600).default(900),
  silence_checkin_sec: z.number().int().min(4).max(20).default(7),
  max_silence_checkins: z.number().int().min(1).max(3).default(2),
  max_clarifications: z.number().int().min(1).max(3).default(2),
  voicemail_message: z.string().trim().max(600).default(""),
  recording_disclosure: z.boolean().default(false),
  knowledge_enabled: z.boolean().default(true),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

export function parseAgentConfig(raw: unknown): AgentConfig {
  return agentConfigSchema.parse(raw ?? {});
}

const MALE_VOICES = new Set(["aditya", "rahul", "dev", "amit", "shubh", "rohan", "varun", "anand", "vijay", "mani", "gokul", "kabir", "manan", "sumit", "ratan"]);

export function voiceGender(voice: string): "female" | "male" {
  return MALE_VOICES.has(voice) ? "male" : "female";
}

/** Default opening for a use case; verbs agree with the voice's gender where the language needs it. */
export function defaultOpening(useCase: UseCase, language: string, voice: string): string {
  return openingPhrase(useCase, language, voiceGender(voice));
}

/** Placeholders that all mean "the person's name" — interchangeable in scripts. */
export const NAME_VARIABLES = ["first_name", "lead_name", "name", "customer_name", "caller_name", "full_name"] as const;
const NAME_RE = new RegExp(`\\{\\{\\s*(${NAME_VARIABLES.join("|")})\\s*\\}\\}`, "i");

/** Fill {{variables}} from lead/campaign data (case-insensitive); unknown variables are removed cleanly. */
export function fillTemplate(template: string, vars: Record<string, string | null | undefined>): string {
  const lower: Record<string, string | null | undefined> = {};
  for (const [k, v] of Object.entries(vars)) lower[k.toLowerCase()] = v;
  return template
    .replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi, (_, k: string) => {
      const key = k.toLowerCase();
      const v = lower[key] ?? lower[key.replace(/^custom_field\./, "")];
      return v == null ? "" : String(v);
    })
    .replace(/[ \t]+([,.!?।])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * A spoken opening line that never sounds broken when the lead has no name:
 * "नमस्ते {{first_name}} जी" → "नमस्ते जी", "Hi {{name}}," → "Hi,", and a
 * sentence that only works with a name ("क्या मेरी बात {{first_name}} से हो
 * रही है?") becomes a polite "is this a good time?" question.
 */
export function fillOpening(template: string, vars: Record<string, string | null | undefined>, language: string): string {
  let t = template.trim().replace(/^[“"'‘]+|[”"'’]+$/g, "").trim();
  const hasName = NAME_VARIABLES.some((k) => (vars[k] ?? "").toString().trim());
  if (!hasName && NAME_RE.test(t)) {
    const N = `\\{\\{\\s*(?:${NAME_VARIABLES.join("|")})\\s*\\}\\}`;
    t = t
      .replace(new RegExp(`(नमस्ते|नमस्कार|हैलो|हेलो)\\s+${N}\\s*(जी)?`, "gi"), (_m, g: string) => `${g} जी`)
      .replace(new RegExp(`\\b(Hi|Hello|Hey|Dear|Good (?:morning|afternoon|evening))\\s+${N}\\s*(ji)?`, "gi"), "$1")
      .replace(new RegExp(`\\s*${N}\\s+(जी|ji)\\b`, "gi"), " जी");
    if (NAME_RE.test(t)) {
      const sentences = t.match(/[^.!?।]+[.!?।]*/g) ?? [t];
      const kept = sentences.filter((x) => !NAME_RE.test(x));
      const droppedQuestion = sentences.some((x) => NAME_RE.test(x) && /[?]\s*$/.test(x));
      t = kept.join(" ").trim();
      if (droppedQuestion && !/[?]\s*$/.test(t)) {
        t = `${t} ${phrases(language).goodTime}`.trim();
      }
    }
  }
  return fillTemplate(t, vars);
}
