#!/usr/bin/env node
/**
 * Re-voice the homepage sample calls with the speech engine's conversational
 * personas. Keeps each sample's script, rebuilds audio, timings and waveform
 * peaks in apps/web/public/samples/manifest.json.
 *
 *   SPEECH_API_KEY=... node scripts/generate-samples.mjs [--only=id,id]
 *
 * Also writes one <id>.json per sample so the homepage can load a single
 * sample's transcript and waveform instead of the whole manifest.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEY = process.env.SPEECH_API_KEY;
if (!KEY) throw new Error("SPEECH_API_KEY is required");
const RATE = 24000;
const DIR = new URL("../apps/web/public/samples/", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8"));

// Voice per speaker name and language (genders match the scripts' grammar).
const PERSONA = {
  "hi-IN": {
    Ananya: "ritu_hi_customer_warm", Rohan: "aditya_hi_conversational", Kavya: "kavya_hi_conversational", Dev: "kabir_hi_conversational", Simran: "simran_hi_conversation",
    Rahul: "rahul_hi_conversational", Neha: "shreya_hi_conversational", Amit: "amit_hi_conversational", Sunita: "roopa_hi_conversational",
  },
  "en-IN": {
    Ananya: "ishita_en_customer", Rohan: "dev_en_conversational", Simran: "simran_en_conversation",
    Priya: "roopa_en_conversational", Arjun: "deven_en_conversation", Vikram: "deven_en_conversation",
    Kavya: "neha_en_customer", Amit: "dev_en_conversational", Dev: "deven_en_conversation", Sunita: "ishita_en_customer",
  },
};
PERSONA["hi-IN"].Vikram = "manan_hi_conversational";

const FEMALE = new Set(["Ananya", "Kavya", "Simran", "Priya", "Neha", "Sunita"]);
// Native conversational voices for regional languages; others use the all-language model.
const REGIONAL = {
  "gu-IN": { f: "pooja_gu_conversational", m: "bhavik_gu_conversation" },
  "mr-IN": { f: "ishita_mr_conversational", m: "nilesh_mr_conversation" },
  "pa-IN": { m: "anand_pa_conversation" },
  "bn-IN": { f: "roopa_bn_conversational", m: "arnab_bn_conversation" },
  "te-IN": { f: "kavitha_te_conversation" },
  "kn-IN": { f: "chaitra_kn_conversation", m: "chetan_kn_conversation" },
};

function voiceFor(lang, name) {
  const persona = PERSONA[lang]?.[name];
  if (persona) return { model: "bulbul:v4-flash", speaker: persona };
  const g = FEMALE.has(name) ? "f" : "m";
  const regional = REGIONAL[lang]?.[g];
  if (regional) return { model: "bulbul:v4-flash", speaker: regional };
  return { model: "bulbul:v3", speaker: g === "f" ? "priya" : "aditya" };
}

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");

async function tts(text, language, { model, speaker }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: { "api-subscription-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ text, target_language_code: language, model, speaker, pace: 1.0, speech_sample_rate: RATE }),
    });
    if (res.ok) {
      const wav = Buffer.from((await res.json()).audios[0], "base64");
      // Find the "data" chunk and return PCM16 samples.
      let o = 12;
      while (o < wav.length - 8) {
        const id = wav.toString("ascii", o, o + 4), size = wav.readUInt32LE(o + 4);
        if (id === "data") return new Int16Array(wav.buffer.slice(wav.byteOffset + o + 8, wav.byteOffset + o + 8 + size));
        o += 8 + size;
      }
      throw new Error("no audio data");
    }
    console.warn(`  retry (${res.status}) ${await res.text().catch(() => "")}`.slice(0, 200));
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error(`TTS failed for ${speaker}`);
}

/** Trim leading/trailing near-silence so turn gaps are controlled by us. */
function trim(pcm) {
  let a = 0, b = pcm.length - 1;
  while (a < b && Math.abs(pcm[a]) < 300) a++;
  while (b > a && Math.abs(pcm[b]) < 300) b--;
  return pcm.subarray(Math.max(0, a - RATE * 0.03), Math.min(pcm.length, b + RATE * 0.08));
}

const ms = (n) => Math.round((n / RATE) * 1000);

for (const s of manifest.samples) {
  if (only && !only.includes(s.id)) continue;
  console.log(`▸ ${s.id}`);
  const lang = s.language;
  const parts = [];
  for (const seg of s.segments) {
    const name = seg.speaker === "agent" ? s.agentName : s.callerName;
    const speaker = voiceFor(lang, name);
    parts.push({ seg, pcm: trim(await tts(seg.text, lang, speaker)) });
  }
  // Natural turn-taking: short gaps, a little longer after questions.
  let cursor = Math.round(RATE * 0.35);
  const placed = parts.map(({ seg, pcm }, i) => {
    if (i > 0) {
      const prev = parts[i - 1].seg.text.trim();
      const gap = /[?？]$/.test(prev) ? 0.55 : prev.length > 60 ? 0.45 : 0.38;
      cursor += Math.round(RATE * (gap + ((i * 37) % 7) * 0.02));
    }
    const start = cursor;
    cursor += pcm.length;
    return { seg, pcm, start, end: cursor };
  });
  const total = cursor + Math.round(RATE * 0.6);
  const mix = new Int16Array(total);
  const tracks = { agent: new Float32Array(total), caller: new Float32Array(total) };
  for (const p of placed) {
    mix.set(p.pcm, p.start);
    for (let i = 0; i < p.pcm.length; i++) tracks[p.seg.speaker][p.start + i] = Math.abs(p.pcm[i]) / 32768;
  }

  // Remap tool events to the same moment relative to their segment.
  const events = (s.events ?? []).map((e) => {
    let i = s.segments.findLastIndex((g) => g.startMs <= e.atMs);
    if (i < 0) i = 0;
    const old = s.segments[i], now = placed[i];
    const into = Math.max(0, e.atMs - old.endMs);
    const nextStart = placed[i + 1] ? ms(placed[i + 1].start) - 80 : ms(total);
    return { ...e, atMs: Math.min(ms(now.end) + into, nextStart) };
  });

  // Waveform peaks: 24 points per second, normalised per sample.
  const win = RATE / 24, n = Math.ceil(total / win);
  const raw = { agent: [], caller: [] };
  for (const k of ["agent", "caller"]) for (let j = 0; j < n; j++) { let m = 0; for (let i = j * win; i < Math.min(total, (j + 1) * win); i++) m = Math.max(m, tracks[k][i]); raw[k].push(m); }
  const top = Math.max(...raw.agent, ...raw.caller) || 1;
  const peaks = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.map((x) => Math.max(0.003, Math.round((x / top) * 1000) / 1000))]));

  // Encode MP3.
  const tmp = mkdtempSync(join(tmpdir(), "cv-sample-"));
  const raw16 = join(tmp, "a.pcm");
  writeFileSync(raw16, Buffer.from(mix.buffer));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "s16le", "-ar", String(RATE), "-ac", "1", "-i", raw16, "-af", "loudnorm=I=-18:TP=-1.5:LRA=11", "-ar", String(RATE), "-codec:a", "libmp3lame", "-b:a", process.env.SAMPLE_BITRATE ?? "48k", join(DIR, `${s.id}.mp3`)]);

  s.segments = placed.map((p) => ({ ...p.seg, startMs: ms(p.start), endMs: ms(p.end) }));
  s.events = events;
  s.durationMs = ms(total);
  s.peaks = peaks;
  writeFileSync(join(DIR, `${s.id}.json`), JSON.stringify(s));
  console.log(`  ${(s.durationMs / 1000).toFixed(1)}s, ${s.segments.length} turns`);
}
writeFileSync(join(DIR, "manifest.json"), JSON.stringify(manifest));
console.log("manifest updated");
