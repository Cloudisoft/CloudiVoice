/**
 * Language registry. Targets are not guarantees: a language is only offered
 * for live agents once it has been validated end to end on the configured
 * speech stack (status "available"). Everything else is shown honestly as
 * "in validation".
 */

export type LanguageStatus = "available" | "in_validation";

export interface Language {
  code: string;
  name: string;
  native: string;
  status: LanguageStatus;
  /** Default agent voice for this language on the speech stack. */
  defaultVoice: { female: string; male: string };
}

export const LANGUAGES: Language[] = [
  { code: "hi-IN", name: "Hindi", native: "हिन्दी", status: "available", defaultVoice: { female: "priya", male: "aditya" } },
  { code: "en-IN", name: "English (India)", native: "English", status: "available", defaultVoice: { female: "simran", male: "rahul" } },
  { code: "gu-IN", name: "Gujarati", native: "ગુજરાતી", status: "in_validation", defaultVoice: { female: "ritu", male: "amit" } },
  { code: "mr-IN", name: "Marathi", native: "मराठी", status: "in_validation", defaultVoice: { female: "kavya", male: "dev" } },
  { code: "bn-IN", name: "Bengali", native: "বাংলা", status: "in_validation", defaultVoice: { female: "ishita", male: "varun" } },
  { code: "ta-IN", name: "Tamil", native: "தமிழ்", status: "in_validation", defaultVoice: { female: "kavitha", male: "mani" } },
  { code: "te-IN", name: "Telugu", native: "తెలుగు", status: "in_validation", defaultVoice: { female: "shreya", male: "vijay" } },
  { code: "kn-IN", name: "Kannada", native: "ಕನ್ನಡ", status: "in_validation", defaultVoice: { female: "roopa", male: "anand" } },
  { code: "ml-IN", name: "Malayalam", native: "മലയാളം", status: "in_validation", defaultVoice: { female: "shruti", male: "gokul" } },
  { code: "pa-IN", name: "Punjabi", native: "ਪੰਜਾਬੀ", status: "in_validation", defaultVoice: { female: "simran", male: "anand" } },
  { code: "od-IN", name: "Odia", native: "ଓଡ଼ିଆ", status: "in_validation", defaultVoice: { female: "priya", male: "aditya" } },
];

/** Unicode block of each language's script (Devanagari is shared by Hindi and Marathi). */
const SCRIPTS: [RegExp, string][] = [
  [/[\u0A80-\u0AFF]/, "gu-IN"],
  [/[\u0A00-\u0A7F]/, "pa-IN"],
  [/[\u0980-\u09FF]/, "bn-IN"],
  [/[\u0B80-\u0BFF]/, "ta-IN"],
  [/[\u0C00-\u0C7F]/, "te-IN"],
  [/[\u0C80-\u0CFF]/, "kn-IN"],
  [/[\u0D00-\u0D7F]/, "ml-IN"],
  [/[\u0B00-\u0B7F]/, "od-IN"],
  [/[\u0900-\u097F]/, "hi-IN"],
];

/**
 * Language to synthesize a sentence in, from the script it is written in, so a
 * Gujarati sentence is always voiced as Gujarati even if the caller's last
 * words were detected as something else. Latin-only text keeps the current
 * language (English words inside an Indic call are spoken naturally).
 */
export function speechLanguage(text: string, current: string, primary: string): string {
  for (const [re, code] of SCRIPTS) {
    if (!re.test(text)) continue;
    if (code === "hi-IN") return primary === "mr-IN" || current === "mr-IN" ? "mr-IN" : "hi-IN";
    return code;
  }
  return current;
}

/**
 * Track the language the caller is speaking from speech recognition, without
 * flapping between look-alikes: Marathi is often detected as Hindi (same
 * script), so a Marathi agent stays in Marathi.
 */
export function callerLanguage(detected: string, primary: string, current: string): string {
  if (!LANGUAGES.some((l) => l.code === detected)) return current;
  if (primary === "mr-IN" && detected === "hi-IN") return "mr-IN";
  return detected;
}

/**
 * Operators promote a language after validating it on their speech stack by
 * listing it in ENABLED_LANGUAGES (comma-separated). Default: Hindi + Indian English.
 */
function enabledCodes(): Set<string> {
  const raw = typeof process !== "undefined" ? process.env.ENABLED_LANGUAGES : undefined;
  return new Set((raw && raw.trim() ? raw : "hi-IN,en-IN").split(",").map((c) => c.trim()));
}

export function languageStatus(code: string): LanguageStatus {
  return enabledCodes().has(code) ? "available" : "in_validation";
}

export function getLanguage(code: string | null | undefined): Language | undefined {
  const l = LANGUAGES.find((x) => x.code === code);
  return l ? { ...l, status: languageStatus(l.code) } : undefined;
}

export function allLanguages(): Language[] {
  return LANGUAGES.map((l) => ({ ...l, status: languageStatus(l.code) }));
}

export function availableLanguages() {
  return allLanguages().filter((l) => l.status === "available");
}

/** Voices offered in the agent builder (speech-stack speaker ids). */
export const VOICES = [
  { id: "priya", label: "Priya", gender: "female", style: "Warm, professional" },
  { id: "simran", label: "Simran", gender: "female", style: "Friendly, upbeat" },
  { id: "kavya", label: "Kavya", gender: "female", style: "Calm, reassuring" },
  { id: "ritu", label: "Ritu", gender: "female", style: "Clear, confident" },
  { id: "aditya", label: "Aditya", gender: "male", style: "Confident, steady" },
  { id: "rahul", label: "Rahul", gender: "male", style: "Conversational" },
  { id: "dev", label: "Dev", gender: "male", style: "Energetic" },
  { id: "amit", label: "Amit", gender: "male", style: "Measured, formal" },
] as const;

export type VoiceId = (typeof VOICES)[number]["id"];
