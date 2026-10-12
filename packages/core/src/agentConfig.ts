import { z } from "zod";

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

type Opening = { hi_f: string; hi_m: string; en: string };

/** Default openings. Hindi verbs agree with the speaker's gender (बोल रही / बोल रहा). */
export const DEFAULT_OPENINGS: Record<UseCase, Opening> = {
  receptionist: {
    hi_f: "नमस्ते! मैं {{company}} से {{agent_name}} बोल रही हूँ। बताइए, मैं आपकी क्या मदद कर सकती हूँ?",
    hi_m: "नमस्ते! मैं {{company}} से {{agent_name}} बोल रहा हूँ। बताइए, मैं आपकी क्या मदद कर सकता हूँ?",
    en: "Hello! This is {{agent_name}} from {{company}}. How can I help you today?",
  },
  sales: {
    hi_f: "नमस्ते {{first_name}} जी, मैं {{company}} से {{agent_name}} बोल रही हूँ। क्या अभी दो मिनट बात करना ठीक रहेगा?",
    hi_m: "नमस्ते {{first_name}} जी, मैं {{company}} से {{agent_name}} बोल रहा हूँ। क्या अभी दो मिनट बात करना ठीक रहेगा?",
    en: "Hi {{first_name}}, this is {{agent_name}} calling from {{company}}. Is now a good time for a quick two-minute chat?",
  },
  support: {
    hi_f: "नमस्ते! {{company}} support में आपका स्वागत है, मैं {{agent_name}} हूँ। बताइए क्या दिक्कत आ रही है?",
    hi_m: "नमस्ते! {{company}} support में आपका स्वागत है, मैं {{agent_name}} हूँ। बताइए क्या दिक्कत आ रही है?",
    en: "Hello, you've reached {{company}} support. I'm {{agent_name}}. What can I help you with?",
  },
  recruitment: {
    hi_f: "नमस्ते {{first_name}} जी, मैं {{company}} की hiring team से {{agent_name}} बोल रही हूँ। आपने हमारे job के लिए apply किया था, क्या अभी बात हो सकती है?",
    hi_m: "नमस्ते {{first_name}} जी, मैं {{company}} की hiring team से {{agent_name}} बोल रहा हूँ। आपने हमारे job के लिए apply किया था, क्या अभी बात हो सकती है?",
    en: "Hi {{first_name}}, this is {{agent_name}} from the {{company}} hiring team. You applied for one of our roles — is this a good time to talk?",
  },
  followup: {
    hi_f: "नमस्ते {{first_name}} जी, मैं {{company}} से {{agent_name}} बोल रही हूँ। आपने हमें callback के लिए कहा था, तो मैंने सोचा follow up कर लूँ।",
    hi_m: "नमस्ते {{first_name}} जी, मैं {{company}} से {{agent_name}} बोल रहा हूँ। आपने हमें callback के लिए कहा था, तो मैंने सोचा follow up कर लूँ।",
    en: "Hi {{first_name}}, this is {{agent_name}} from {{company}}, calling back as you requested.",
  },
};

const MALE_VOICES = new Set(["aditya", "rahul", "dev", "amit", "shubh", "rohan", "varun", "anand", "vijay", "mani", "gokul", "kabir", "manan", "sumit", "ratan"]);

export function voiceGender(voice: string): "female" | "male" {
  return MALE_VOICES.has(voice) ? "male" : "female";
}

export function defaultOpening(useCase: UseCase, language: string, voice: string): string {
  const o = DEFAULT_OPENINGS[useCase];
  if (language !== "hi-IN") return o.en;
  return voiceGender(voice) === "male" ? o.hi_m : o.hi_f;
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
        t = `${t} ${language === "hi-IN" ? "क्या अभी दो मिनट बात करना ठीक रहेगा?" : "Is this a good time to talk for a couple of minutes?"}`.trim();
      }
    }
  }
  return fillTemplate(t, vars);
}
