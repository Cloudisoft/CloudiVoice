#!/usr/bin/env node
/**
 * Add homepage sample calls for every scenario × language that doesn't have
 * one yet, by translating an existing sample's script (English source where
 * there is one, else Hindi) into everyday spoken language. Then voice them:
 *
 *   SPEECH_API_KEY=... node scripts/translate-samples.mjs
 *   SPEECH_API_KEY=... node scripts/generate-samples.mjs --only=<printed ids>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const KEY = process.env.SPEECH_API_KEY;
if (!KEY) throw new Error("SPEECH_API_KEY is required");
const DIR = new URL("../apps/web/public/samples/", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8"));
const LANGUAGES = ["hi-IN", "en-IN", "gu-IN", "mr-IN", "pa-IN", "bn-IN", "ta-IN", "te-IN", "kn-IN", "ml-IN", "od-IN"];
const FEMALE = new Set(["Ananya", "Kavya", "Simran", "Priya", "Neha", "Sunita"]);

async function translate(input, from, to, gender) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch("https://api.sarvam.ai/translate", {
      method: "POST",
      headers: { "api-subscription-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ input, source_language_code: from, target_language_code: to, model: "mayura:v1", mode: "modern-colloquial", speaker_gender: gender }),
    });
    if (res.ok) return (await res.json()).translated_text.trim();
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error(`translate failed (${from} → ${to})`);
}

const added = [];
for (const scenario of [...new Set(manifest.samples.map((s) => s.scenario))]) {
  const source = manifest.samples.find((s) => s.scenario === scenario && s.language === "en-IN") ?? manifest.samples.find((s) => s.scenario === scenario);
  for (const language of LANGUAGES) {
    if (manifest.samples.some((s) => s.scenario === scenario && s.language === language)) continue;
    const id = `${scenario}-${language.slice(0, 2)}`;
    console.log(`▸ ${id} (from ${source.id})`);
    const segments = [];
    for (const seg of source.segments) {
      const text = await translate(seg.text, source.language, language, FEMALE.has(seg.name) ? "Female" : "Male");
      segments.push({ ...seg, text });
    }
    manifest.samples.push({ ...source, id, language, src: `/samples/${id}.mp3`, segments });
    added.push(id);
  }
}
writeFileSync(join(DIR, "manifest.json"), JSON.stringify(manifest));
console.log(`\nadded: ${added.join(",")}`);
