import { describe, expect, it } from "vitest";
import { canTransition, CALL_STATES } from "../src/callState";
import { deriveOutcome, retryDecision } from "../src/outcomes";
import { formatPhone, normalizePhone, phoneForSpeech, phoneSearchKey } from "../src/phone";
import { mulawDecodeSample, mulawEncodeSample, resample, TurnDetector } from "../src/audio";
import { buildSignatureBase, computeSignature, mapHangupCause, verifySignatureV3 } from "../src/telephony/adapters/plivo";
import { isWithinCallingWindow } from "../src/schedule";
import { SentenceSplitter } from "../src/brain";
import { chunkText } from "../src/services/knowledge";
import { fillTemplate, parseAgentConfig } from "../src/agentConfig";
import { buildSystemPrompt, openingLine } from "../src/agentPrompt";
import { decryptSecret, encryptSecret, hashPassword, signPayload, verifyPayload, verifyPassword } from "../src/crypto";
import { guessMapping } from "../src/services/leads";
import { formatInr } from "../src/pricing";

describe("phone normalization", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["09876543210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["+91-98765-43210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["0091 98765 43210", "+919876543210"],
    ["(022) 2345 6789", "+912223456789"],
  ])("%s -> %s", (raw, e164) => {
    expect(normalizePhone(raw)?.e164).toBe(e164);
  });

  it("rejects garbage", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("search key matches any typed format", () => {
    const stored = normalizePhone("98765 43210")!.national;
    for (const q of ["98765-43210", "+91 9876543210", "09876543210", "(98765) 43210"]) {
      expect(stored.includes(phoneSearchKey(q)!)).toBe(true);
    }
  });

  it("formats for display and speech", () => {
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
    expect(phoneForSpeech("+919876543210")).toBe("9 8 7 6 5, 4 3 2 1 0");
  });
});

describe("call state machine", () => {
  it("allows the normal path", () => {
    expect(canTransition("queued", "ringing")).toBe(true);
    expect(canTransition("ringing", "answered")).toBe(true);
    expect(canTransition("answered", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "transferring")).toBe(true);
    expect(canTransition("transferring", "transferred")).toBe(true);
    expect(canTransition("transferred", "completed")).toBe(true);
  });
  it("rejects backwards and terminal moves", () => {
    expect(canTransition("completed", "in_progress")).toBe(false);
    expect(canTransition("in_progress", "ringing")).toBe(false);
    expect(canTransition("failed", "completed")).toBe(false);
    for (const s of CALL_STATES) expect(canTransition(s, s)).toBe(false);
  });
});

describe("outcomes", () => {
  const base = { answered: true, durationSec: 60, callerLines: ["haan bataiye"], tools: [] as string[] };
  it("marks never-connected calls as no answer (retried), not hung up", () => {
    const r = deriveOutcome({ ...base, endReason: "never_connected", answered: false, durationSec: 0, callerLines: [] });
    expect(r.outcome).toBe("no_answer");
    expect(r.reason).toMatch(/never connected/i);
  });
  it("prefers explicit agent actions", () => {
    expect(deriveOutcome({ ...base, endReason: "agent_ended", tools: ["book_appointment"] }).outcome).toBe("appointment_booked");
    expect(deriveOutcome({ ...base, endReason: "agent_ended", tools: ["add_to_dnc"] }).outcome).toBe("dnc");
  });
  it("detects voicemail from the greeting", () => {
    expect(deriveOutcome({ ...base, endReason: "caller_hung_up", callerLines: ["please leave a message after the tone"] }).outcome).toBe("voicemail");
  });
  it("never retries permanent outcomes", () => {
    const rules = { not_interested: { retry: true, delay_minutes: 10 }, no_answer: { retry: true, delay_minutes: 30 } };
    expect(retryDecision("not_interested", 1, 3, rules).retry).toBe(false);
    expect(retryDecision("no_answer", 3, 3, rules).retry).toBe(false);
    const d = retryDecision("no_answer", 1, 3, rules, new Date("2026-01-01T00:00:00Z"));
    expect(d.retry && d.at.toISOString()).toBe("2026-01-01T00:30:00.000Z");
  });
});

describe("audio", () => {
  it("mu-law round-trips within quantization error", () => {
    for (const s of [0, 100, -100, 1000, -5000, 20000, -32000]) {
      const back = mulawDecodeSample(mulawEncodeSample(s));
      expect(Math.abs(back - s)).toBeLessThanOrEqual(Math.max(16, Math.abs(s) * 0.07));
    }
  });
  it("resamples to the right length", () => {
    expect(resample(new Int16Array(1600), 16000, 8000).length).toBe(800);
    expect(resample(new Int16Array(800), 8000, 16000).length).toBe(1600);
  });
  it("turn detector emits an utterance after speech then silence, ignores clicks", () => {
    const vad = new TurnDetector({ sampleRate: 8000, endSilenceMs: 300, minSpeechMs: 200 });
    const tone = (ms: number, amp: number) => Int16Array.from({ length: (8000 * ms) / 1000 }, (_, i) => Math.round(Math.sin(i / 3) * amp));
    const events: string[] = [];
    for (let i = 0; i < 25; i++) vad.push(tone(20, 50)).forEach((e) => events.push(e.type));
    vad.push(tone(20, 8000)).forEach((e) => events.push(e.type)); // a single click
    for (let i = 0; i < 20; i++) vad.push(tone(20, 50)).forEach((e) => events.push(e.type));
    expect(events).toEqual(["noise"]);
    for (let i = 0; i < 25; i++) vad.push(tone(20, 8000)).forEach((e) => events.push(e.type));
    for (let i = 0; i < 20; i++) vad.push(tone(20, 50)).forEach((e) => events.push(e.type));
    expect(events).toEqual(["noise", "speech_start", "utterance"]);
  });
});

describe("telephony webhook signatures", () => {
  it("matches the documented assembly for POST", () => {
    const base = buildSignatureBase("POST", "https://example.com/abcd?foo=bar", {
      Digits: "1234",
      To: "+15555555555",
      From: "+15551111111",
      CallUUID: "4vbcpem8",
    });
    expect(base).toBe("https://example.com/abcd?foo=bar.CallUUID4vbcpem8Digits1234From+15551111111To+15555555555");
  });
  it("verifies a valid signature and rejects tampering", () => {
    const params = { CallUUID: "abc", From: "919876543210" };
    const url = "https://voice.example.com/telephony/answer?callId=1";
    const sig = computeSignature("token", buildSignatureBase("POST", url, params), "nonce1");
    expect(verifySignatureV3("token", "POST", url, "nonce1", sig, params)).toBe(true);
    expect(verifySignatureV3("token", "POST", url, "nonce1", `x,${sig}`, params)).toBe(true);
    expect(verifySignatureV3("token", "POST", url, "nonce2", sig, params)).toBe(false);
    expect(verifySignatureV3("token", "POST", url, "nonce1", sig, { ...params, From: "1" })).toBe(false);
  });
  it("maps hangup causes to neutral end reasons", () => {
    expect(mapHangupCause({ HangupCauseName: "Busy Line" })).toBe("busy");
    expect(mapHangupCause({ HangupCauseName: "No Answer" })).toBe("no_answer");
    expect(mapHangupCause({ HangupCauseName: "Unallocated Number" })).toBe("invalid_number");
    expect(mapHangupCause({ HangupCauseName: "Normal Hangup", HangupSource: "Callee", Duration: "40", AnswerTime: "x" })).toBe("caller_hung_up");
  });
});

describe("calling window", () => {
  const w = { timezone: "Asia/Kolkata", start: "09:00", end: "21:00", days: [1, 2, 3, 4, 5, 6] };
  it("is open at noon IST on a Monday", () => {
    expect(isWithinCallingWindow(new Date("2026-10-12T06:30:00Z"), w).open).toBe(true);
  });
  it("is closed late at night and on Sunday", () => {
    const night = isWithinCallingWindow(new Date("2026-10-12T17:00:00Z"), w); // 22:30 IST Monday
    expect(night.open).toBe(false);
    expect(night.nextOpenText).toMatch(/tomorrow at 9:00 AM/);
    expect(isWithinCallingWindow(new Date("2026-10-11T06:30:00Z"), w).open).toBe(false); // Sunday
  });
});

describe("text helpers", () => {
  it("splits streamed text into speakable sentences", () => {
    const s = new SentenceSplitter();
    expect(s.push("नमस्ते! मैं अनन्या ")).toEqual([]);
    expect(s.push("बोल रही हूँ। आप कैसे हैं?")).toEqual(["नमस्ते! मैं अनन्या बोल रही हूँ।"]);
    expect(s.flush()).toBe("आप कैसे हैं?");
  });
  it("chunks long documents with overlap", () => {
    const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} about clinic timings and fees.`).join(" ");
    const chunks = chunkText(text, 400, 80);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length <= 600)).toBe(true);
  });
  it("fills templates and drops unknown variables cleanly", () => {
    expect(fillTemplate("Hi {{first_name}}, this is {{agent_name}} from {{company}}.", { first_name: "Ravi", agent_name: "Ananya", company: "City Care" })).toBe(
      "Hi Ravi, this is Ananya from City Care.",
    );
    expect(fillTemplate("Hi {{first_name}}, welcome!", {})).toBe("Hi, welcome!");
  });
  it("guesses lead column mappings", () => {
    const m = guessMapping(["Name", "Mobile No", "Email ID", "City", "Course"]);
    expect(m).toMatchObject({ Name: "full_name", "Mobile No": "phone", "Email ID": "email", City: "city", Course: "custom" });
  });
  it("formats rupees with Indian grouping", () => {
    expect(formatInr(12345670)).toBe("₹1,23,456.70");
    expect(formatInr(100000)).toBe("₹1,000");
  });
});

describe("agent prompt", () => {
  it("includes the hard conversation rules and opening line", () => {
    const cfg = parseAgentConfig({ company_name: "City Care Clinic", persona_name: "Ananya" });
    const prompt = buildSystemPrompt(cfg, { direction: "outbound", canTransfer: true, lead: { first_name: "Ravi" } });
    expect(prompt).toMatch(/transfer_to_human in the same reply/);
    expect(prompt).toMatch(/Never end the call in the middle/);
    expect(prompt).toMatch(/money in words/i);
    expect(openingLine(cfg, { direction: "inbound", canTransfer: false })).toContain("City Care Clinic");
    expect(prompt).toMatch(/feminine first-person/);
    const male = parseAgentConfig({ company_name: "Skyline", persona_name: "Rohan", voice: "aditya", use_case: "sales" });
    expect(openingLine(male, { direction: "outbound", canTransfer: false })).toContain("बोल रहा हूँ");
    expect(buildSystemPrompt(male, { direction: "outbound", canTransfer: false })).toMatch(/masculine first-person/);
  });
});

describe("crypto", () => {
  it("hashes and verifies passwords", async () => {
    const h = await hashPassword("correct horse 1");
    expect(await verifyPassword("correct horse 1", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
  it("encrypts credentials at rest", () => {
    const blob = encryptSecret("secret-token");
    expect(blob).not.toContain("secret-token");
    expect(decryptSecret(blob)).toBe("secret-token");
  });
  it("signs and expires payloads", () => {
    const t = signPayload({ a: 1 }, 60);
    expect(verifyPayload<{ a: number }>(t)?.a).toBe(1);
    const tampered = t.slice(0, -1) + (t.endsWith("A") ? "B" : "A");
    expect(verifyPayload(tampered)).toBeNull();
    expect(verifyPayload(signPayload({ a: 1 }, -1))).toBeNull();
  });
});
