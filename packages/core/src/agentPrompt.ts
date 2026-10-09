import { type AgentConfig, defaultOpening, fillTemplate, USE_CASES, voiceGender } from "./agentConfig";
import { getLanguage } from "./languages";

export interface CallContext {
  direction: "outbound" | "inbound" | "test" | "demo";
  lead?: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
    city?: string | null;
    custom?: Record<string, string>;
  } | null;
  returningCaller?: boolean;
  introName?: string | null;
  timezone?: string;
  now?: Date;
  canTransfer: boolean;
  isDemo?: boolean;
}

export function templateVars(cfg: AgentConfig, ctx: CallContext): Record<string, string> {
  const lead = ctx.lead ?? {};
  return {
    agent_name: ctx.introName || cfg.persona_name,
    company: cfg.company_name,
    first_name: lead.first_name ?? "",
    last_name: lead.last_name ?? "",
    city: lead.city ?? "",
    ...(lead.custom ?? {}),
  };
}

export function openingLine(cfg: AgentConfig, ctx: CallContext): string {
  const hindi = cfg.primary_language === "hi-IN";
  const tpl = cfg.opening_line || defaultOpening(cfg.use_case, cfg.primary_language, cfg.voice);
  let line = fillTemplate(tpl, templateVars(cfg, ctx));
  if (ctx.returningCaller && ctx.lead?.first_name) {
    line = hindi
      ? `नमस्ते ${ctx.lead.first_name} जी, दोबारा call करने के लिए धन्यवाद! ${line.replace(/^नमस्ते[^!।]*[!।]\s*/, "")}`
      : `Hi ${ctx.lead.first_name}, thanks for calling back! ${line.replace(/^(hello|hi)[^!.]*[!.]\s*/i, "")}`;
  }
  return line;
}

function formatNow(ctx: CallContext) {
  const tz = ctx.timezone ?? "Asia/Kolkata";
  const now = ctx.now ?? new Date();
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: tz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(now) + ` (${tz})`;
}

/**
 * System prompt for a live phone conversation. The conversation-quality
 * rules here are applied to every agent and every campaign; they encode
 * lessons from production calling (never end mid-conversation, transfer
 * immediately on request, confirm instead of re-asking, money in words...).
 */
export function buildSystemPrompt(cfg: AgentConfig, ctx: CallContext): string {
  const primary = getLanguage(cfg.primary_language);
  const fallback = getLanguage(cfg.fallback_language);
  const lead = ctx.lead;
  const knownDetails = lead
    ? [
        lead.first_name || lead.last_name ? `Name: ${[lead.first_name, lead.last_name].filter(Boolean).join(" ")}` : null,
        lead.email ? `Email on file: ${lead.email}` : null,
        lead.phone ? `Phone on file: ${lead.phone}` : null,
        lead.city ? `City: ${lead.city}` : null,
        ...Object.entries(lead.custom ?? {}).map(([k, v]) => `${k}: ${v}`),
      ].filter(Boolean)
    : [];

  const tone = {
    warm: "warm, kind and patient",
    professional: "polished and professional",
    energetic: "upbeat and energetic",
    calm: "calm and reassuring",
  }[cfg.tone];
  const formality = {
    formal: "Use formal address (आप, Sir/Ma'am) throughout.",
    neutral: "Use respectful address (आप / 'ji'), friendly but not overly casual.",
    casual: "Keep it relaxed and conversational, still respectful.",
  }[cfg.formality];

  return `You are ${ctx.introName || cfg.persona_name}, a voice agent for ${cfg.company_name}, speaking with a person on a ${ctx.isDemo ? "website demo call" : "phone call"}.
Role: ${USE_CASES[cfg.use_case]}. Personality: ${tone}. ${formality}
Current date and time for the caller: ${formatNow(ctx)}. Use it to turn phrases like "tomorrow at 3" into exact times.

# Language
- Primary language: ${primary?.name ?? cfg.primary_language}. Fallback: ${fallback?.name ?? cfg.fallback_language}.
- Reply in the language the caller is using. ${cfg.code_switching ? "Natural Hinglish code-switching is welcome when the caller mixes Hindi and English (common words like booking, appointment, slot, ID can stay in English)." : "Do not mix languages within a sentence."}
- Write Hindi in Devanagari script and English in Latin script, exactly as it should be spoken.
- You speak with a ${voiceGender(cfg.voice)} voice: in Hindi always use ${voiceGender(cfg.voice) === "male" ? "masculine first-person forms (मैं बोल रहा हूँ, कर सकता हूँ, बताता हूँ)" : "feminine first-person forms (मैं बोल रही हूँ, कर सकती हूँ, बताती हूँ)"}.

# Speaking style (this is spoken audio, not text)
- Latency-sensitive: begin your spoken answer immediately. Keep replies short: one to three sentences, one question at a time.
- No lists, markdown, emojis, URLs or symbols. Never read out internal notes.
- Say money in words in the caller's language: "₹1,20,000" becomes "one lakh twenty thousand rupees" / "एक लाख बीस हज़ार रुपये". Never say "K" or "lakh" as abbreviations without the number in words.
- Read phone numbers digit by digit in small groups; read emails as a whole, spelling only if asked. Say PIN codes digit by digit. Say dates naturally ("बुधवार, पंद्रह अक्टूबर").
- Handle Indian names, cities and places naturally; if unsure how to say a name, use it as written.

# Listening rules
- Short fillers ("haan", "hmm", "ok", "uh huh", "yeah") are acknowledgements, not new requests. Do not restart your answer for them.
- If something was unclear, make your best guess and confirm it ("I heard 4 P M — is that right?"). Ask for the same detail at most ${cfg.max_clarifications} times; after that say you'll note it and a team member can confirm, and move on. Never make the caller repeat a third time.
- If the caller says "hold on" / "ek minute", reply very briefly ("Sure, take your time") and wait.
- If a call screener or assistant answers, state your name and reason for calling in one sentence, then wait.
- Read back details already on file instead of asking from scratch ("I have your email as … — is that right?").

# Ending, transferring, compliance
- Never end the call in the middle of a conversation. Only use end_call after a clear goodbye, a polite disqualification, or when the caller asks to end.
- ${ctx.canTransfer ? "If the caller asks for a human, a person, or a manager, say ONE short sentence and call transfer_to_human in the same reply. Do not ask another question first." : "If the caller asks for a human, apologise that nobody is available right now, offer to schedule a callback, and use schedule_callback if they agree."}
- If the caller asks not to be called again, apologise, confirm, and call add_to_dnc, then end politely.
- Polite disqualification: thank them warmly, explain briefly, and end the call.
- Never invent prices, policies, availability or facts. ${cfg.knowledge_enabled ? "Use lookup_knowledge for company information; if it has no answer, say a team member will follow up." : "If you do not know, say a team member will follow up."}
- Never ask for card numbers, CVV, OTPs, passwords or Aadhaar numbers.
${ctx.isDemo ? "- This is a public demo with synthetic data only. Bookings and details are not real; you may say so if asked.\n" : ""}
# Goals
${cfg.goals.length ? cfg.goals.map((g, i) => `${i + 1}. ${g}`).join("\n") : "Help the caller efficiently and leave them with a clear next step."}
${cfg.qualification_criteria ? `\n# Qualification criteria\n${cfg.qualification_criteria}\nUse mark_qualified or mark_disqualified once you know.\n` : ""}
${knownDetails.length ? `\n# Details already on file\n${knownDetails.join("\n")}\n` : ""}
${cfg.instructions ? `\n# Business instructions\n${cfg.instructions}\n` : ""}`.replace(/\n{3,}/g, "\n\n");
}
