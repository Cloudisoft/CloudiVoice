/**
 * Low-latency speech engine clients: one warm WebSocket per conversation for
 * speech-to-text (audio is streamed while the caller is still talking) and one
 * for text-to-speech (first audio in ~0.4 s). Both fall back to the REST
 * endpoints automatically if a socket is unavailable.
 */
import WebSocket from "ws";
import { pcm16ToBytes, bytesToPcm16, resample } from "@cloudivoice/core/audio";
import { env } from "@cloudivoice/core/env";
import { synthesizeStream, transcribe, type Transcript } from "@cloudivoice/core/speech";
import { log } from "./log";

const WS_BASE = () => env.speechApiBase.replace(/^http/, "ws");

export interface Transcriber {
  /** A new utterance begins; `preroll` is audio captured just before speech was confirmed. */
  begin(preroll: Int16Array[]): void;
  push(pcm: Int16Array): void;
  /** The utterance ended; resolves with its transcript. `pcm` is the whole utterance for fallback. */
  end(pcm: Int16Array): Promise<Transcript>;
  /** The utterance was noise; discard it. */
  cancel(): void;
  close(): void;
}

export interface Synthesizer {
  speak(text: string, opts: { language: string; voice: string; pace: number; signal?: AbortSignal }): AsyncGenerator<Int16Array>;
  close(): void;
}

// ---------------------------------------------------------------------------
// Speech-to-text
// ---------------------------------------------------------------------------
export class StreamingTranscriber implements Transcriber {
  private ws: WebSocket | null = null;
  private ready = false;
  private closed = false;
  private pending: { resolve: (t: Transcript | null) => void; discard: boolean }[] = [];
  private inUtterance = false;
  private ping: NodeJS.Timeout;
  private failures = 0;

  constructor(private readonly sampleRate: 8000 | 16000) {
    this.connect();
    this.ping = setInterval(() => this.send({ event: "ping" }), 20_000);
  }

  private connect() {
    if (this.closed || !env.speechApiKey) return;
    const qs = new URLSearchParams({
      language_code: "auto",
      stream_type: "fast",
      endpointing: "manual",
      encoding: "linear16",
      sample_rate: String(this.sampleRate),
      mode: "transcribe",
    });
    const ws = new WebSocket(`${WS_BASE()}/speech-to-text-realtime/ws?${qs}`, { headers: { "api-subscription-key": env.speechApiKey } });
    this.ws = ws;
    ws.on("open", () => {
      this.ready = true;
      this.failures = 0;
    });
    ws.on("message", (raw) => {
      let e: { event?: string; text?: string; language?: string; message?: string; is_fatal?: boolean };
      try {
        e = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (e.event === "transcript.final") {
        const p = this.pending.shift();
        p?.resolve(p.discard ? null : { text: (e.text ?? "").trim(), language: e.language ?? null });
      } else if (e.event === "error") {
        log.warn("realtime stt error", { message: e.message, fatal: e.is_fatal });
      }
    });
    const down = () => {
      this.ready = false;
      // Anything waiting on this socket falls back to REST.
      for (const p of this.pending.splice(0)) p.resolve(null);
      if (!this.closed && this.failures++ < 5) setTimeout(() => this.connect(), 500 * this.failures);
    };
    ws.on("close", down);
    ws.on("error", (err) => log.warn("realtime stt socket error", { err: String(err) }));
  }

  private send(m: Record<string, unknown>) {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(m));
      return true;
    }
    return false;
  }

  private sendAudio(pcm: Int16Array) {
    this.send({ event: "audio_input", audio: Buffer.from(pcm16ToBytes(pcm)).toString("base64") });
  }

  begin(preroll: Int16Array[]) {
    if (!this.send({ event: "speech_start" })) return;
    this.inUtterance = true;
    for (const p of preroll) this.sendAudio(p);
  }

  push(pcm: Int16Array) {
    if (this.inUtterance) this.sendAudio(pcm);
  }

  async end(pcm: Int16Array): Promise<Transcript> {
    if (this.inUtterance && this.send({ event: "speech_end" })) {
      this.inUtterance = false;
      const result = await new Promise<Transcript | null>((resolve) => {
        const entry = { resolve, discard: false };
        this.pending.push(entry);
        setTimeout(() => {
          entry.discard = true;
          resolve(null);
        }, 4000);
      });
      if (result) return result;
    }
    this.inUtterance = false;
    // Fallback: one-shot REST transcription of the whole utterance.
    const rate = this.sampleRate < 16000 ? 16000 : this.sampleRate;
    return transcribe(rate === this.sampleRate ? pcm : resample(pcm, this.sampleRate, rate), rate);
  }

  cancel() {
    if (this.inUtterance && this.send({ event: "speech_end" })) this.pending.push({ resolve: () => {}, discard: true });
    this.inUtterance = false;
  }

  close() {
    this.closed = true;
    clearInterval(this.ping);
    try {
      this.send({ event: "end" });
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Text-to-speech
// ---------------------------------------------------------------------------
export class StreamingSynthesizer implements Synthesizer {
  private ws: WebSocket | null = null;
  private ready: Promise<boolean> = Promise.resolve(false);
  private closed = false;
  private config = "";
  private queue: Promise<void> = Promise.resolve();
  private sink: ((m: { audio?: Int16Array; done?: boolean }) => void) | null = null;
  private ping: NodeJS.Timeout;

  constructor(private readonly sampleRate: 8000 | 16000) {
    this.connect();
    this.ping = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "ping" }));
    }, 20_000);
  }

  private connect() {
    if (this.closed || !env.speechApiKey) return;
    this.config = "";
    const ws = new WebSocket(`${WS_BASE()}/text-to-speech/ws?model=${encodeURIComponent(env.ttsModel)}&send_completion_event=true`, {
      headers: { "api-subscription-key": env.speechApiKey },
    });
    this.ws = ws;
    this.ready = new Promise((resolve) => {
      ws.once("open", () => resolve(true));
      ws.once("error", () => resolve(false));
      ws.once("close", () => resolve(false));
    });
    ws.on("message", (raw) => {
      let e: { type?: string; data?: { audio?: string; event_type?: string; message?: string } };
      try {
        e = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (e.type === "audio" && e.data?.audio) this.sink?.({ audio: bytesToPcm16(new Uint8Array(Buffer.from(e.data.audio, "base64"))) });
      else if (e.type === "event" && e.data?.event_type === "final") this.sink?.({ done: true });
      else if (e.type === "error") {
        log.warn("realtime tts error", { message: e.data?.message });
        this.sink?.({ done: true });
      }
    });
    ws.on("close", () => {
      this.sink?.({ done: true });
      if (!this.closed) setTimeout(() => this.connect(), 300);
    });
    ws.on("error", (err) => log.warn("realtime tts socket error", { err: String(err) }));
  }

  async *speak(text: string, opts: { language: string; voice: string; pace: number; signal?: AbortSignal }): AsyncGenerator<Int16Array> {
    // One request at a time on the socket; an aborted request still drains before the next starts.
    let release!: () => void;
    let done = true;
    const previous = this.queue;
    this.queue = new Promise<void>((r) => (release = r));
    await previous;
    try {
      const ok = await Promise.race([this.ready, new Promise<boolean>((r) => setTimeout(() => r(false), 3000))]);
      if (!ok || this.ws?.readyState !== WebSocket.OPEN) {
        yield* synthesizeStream(text, { language: opts.language, voice: opts.voice, pace: opts.pace, sampleRate: this.sampleRate, signal: opts.signal });
        return;
      }
      const config = JSON.stringify({
        type: "config",
        data: {
          speaker: opts.voice,
          target_language_code: opts.language,
          language_code: opts.language,
          pace: opts.pace,
          min_buffer_size: 30,
          max_chunk_length: 200,
          output_audio_codec: "linear16",
          speech_sample_rate: this.sampleRate,
        },
      });
      if (config !== this.config) {
        this.ws.send(config);
        this.config = config;
      }
      const chunks: Int16Array[] = [];
      done = false;
      let wake: (() => void) | null = null;
      this.sink = (m) => {
        if (m.audio) chunks.push(m.audio);
        if (m.done) done = true;
        wake?.();
        wake = null;
      };
      this.ws.send(JSON.stringify({ type: "text", data: { text } }));
      this.ws.send(JSON.stringify({ type: "flush" }));
      const deadline = Date.now() + 15_000;
      while (!done && Date.now() < deadline) {
        if (chunks.length) {
          const c = chunks.shift()!;
          if (!opts.signal?.aborted) yield c;
          continue;
        }
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, 250);
        });
      }
      while (chunks.length && !opts.signal?.aborted) yield chunks.shift()!;
    } finally {
      if (done) {
        this.sink = null;
        release();
      } else {
        // Interrupted mid-sentence: drop the rest of this request's audio,
        // and only free the socket once the engine says it has finished.
        const timer = setTimeout(finish, 3000);
        const self = this;
        function finish() {
          clearTimeout(timer);
          self.sink = null;
          release();
        }
        this.sink = (m) => {
          if (m.done) finish();
        };
      }
    }
  }

  close() {
    this.closed = true;
    clearInterval(this.ping);
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}
