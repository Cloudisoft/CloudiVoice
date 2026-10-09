/**
 * Small, dependency-free audio helpers for the real-time call path:
 * G.711 mu-law codec, linear resampling, WAV framing and an energy-based
 * voice activity detector tuned for phone audio.
 */

// ---------------------------------------------------------------------------
// G.711 mu-law
// ---------------------------------------------------------------------------
const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

export function mulawDecodeSample(u: number): number {
  u = ~u & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;
  return sign ? -sample : sample;
}

export function mulawEncodeSample(sample: number): number {
  let s = Math.max(-32768, Math.min(32767, Math.round(sample)));
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  if (s > MULAW_CLIP) s = MULAW_CLIP;
  s += MULAW_BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

const DECODE_TABLE = new Int16Array(256).map((_, i) => mulawDecodeSample(i));

export function mulawToPcm16(buf: Uint8Array): Int16Array {
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = DECODE_TABLE[buf[i]!]!;
  return out;
}

export function pcm16ToMulaw(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = mulawEncodeSample(pcm[i]!);
  return out;
}

// ---------------------------------------------------------------------------
// PCM helpers
// ---------------------------------------------------------------------------
export function bytesToPcm16(bytes: Uint8Array): Int16Array {
  const copy = new Uint8Array(bytes.length - (bytes.length % 2));
  copy.set(bytes.subarray(0, copy.length));
  return new Int16Array(copy.buffer, copy.byteOffset, copy.length / 2);
}

export function pcm16ToBytes(pcm: Int16Array): Uint8Array {
  return new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
}

/** Linear-interpolation resampler; adequate for speech between 8–48 kHz. */
export function resample(pcm: Int16Array, from: number, to: number): Int16Array {
  if (from === to || pcm.length === 0) return pcm;
  const ratio = from / to;
  const outLen = Math.max(1, Math.floor(pcm.length / ratio));
  const out = new Int16Array(outLen);
  // Simple low-pass when downsampling to reduce aliasing.
  const src = from > to ? boxFilter(pcm, Math.round(ratio)) : pcm;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, src.length - 1);
    const frac = pos - i0;
    out[i] = Math.round(src[i0]! * (1 - frac) + src[i1]! * frac);
  }
  return out;
}

function boxFilter(pcm: Int16Array, width: number): Int16Array {
  if (width <= 1) return pcm;
  const out = new Int16Array(pcm.length);
  let acc = 0;
  for (let i = 0; i < pcm.length; i++) {
    acc += pcm[i]!;
    if (i >= width) acc -= pcm[i - width]!;
    out[i] = Math.round(acc / Math.min(i + 1, width));
  }
  return out;
}

export function rms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i]! * pcm[i]!;
  return Math.sqrt(sum / pcm.length);
}

export function concatPcm(chunks: Int16Array[]): Int16Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Int16Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Wrap mono PCM16 in a WAV container (for STT uploads). */
export function pcm16ToWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const dataLen = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + dataLen, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, dataLen, true);
  new Int16Array(buf, 44).set(pcm);
  return new Uint8Array(buf);
}

/** Extract mono PCM16 + sample rate from a WAV byte buffer. */
export function wavToPcm16(bytes: Uint8Array): { pcm: Int16Array; sampleRate: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let sampleRate = 22050;
  let channels = 1;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = v.getUint32(offset + 4, true);
    if (id === "fmt ") {
      channels = v.getUint16(offset + 10, true);
      sampleRate = v.getUint32(offset + 12, true);
    } else if (id === "data") {
      const end = Math.min(bytes.length, offset + 8 + size);
      const pcm = bytesToPcm16(bytes.subarray(offset + 8, end));
      if (channels === 1) return { pcm, sampleRate };
      const mono = new Int16Array(Math.floor(pcm.length / channels));
      for (let i = 0; i < mono.length; i++) mono[i] = pcm[i * channels]!;
      return { pcm: mono, sampleRate };
    }
    offset += 8 + size + (size % 2);
  }
  // Headerless / streamed: treat whole thing as PCM after a 44-byte header.
  return { pcm: bytesToPcm16(bytes.subarray(44)), sampleRate };
}

// ---------------------------------------------------------------------------
// Voice activity / turn detection
// ---------------------------------------------------------------------------
export interface VadOptions {
  sampleRate: number;
  /** Silence after speech that ends a turn. */
  endSilenceMs?: number;
  /** Minimum speech to count as an utterance (filters clicks, "hmm"). */
  minSpeechMs?: number;
  /** Maximum utterance length before it is force-closed. */
  maxUtteranceMs?: number;
}

export type VadEvent =
  | { type: "speech_start" }
  | { type: "utterance"; pcm: Int16Array; durationMs: number }
  | { type: "noise" };

/**
 * Adaptive energy VAD. Tracks the line's noise floor so background hum,
 * TV noise and fan noise do not trigger turns, and requires a minimum
 * amount of speech before anything is sent to transcription.
 */
export class TurnDetector {
  private floor = 300;
  private speaking = false;
  private speechMs = 0;
  private silenceMs = 0;
  private buffer: Int16Array[] = [];
  private preroll: Int16Array[] = [];
  private readonly endSilenceMs: number;
  private readonly minSpeechMs: number;
  private readonly maxUtteranceMs: number;

  constructor(private readonly opts: VadOptions) {
    this.endSilenceMs = opts.endSilenceMs ?? 650;
    this.minSpeechMs = opts.minSpeechMs ?? 220;
    this.maxUtteranceMs = opts.maxUtteranceMs ?? 15000;
  }

  get isSpeaking() {
    return this.speaking && this.speechMs >= this.minSpeechMs;
  }

  push(frame: Int16Array): VadEvent[] {
    const events: VadEvent[] = [];
    const ms = (frame.length / this.opts.sampleRate) * 1000;
    const level = rms(frame);
    const threshold = Math.max(600, this.floor * 2.8);
    const voiced = level > threshold;

    if (!this.speaking) {
      // Update noise floor only while not speaking.
      this.floor = this.floor * 0.97 + Math.min(level, 4000) * 0.03;
      this.preroll.push(frame);
      if (this.preroll.length > 15) this.preroll.shift();
      if (voiced) {
        this.speaking = true;
        this.speechMs = ms;
        this.silenceMs = 0;
        this.buffer = [...this.preroll];
      }
      return events;
    }

    this.buffer.push(frame);
    if (voiced) {
      const wasConfirmed = this.speechMs >= this.minSpeechMs;
      this.speechMs += ms;
      this.silenceMs = 0;
      if (!wasConfirmed && this.speechMs >= this.minSpeechMs) events.push({ type: "speech_start" });
    } else {
      this.silenceMs += ms;
    }

    const total = this.buffer.length * ms;
    if (this.silenceMs >= this.endSilenceMs || total >= this.maxUtteranceMs) {
      if (this.speechMs >= this.minSpeechMs) {
        events.push({ type: "utterance", pcm: concatPcm(this.buffer), durationMs: total });
      } else {
        events.push({ type: "noise" });
      }
      this.reset();
    }
    return events;
  }

  reset() {
    this.speaking = false;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.buffer = [];
    this.preroll = [];
  }
}
