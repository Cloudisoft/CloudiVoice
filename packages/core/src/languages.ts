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
];

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
