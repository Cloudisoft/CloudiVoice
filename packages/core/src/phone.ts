/**
 * Phone number normalization. India-first: a bare 10-digit mobile/landline
 * is treated as +91. Any format a person types — "098765 43210",
 * "+91-98765-43210", "(0) 98765 43210", "9876543210" — maps to the same
 * E.164 value and the same search key.
 */

export interface NormalizedPhone {
  e164: string;
  /** National significant number (digits after the country code). */
  national: string;
  countryCode: string;
}

const KNOWN_CC = ["1", "7", "44", "61", "65", "71", "91", "966", "971", "974", "977", "880", "94"];

export function normalizePhone(raw: string, defaultCountry = "91"): NormalizedPhone | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const hasPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return null;

  if (!hasPlus && digits.startsWith("00")) {
    digits = digits.slice(2);
    return fromInternational(digits);
  }
  if (hasPlus) return fromInternational(digits);

  if (defaultCountry === "91") {
    // 0XXXXXXXXXX (trunk prefix) -> drop the 0
    if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
    // 91XXXXXXXXXX without plus
    if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
    if (digits.length === 10 && /^[1-9]/.test(digits)) {
      return { e164: `+91${digits}`, national: digits, countryCode: "91" };
    }
    // Toll-free 1800XXXXXXX
    if (/^1[89]00\d{6,7}$/.test(digits)) {
      return { e164: `+91${digits}`, national: digits, countryCode: "91" };
    }
    return null;
  }

  if (digits.startsWith("0")) digits = digits.slice(1);
  const e164 = `+${defaultCountry}${digits}`;
  return isPlausible(e164) ? { e164, national: digits, countryCode: defaultCountry } : null;
}

function fromInternational(digits: string): NormalizedPhone | null {
  const e164 = `+${digits}`;
  if (!isPlausible(e164)) return null;
  const cc = [...KNOWN_CC].sort((a, b) => b.length - a.length).find((c) => digits.startsWith(c));
  if (cc === "91") {
    const national = digits.slice(2);
    if (!/^[1-9]\d{9}$/.test(national) && !/^1[89]00\d{6,7}$/.test(national)) return null;
    return { e164, national, countryCode: "91" };
  }
  return { e164, national: cc ? digits.slice(cc.length) : digits, countryCode: cc ?? "" };
}

export function isPlausible(e164: string) {
  return /^\+[1-9]\d{7,14}$/.test(e164);
}

/** Indian mobile numbers start with 6–9. */
export function isIndianMobile(e164: string) {
  return /^\+91[6-9]\d{9}$/.test(e164);
}

/**
 * Digits used to match a search query against stored numbers, whatever
 * format the query was typed in. Returns null when the query has too few
 * digits to be a phone search.
 */
export function phoneSearchKey(query: string): string | null {
  let digits = query.replace(/[^\d]/g, "");
  if (digits.length < 4) return null;
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 14 && digits.startsWith("0091")) digits = digits.slice(4);
  return digits;
}

/** "+919876543210" -> "+91 98765 43210" */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  if (m) return `+91 ${m[1]} ${m[2]}`;
  return e164;
}

/**
 * How an agent should read a number aloud: grouped digits, never as one
 * large number. "98765 43210" -> "9 8 7 6 5, 4 3 2 1 0".
 */
export function phoneForSpeech(e164: string): string {
  const national = e164.replace(/^\+91/, "");
  const groups = national.length === 10 ? [national.slice(0, 5), national.slice(5)] : [national];
  return groups.map((g) => g.split("").join(" ")).join(", ");
}
