/**
 * Speech layer: speech-to-text and text-to-speech for Indian languages.
 * Kept separate from telephony and reasoning so each layer can be swapped.
 * Customer-facing code refers to this only as the "speech engine".
 */
import { env } from "./env";
import { bytesToPcm16, pcm16ToWav, wavToPcm16 } from "./audio";

export class SpeechError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

function key() {
  const k = env.speechApiKey;
  if (!k) throw new SpeechError("Speech engine is not configured");
  return k;
}

export interface Transcript {
  text: string;
  language: string | null;
}

/** Transcribe one utterance (≤ 30 s). Auto-detects Hindi/English/code-mix. */
export async function transcribe(
  pcm: Int16Array,
  sampleRate: number,
  opts: { language?: string; signal?: AbortSignal; keyterms?: string[] } = {},
): Promise<Transcript> {
  const form = new FormData();
  const wav = pcm16ToWav(pcm, sampleRate);
  form.append("file", new Blob([wav as BlobPart], { type: "audio/wav" }), "utterance.wav");
  form.append("model", env.sttModel);
  form.append("mode", env.sttMode);
  if (opts.keyterms?.length && env.sttModel.startsWith("saaras:v4")) form.append("keyterms", JSON.stringify(opts.keyterms.slice(0, 50)));
  form.append("language_code", opts.language ?? "unknown");
  const res = await fetch(`${env.speechApiBase}/speech-to-text`, {
    method: "POST",
    headers: { "api-subscription-key": key() },
    body: form,
    signal: opts.signal,
  });
  if (!res.ok) throw new SpeechError(`Transcription failed (${res.status})`, res.status);
  const data = (await res.json()) as { transcript?: string; language_code?: string | null };
  return { text: (data.transcript ?? "").trim(), language: data.language_code ?? null };
}

/**
 * Conversational personas for each voice offered in the agent builder.
 * The newer model renders phone-style speech (natural pauses, intonation,
 * Hinglish) far better than the general-purpose voices; genders match so
 * Hindi grammar stays correct. Languages without a persona fall back to the
 * previous model with the same voice.
 */
const PERSONAS: Record<string, { hi: string; en: string }> = {
  priya: { hi: "aparna_hi_customer", en: "neha_en_customer" },
  simran: { hi: "simran_hi_conversation", en: "simran_en_conversation" },
  kavya: { hi: "kavya_hi_conversational", en: "roopa_en_conversational" },
  ritu: { hi: "ritu_hi_customer_warm", en: "ishita_en_customer" },
  aditya: { hi: "aditya_hi_conversational", en: "dev_en_conversational" },
  rahul: { hi: "rahul_hi_conversational", en: "deven_en_conversation" },
  dev: { hi: "kabir_hi_conversational", en: "dev_en_conversational" },
  amit: { hi: "amit_hi_conversational", en: "deven_en_conversation" },
};
const LEGACY_MODEL = "bulbul:v3";

/** Which model + speaker to use for a voice in a language. */
export function ttsVoice(voice: string, language: string): { model: string; speaker: string } {
  const model = env.ttsModel;
  if (model === LEGACY_MODEL || model.startsWith("bulbul:v2")) return { model, speaker: voice };
  if (voice.includes("_")) return { model, speaker: voice }; // already a persona id
  const p = PERSONAS[voice];
  const tag = language === "hi-IN" ? "hi" : language === "en-IN" ? "en" : null;
  if (p && tag) return { model, speaker: p[tag] };
  return { model: LEGACY_MODEL, speaker: voice };
}

function ttsParams(opts: { language: string; voice: string }) {
  const { model, speaker } = ttsVoice(opts.voice, opts.language);
  const temperature = model === LEGACY_MODEL ? undefined : env.ttsTemperature;
  return { model, speaker, ...(temperature ? { temperature } : {}) };
}

export interface SynthesisOptions {
  language: string;
  voice: string;
  pace?: number;
  sampleRate: 8000 | 16000 | 22050 | 24000;
  signal?: AbortSignal;
}

/**
 * Stream synthesized speech as raw PCM16 chunks at `sampleRate`.
 * Uses the HTTP streaming endpoint so playback can start before synthesis
 * of the whole sentence has finished.
 */
export async function* synthesizeStream(text: string, opts: SynthesisOptions): AsyncGenerator<Int16Array> {
  const res = await fetch(`${env.speechApiBase}/text-to-speech/stream`, {
    method: "POST",
    headers: { "api-subscription-key": key(), "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      language_code: opts.language,
      ...ttsParams(opts),
      pace: opts.pace ?? 1.0,
      speech_sample_rate: opts.sampleRate,
      output_audio_codec: "linear16",
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) throw new SpeechError(`Speech synthesis failed (${res.status})`, res.status);

  const reader = res.body.getReader();
  let carry: Uint8Array = new Uint8Array(0);
  let headerChecked = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    let bytes: Uint8Array = value as Uint8Array;
    if (carry.length) {
      const merged = new Uint8Array(carry.length + bytes.length);
      merged.set(carry);
      merged.set(bytes, carry.length);
      bytes = merged;
      carry = new Uint8Array(0);
    }
    if (!headerChecked) {
      if (bytes.length < 44) {
        carry = bytes;
        continue;
      }
      headerChecked = true;
      // Some deployments wrap linear16 in a WAV header; strip it if present.
      if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) bytes = bytes.subarray(44);
    }
    if (bytes.length % 2) {
      carry = bytes.subarray(bytes.length - 1).slice();
      bytes = bytes.subarray(0, bytes.length - 1);
    }
    if (bytes.length) yield bytesToPcm16(bytes.slice());
  }
}

/** Non-streaming synthesis (voice previews, pre-generated prompts). */
export async function synthesize(text: string, opts: Omit<SynthesisOptions, "sampleRate"> & { sampleRate?: number }) {
  const res = await fetch(`${env.speechApiBase}/text-to-speech`, {
    method: "POST",
    headers: { "api-subscription-key": key(), "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      language_code: opts.language,
      ...ttsParams(opts),
      pace: opts.pace ?? 1.0,
      speech_sample_rate: opts.sampleRate ?? 22050,
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw new SpeechError(`Speech synthesis failed (${res.status})`, res.status);
  const data = (await res.json()) as { audios?: string[] };
  const b64 = data.audios?.[0];
  if (!b64) throw new SpeechError("Speech synthesis returned no audio");
  return wavToPcm16(Uint8Array.from(Buffer.from(b64, "base64")));
}

/** Lightweight credential check used by the connection-health page. */
export async function checkSpeechHealth(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { pcm } = await synthesize("नमस्ते", { language: "hi-IN", voice: "priya", sampleRate: 8000 });
    return { ok: pcm.length > 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
