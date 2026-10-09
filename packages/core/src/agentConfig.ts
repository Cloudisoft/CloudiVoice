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

export const DEFAULT_OPENINGS: Record<UseCase, { hi: string; en: string }> = {
  receptionist: {
    hi: "नमस्ते! मैं {{company}} से {{agent_name}} बोल रही हूँ। बताइए, मैं आपकी क्या मदद कर सकती हूँ?",
    en: "Hello! This is {{agent_name}} from {{company}}. How can I help you today?",
  },
  sales: {
    hi: "नमस्ते {{first_name}} जी, मैं {{company}} से {{agent_name}} बोल रही हूँ। क्या अभी दो मिनट बात करना ठीक रहेगा?",
    en: "Hi {{first_name}}, this is {{agent_name}} calling from {{company}}. Is now a good time for a quick two-minute chat?",
  },
  support: {
    hi: "नमस्ते! {{company}} support में आपका स्वागत है, मैं {{agent_name}} हूँ। बताइए क्या दिक्कत आ रही है?",
    en: "Hello, you've reached {{company}} support. I'm {{agent_name}}. What can I help you with?",
  },
  recruitment: {
    hi: "नमस्ते {{first_name}} जी, मैं {{company}} की hiring team से {{agent_name}} बोल रही हूँ। आपने हमारे job के लिए apply किया था, क्या अभी बात हो सकती है?",
    en: "Hi {{first_name}}, this is {{agent_name}} from the {{company}} hiring team. You applied for one of our roles — is this a good time to talk?",
  },
  followup: {
    hi: "नमस्ते {{first_name}} जी, मैं {{company}} से {{agent_name}} बोल रही हूँ। आपने हमें callback के लिए कहा था, तो मैंने सोचा follow up कर लूँ।",
    en: "Hi {{first_name}}, this is {{agent_name}} from {{company}}, calling back as you requested.",
  },
};

/** Fill {{variables}} from lead/campaign data; unknown variables are removed cleanly. */
export function fillTemplate(template: string, vars: Record<string, string | null | undefined>): string {
  return template
    .replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi, (_, k: string) => {
      const v = vars[k] ?? vars[k.replace(/^custom_field\./, "")];
      return v == null ? "" : String(v);
    })
    .replace(/\s+([,.!?।])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}
