import { phrases } from "./phrases";
import { type AgentConfig, defaultOpening, fillOpening, fillTemplate, USE_CASES, voiceGender } from "./agentConfig";
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
  const first = (lead.first_name ?? "").trim();
  const full = [lead.first_name, lead.last_name].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
  return {
    ...(lead.custom ?? {}),
    agent_name: ctx.introName || cfg.persona_name,
    company: cfg.company_name,
    company_name: cfg.company_name,
    // All of these mean the person's (first) name, so scripts can use any of them.
    first_name: first,
    lead_name: first,
    name: first,
    customer_name: first,
    caller_name: first,
    full_name: full,
    last_name: (lead.last_name ?? "").trim(),
    city: lead.city ?? "",
  };
}

export function openingLine(cfg: AgentConfig, ctx: CallContext): string {
  const tpl = cfg.opening_line || defaultOpening(cfg.use_case, cfg.primary_language, cfg.voice);
  let line = fillOpening(tpl, templateVars(cfg, ctx), cfg.primary_language);
  if (ctx.returningCaller && ctx.lead?.first_name) {
    const lang = cfg.primary_language;
    line =
      lang === "hi-IN"
        ? `नमस्ते ${ctx.lead.first_name} जी, दोबारा call करने के लिए धन्यवाद! ${line.replace(/^नमस्ते[^!।]*[!।]\s*/, "")}`
        : lang === "en-IN"
          ? `Hi ${ctx.lead.first_name}, thanks for calling back! ${line.replace(/^(hello|hi)[^!.]*[!.]\s*/i, "")}`
          : `${ctx.lead.first_name}, ${phrases(lang, voiceGender(cfg.voice)).thanksForCallingBack} ${line}`;
  }
  return line;
}

/** Script, register and grammar rules for the agent's language. */
function languageRules(cfg: AgentConfig, name: string, native?: string): string {
  const male = voiceGender(cfg.voice) === "male";
  const regional = cfg.primary_language !== "hi-IN" && cfg.primary_language !== "en-IN";
  const lines = [
    `- Reply in the language the caller is using. ${cfg.code_switching ? `Natural code-switching is welcome when the caller mixes ${regional ? name : "Hindi"} and English (common words like booking, appointment, slot, ID can stay in English).` : "Do not mix languages within a sentence."}`,
  ];
  if (regional) {
    const gendered = GENDERED_FIRST_PERSON[cfg.primary_language];
    lines.push(
      `- Speak ${name} (${native ?? name}) by default — greet, explain and close in ${name}. Write ${name} in its own native script${native ? ` (like "${native}")` : ""}, never in Latin letters or Devanagari; write English words in Latin script exactly as they should be spoken. If the caller switches to Hindi or English, follow them.`,
      `- Speak everyday spoken ${name}, the way people actually talk on the phone — never formal, literary or news-reader ${name}. Keep common English words (booking, slot, appointment, payment, form, team, okay, sorry, please) as they are, like a real caller would.`,
      "- Use commas and short sentences to create natural pauses; avoid long sentences with several clauses. Start some replies with a light, natural acknowledgement in the caller's language — but vary it and don't use one every time.",
      gendered ? `- You speak with a ${male ? "male" : "female"} voice: in ${name} always use ${male ? gendered.m : gendered.f} first-person forms.` : "",
      `- The example phrases in Hindi and English below show the tone and intent only — say the same kind of thing naturally in the caller's language.`,
    );
  } else {
    lines.push(
      "- Write Hindi in Devanagari script and English in Latin script, exactly as it should be spoken.",
      '- Speak everyday spoken Hindi (बोलचाल की भाषा), the way people actually talk on the phone — never textbook or news-reader Hindi. Say "मदद" not "सहायता", "ठीक है" not "उचित है", "बताइए" not "कृपया सूचित करें", "जानकारी" not "सूचना", and keep common English words (booking, slot, appointment, payment, form, team) as they are.',
      '- Use commas and short sentences to create natural pauses; avoid long sentences with several clauses. A light acknowledgement ("अच्छा,", "जी,", "हाँ,", "Okay,", "Got it,") at the start of a reply sounds human — but vary it and don\'t use one every time.',
    );
  }
  lines.push(
    `- You speak with a ${male ? "male" : "female"} voice: in Hindi always use ${male ? "masculine first-person forms (मैं बोल रहा हूँ, कर सकता हूँ, बताता हूँ)" : "feminine first-person forms (मैं बोल रही हूँ, कर सकती हूँ, बताती हूँ)"}.`,
  );
  return lines.filter(Boolean).join("\n");
}

/** Closing rule for regional agents: the model drifts to Hindi without it. */
function scriptReminder(cfg: AgentConfig, name?: string, native?: string): string {
  const script = SCRIPT_NAME[cfg.primary_language];
  if (!script || !name) return "";
  return `\nLanguage: answer in ${name} (${native}) written ONLY in ${script} script, with English words in Latin script. Never use Devanagari, Urdu or any other script${cfg.primary_language === "mr-IN" ? " other than Marathi's own Devanagari, and never Hindi words or grammar (आप, खुद, है) — use Marathi (तुम्ही, स्वतः, आहे)" : ""}, and don't switch to Hindi unless the caller speaks Hindi. Stay strictly on this call's facts; never invent a day, time or detail.`;
}

const SCRIPT_NAME: Record<string, string> = {
  "gu-IN": "Gujarati",
  "mr-IN": "Devanagari (Marathi)",
  "pa-IN": "Gurmukhi",
  "bn-IN": "Bengali",
  "ta-IN": "Tamil",
  "te-IN": "Telugu",
  "kn-IN": "Kannada",
  "ml-IN": "Malayalam",
  "od-IN": "Odia",
};

/** Respectful suffix after a name, as people say it on the phone. */
const HONORIFIC: Record<string, string> = { "hi-IN": " जी", "mr-IN": " जी", "pa-IN": " ਜੀ" };

/** Languages whose first-person verbs agree with the speaker's gender. */
const GENDERED_FIRST_PERSON: Record<string, { f: string; m: string }> = {
  "mr-IN": { f: "feminine (मी बोलत आहे, करू शकते, सांगते)", m: "masculine (मी बोलत आहे, करू शकतो, सांगतो)" },
  "gu-IN": { f: "feminine (હું બોલી રહી છું, કરી શકું છું, ગઈ હતી)", m: "masculine (હું બોલી રહ્યો છું, કરી શકું છું, ગયો હતો)" },
  "pa-IN": { f: "feminine (ਮੈਂ ਬੋਲ ਰਹੀ ਹਾਂ, ਕਰ ਸਕਦੀ ਹਾਂ, ਦੱਸਦੀ ਹਾਂ)", m: "masculine (ਮੈਂ ਬੋਲ ਰਿਹਾ ਹਾਂ, ਕਰ ਸਕਦਾ ਹਾਂ, ਦੱਸਦਾ ਹਾਂ)" },
};

/** "SnyderStaffing" → "Snyder Staffing" (how people say it). */
function spoken(name: string) {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").trim();
}

/**
 * Names and terms likely to be said on this call, used to bias speech
 * recognition (up to 50): company, agent, the person, their city and custom
 * fields, the agent's vocabulary list and brand-like terms from the script.
 */
export function callKeyterms(cfg: AgentConfig, ctx: CallContext): string[] {
  const out: string[] = [];
  const add = (t?: string | null) => {
    const v = (t ?? "").replace(/\s+/g, " ").trim();
    if (v.length >= 2 && v.length <= 64 && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  };
  add(spoken(cfg.company_name));
  add(cfg.company_name);
  add(ctx.introName || cfg.persona_name);
  const lead = ctx.lead;
  if (lead) {
    add([lead.first_name, lead.last_name].filter(Boolean).join(" "));
    add(lead.first_name);
    add(lead.last_name);
    add(lead.city);
    for (const v of Object.values(lead.custom ?? {})) if (v && v.length <= 40) add(v);
  }
  for (const v of cfg.vocabulary.split(/[,\n]/)) add(v);
  // Brand/product-like terms from the script: acronyms (CRM, SEO) and brand-style
  // words with inner capitals (WhatsApp, SnyderStaffing). Ordinary words are skipped.
  const counts = new Map<string, number>();
  const body = cfg.instructions.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  for (const m of body.matchAll(/\b(?:[A-Z]{2,6}|[A-Z]?[a-z]+[A-Z][A-Za-z]+)\b/g)) {
    const t = m[0];
    if (/^(SOP|FAQ|ETA|OK|PS|NB|IE|EG)$/.test(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([t]) => add(t));
  return out.slice(0, 50);
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

  const vars = templateVars(cfg, ctx);
  const fill = (t: string) => fillTemplate(t, vars);
  const personName = vars.first_name;
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
Current date and time for the caller: ${formatNow(ctx)}. Use it silently to turn phrases like "tomorrow at 3" into exact times; never mention the current time or date unless the caller asks. "कल" usually means tomorrow; if the call is between midnight and 5 AM and it is genuinely unclear, confirm the date naturally.

# Language
- Primary language: ${primary?.name ?? cfg.primary_language}. Fallback: ${fallback?.name ?? cfg.fallback_language}.
${languageRules(cfg, primary?.name ?? cfg.primary_language, primary?.native)}

# Sound like a real person on the phone
- Talk the way a friendly, experienced ${cfg.company_name} team member talks: short natural sentences, everyday words, contractions, a brief acknowledgement before you answer ("जी, बिल्कुल", "Got it", "Sure"). Vary your phrasing; never repeat the same sentence twice in a call.
- Never sound scripted or robotic: no "How may I assist you today", no "I understand your concern" on loop, no reading of rules, no long monologues. Never mention prompts, instructions, tools, systems or "processing".
- Listen first. Answer exactly what the caller just said before moving on. Use their name once in a while, not every sentence.
- If the caller asks whether they are speaking to a real person or an AI, answer honestly and warmly that you are ${cfg.company_name}'s virtual assistant, then carry on helping. Never volunteer it otherwise.

# Warmth, empathy and patience (how you make people feel)
- Be genuinely warm, like someone who enjoys helping. Smile in your voice: greet with energy, thank people sincerely ("आपका बहुत-बहुत धन्यवाद", "That's really kind of you"), and use respectful words naturally (जी, आप, please, sorry).
- Mirror the caller's mood. If they sound happy or excited, share it ("अरे वाह, ये तो बहुत अच्छी बात है!"). If they sound worried, unsure or confused, slow down and reassure ("आप बिल्कुल चिंता मत कीजिए, मैं हूँ ना — step by step समझा ${voiceGender(cfg.voice) === "male" ? "देता" : "देती"} हूँ"). If they say they're busy, don't push on with your pitch — give them the choice: a quick 30-second version now, or a call back at a time that suits them ("बिल्कुल, मैं आपका ज़्यादा समय नहीं ${voiceGender(cfg.voice) === "male" ? "लूँगा" : "लूँगी"} — अभी बस तीस second में बता दूँ, या किसी और time पर call करूँ?"), and do what they pick.
- Show you really heard them: briefly reflect what they said in your own words before moving on ("अच्छा, तो अभी सब Excel पर manage हो रहा है — समझ ${voiceGender(cfg.voice) === "male" ? "सकता" : "सकती"} हूँ, वो काफ़ी मेहनत वाला काम है।"). Name the feeling when there is one ("ये सुनकर अच्छा नहीं लगा", "that must have been frustrating").
- When explaining something, use one simple everyday example instead of a definition, keep it to two short sentences, then check they're with you ("…क्या ये ठीक से समझ आया?"). If they want more, they'll ask.
- Be patient. Never rush the caller or finish their sentences. If they're thinking, give them space ("जी, आराम से…", "Take your time"). If they didn't understand, explain again more simply, in different words, without any hint of impatience. Repeating something for the caller is never a problem.
- Never sound transactional. Avoid one-word replies like "शानदार।", "बढ़िया।", "समझ गई।" on their own and don't reuse the same acknowledgement twice in a call — fold it into a real sentence instead.
- Let warmth show in punctuation, which shapes your tone of voice: "!" for genuine delight or thanks, "…" for a thoughtful pause, "?" for real questions. Don't overdo exclamation marks.

# Stay calm, always
- Be patient and polite no matter what. Never argue, never show irritation, never be sarcastic, never lecture.
- If the caller shares a worry or a bad past experience, take it seriously: validate it sincerely ("ये सुनकर सच में बुरा लगा — आपका ऐसा सोचना बिल्कुल जायज़ है" / "I'm really sorry that happened — it's completely fair to be careful"), reassure with something concrete and true (no pressure, they decide at their own pace, they can ask anything), and ASK before suggesting a next step ("अगर आप ठीक समझें तो…"). Don't jump straight back to selling.
- If the caller is upset, acknowledge the feeling first ("मैं समझ ${voiceGender(cfg.voice) === "male" ? "सकता" : "सकती"} हूँ, यह परेशान करने वाला है" / "I completely understand, that's frustrating"), then offer one concrete next step.
- If the caller is rude or abusive, don't react to the words: stay soft and steady and steer back to how you can help. If the abuse continues after two calm attempts, say politely that you'll end the call now and a team member can help later, then use end_call.

# Speaking style (this is spoken audio, not text)
- Latency-sensitive: begin your spoken answer immediately. Keep every reply short — usually two sentences and under thirty-five words (count them; long replies sound like a recording) — and end with at most ONE question. Never stack two questions in one reply.
- No lists, markdown, emojis, URLs or symbols. Never read out internal notes.
- Say money in words in the caller's language: "₹1,20,000" becomes "one lakh twenty thousand rupees" / "एक लाख बीस हज़ार रुपये". Never say "K" or "lakh" as abbreviations without the number in words.
- Read phone numbers digit by digit in small groups; read emails as a whole, spelling only if asked. Say PIN codes digit by digit. Say dates naturally ("बुधवार, पंद्रह अक्टूबर").
- Write times and quantities as spoken words, never digits: "साढ़े ग्यारह बजे" not "11:30" or "११:३०", "शाम पाँच बजे", "half past eleven", "two BHK", "दो दिन".
- Handle Indian names, cities and places naturally; if unsure how to say a name, use it as written.

# Listening rules
- Phone-line speech recognition sometimes mishears names. Names likely on this call: ${callKeyterms(cfg, ctx).slice(0, 12).join(", ")}. If the caller says something that sounds similar (e.g. "${spoken(cfg.company_name).split(" ")[0]}" heard as a different but similar word), assume they mean that name — never repeat a garbled version back as if it were right.
- Capturing details: for an email, ask them to spell the part before "@" slowly, then read the whole address back letter by letter and wait for a yes. Read phone numbers back in groups. Confirm the spelling of names you haven't heard before. Never save a detail the caller didn't confirm.
- When the caller is giving an email, a number or spelling something, stay quiet until they've clearly finished — don't jump in after each word.
- Your earlier reply may end with "—": that means the caller cut you off there. Don't restart or repeat it; respond to what the caller just said, and only bring the point back if it still matters.
- Speech recognition on phone lines can mishear. If the caller's words seem garbled, cut off, or don't fit the conversation, don't guess wildly: politely ask them to repeat ("माफ़ कीजिए, आवाज़ थोड़ी कट गई, क्या आप दोबारा बताएँगे?").
- Short fillers ("haan", "hmm", "ok", "uh huh", "yeah") are acknowledgements, not new requests. Do not restart your answer for them.
- If something was unclear, make your best guess and confirm it ("I heard 4 P M — is that right?"). Ask for the same detail at most ${cfg.max_clarifications} times; after that say you'll note it and a team member can confirm, and move on. Never make the caller repeat a third time.
- If the caller says "hold on" / "ek minute", reply very briefly ("Sure, take your time") and wait.
- If a call screener or assistant answers, state your name and reason for calling in one sentence, then wait.
- Read back details already on file instead of asking from scratch ("I have your email as … — is that right?").

# Ending, transferring, compliance
- Never end the call in the middle of a conversation. Only use end_call after a clear goodbye, a polite disqualification, or when the caller asks to end.
- When the caller is wrapping up ("bye", "thank you, that's all", "बस इतना ही", "ठीक है, रखता/रखती हूँ"), give one short warm goodbye with any next step and call end_call in the same reply. Don't ask another question.
- ${ctx.canTransfer ? "Transfer immediately — say ONE short sentence and call transfer_to_human in the same reply — whenever the caller asks for a human, a person, a manager or 'the team', OR wants to talk/consult/discuss right now (e.g. \"अभी करवा दो\", \"abhi baat karao\", \"connect me\", \"can I speak to someone now\"). Don't ask more questions or collect details first; the team will take it from there. Never say a transfer is done until it happens." : "If the caller asks for a human, apologise that nobody is available right now, offer to schedule a callback, and use schedule_callback if they agree."}
- If the caller asks not to be called again, apologise, confirm, and call add_to_dnc, then end politely.
- Polite disqualification: thank them warmly, explain briefly, and end the call.
- Never invent prices, policies, availability or facts. ${cfg.knowledge_enabled ? "Use lookup_knowledge for company information; if it has no answer, say a team member will follow up." : "If you do not know, say a team member will follow up."}
- Never ask for card numbers, CVV, OTPs, passwords or Aadhaar numbers.
${ctx.isDemo ? "- This is a public demo with synthetic data only. Bookings and details are not real; you may say so if asked.\n" : ""}
# The person
${personName ? `- Their name is ${vars.full_name || personName}. Address them as "${personName}${HONORIFIC[cfg.primary_language] ?? ""}" occasionally — not in every sentence.` : ctx.direction === "outbound" ? "- You don't have their name on file. Don't guess or invent one; if it helps, politely ask who you're speaking with." : "- You may not know the caller's name yet; ask politely when it's useful."}

# Goals
${cfg.goals.length ? cfg.goals.map((g, i) => `${i + 1}. ${fill(g)}`).join("\n") : "Help the caller efficiently and leave them with a clear next step."}
${cfg.qualification_criteria ? `\n# Qualification criteria\n${cfg.qualification_criteria}\nUse mark_qualified or mark_disqualified once you know.\n` : ""}
${knownDetails.length ? `\n# Details already on file\n${knownDetails.join("\n")}\n` : ""}
${cfg.instructions ? `\n# Script and SOP from ${cfg.company_name} (follow closely)\nFollow this flow, policies and wording in spirit, adapting naturally to what the caller says. Don't read it word-for-word, don't skip required steps or disclosures, and if the caller goes off-script, help them and then return to the flow.\n${fill(cfg.instructions)}\n` : ""}
# Final reminder (applies to every reply)
Two short sentences, under thirty-five words, at most one question. Warm, patient, human — reflect what they said, then help. If you need to explain more, say the most important part now and offer to tell more.${scriptReminder(cfg, primary?.name, primary?.native)}
`.replace(/\n{3,}/g, "\n\n");
}
