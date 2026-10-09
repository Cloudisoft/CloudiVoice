/**
 * Transport-agnostic real-time conversation engine.
 *
 *   caller audio ─▶ turn detection ─▶ speech-to-text ─▶ reasoning ─▶ text-to-speech ─▶ caller
 *
 * Supports barge-in (the caller can interrupt; queued audio is cleared),
 * filler-word tolerance, quiet-caller check-ins, a hard maximum duration and
 * a polite wrap-up. The same engine serves phone calls and browser demos.
 */
import { AgentBrain, type BrainEvent, type ToolHost } from "@cloudivoice/core/brain";
import { transcribe, synthesizeStream } from "@cloudivoice/core/speech";
import { resample, TurnDetector } from "@cloudivoice/core/audio";

export type ConversationStatus = "connecting" | "listening" | "processing" | "speaking" | "ended" | "error";

export interface AudioSink {
  /** Sample rate the sink expects for PCM16 frames. */
  readonly sampleRate: number;
  play(pcm: Int16Array): void;
  /** Drop any audio queued but not yet heard (barge-in). */
  clear(): void;
  /** Resolves when everything queued so far has been heard. */
  drained(): Promise<void>;
}

export interface ConversationHooks {
  onStatus?(status: ConversationStatus): void;
  onTranscript?(line: { speaker: "agent" | "caller"; text: string; atMs: number; language?: string | null; final: boolean }): void;
  onTool?(e: { name: string; input: Record<string, unknown>; result: string; isError: boolean; atMs: number }): void;
  onEnd?(reason: EndKind): void;
  onTransfer?(): Promise<boolean>;
  onError?(err: unknown): void;
}

export type EndKind = "agent_ended" | "caller_hung_up" | "max_duration" | "silence_timeout" | "transferred" | "error";

export interface ConversationOptions {
  system: string;
  opening: string;
  language: string;
  voice: string;
  pace: number;
  tools: ToolHost;
  inputSampleRate: number;
  maxDurationSec: number;
  silenceCheckinSec: number;
  maxSilenceCheckins: number;
  sink: AudioSink;
  hooks: ConversationHooks;
}

const FILLERS = /^(h+m+|hmm+|haan+|ha+n|ji|ok(ay)?|uh+ ?huh|yeah|yes|accha|achha|theek hai|हाँ|हां|जी|अच्छा|ओके|हम्म)[.!?। ]*$/i;
const CHECKINS: Record<string, string[]> = {
  "hi-IN": ["क्या आप अभी भी line पर हैं?", "लगता है आवाज़ नहीं आ रही। हम थोड़ी देर बाद फिर कोशिश करेंगे। धन्यवाद!"],
  "en-IN": ["Are you still there?", "It seems we got disconnected. We'll try again later. Thank you!"],
};
const MAX_DURATION_LINE: Record<string, string> = {
  "hi-IN": "हमारा समय लगभग पूरा हो गया है। आपके समय के लिए बहुत धन्यवाद, आपका दिन शुभ हो!",
  "en-IN": "We're almost out of time for this call. Thank you so much for your time — have a great day!",
};

export class Conversation {
  private readonly brain: AgentBrain;
  private readonly vad: TurnDetector;
  private status: ConversationStatus = "connecting";
  private readonly startedAt = Date.now();
  private turnAbort: AbortController | null = null;
  private speakingText = "";
  private agentSpeaking = false;
  private silenceTimer: NodeJS.Timeout | null = null;
  private maxTimer: NodeJS.Timeout | null = null;
  private checkins = 0;
  private ended = false;
  private turnQueue: Promise<void> = Promise.resolve();
  private lastLanguage: string;
  private muted = false;

  constructor(private readonly o: ConversationOptions) {
    this.brain = new AgentBrain(o.system, o.tools);
    this.vad = new TurnDetector({ sampleRate: o.inputSampleRate, endSilenceMs: 700, minSpeechMs: 240 });
    this.lastLanguage = o.language;
  }

  get elapsedMs() {
    return Date.now() - this.startedAt;
  }

  get isEnded() {
    return this.ended;
  }

  private setStatus(s: ConversationStatus) {
    if (this.status === s || this.status === "ended") return;
    this.status = s;
    this.o.hooks.onStatus?.(s);
  }

  async start() {
    this.maxTimer = setTimeout(() => void this.wrapUp("max_duration"), Math.max(30, this.o.maxDurationSec - 10) * 1000);
    this.brain.primeOpening(this.o.opening);
    await this.speak([this.o.opening], undefined);
    this.afterAgentTurn();
  }

  /** Feed caller audio (PCM16 at inputSampleRate). */
  pushAudio(pcm: Int16Array) {
    if (this.ended || this.muted) return;
    for (const ev of this.vad.push(pcm)) {
      if (ev.type === "speech_start") {
        this.clearSilenceTimer();
        // Barge-in: caller started talking over the agent.
        if (this.agentSpeaking) this.interrupt();
      } else if (ev.type === "utterance") {
        const pcm16 = ev.pcm;
        this.turnQueue = this.turnQueue.then(() => this.handleUtterance(pcm16)).catch((e) => this.fail(e));
      }
    }
  }

  private interrupt() {
    this.o.sink.clear();
    this.agentSpeaking = false;
    this.turnAbort?.abort();
    this.brain.noteInterrupted(this.speakingText);
    this.speakingText = "";
    this.setStatus("listening");
  }

  private async handleUtterance(pcm: Int16Array) {
    if (this.ended) return;
    this.setStatus("processing");
    const atMs = this.elapsedMs;
    // Speech engine works best at 16 kHz; phone audio is upsampled.
    const rate = this.o.inputSampleRate < 16000 ? 16000 : this.o.inputSampleRate;
    const audio = rate === this.o.inputSampleRate ? pcm : resample(pcm, this.o.inputSampleRate, rate);
    let text = "";
    try {
      const t = await transcribe(audio, rate);
      text = t.text;
      if (t.language) this.lastLanguage = t.language === "en-IN" || t.language === "hi-IN" ? t.language : this.lastLanguage;
    } catch (e) {
      this.o.hooks.onError?.(e);
      this.setStatus("listening");
      this.armSilenceTimer();
      return;
    }
    if (!text) {
      this.setStatus("listening");
      this.armSilenceTimer();
      return;
    }
    this.checkins = 0;
    this.o.hooks.onTranscript?.({ speaker: "caller", text, atMs, language: this.lastLanguage, final: true });
    // Background noise and fillers must not trigger a new answer while the agent is mid-reply.
    if (FILLERS.test(text.trim()) && this.agentSpeaking) return;

    this.turnAbort = new AbortController();
    const signal = this.turnAbort.signal;
    const sentences: string[] = [];
    let control: "end_call" | "transfer" | null = null;
    try {
      const events = this.brain.respond(text, signal);
      await this.speak(sentences, signal, events, (c) => (control = c));
    } catch (e) {
      if (signal.aborted) return;
      this.o.hooks.onError?.(e);
      await this.speak([this.lastLanguage === "hi-IN" ? "माफ़ कीजिए, एक पल।" : "Sorry, give me just a moment."], undefined);
    }
    if (signal.aborted) return;
    if (control === "end_call") return void this.finish("agent_ended");
    if (control === "transfer") {
      const ok = (await this.o.hooks.onTransfer?.()) ?? false;
      if (ok) return void this.finish("transferred");
      await this.speak(
        [this.lastLanguage === "hi-IN" ? "माफ़ कीजिए, अभी कोई उपलब्ध नहीं है। क्या मैं आपके लिए callback schedule कर दूँ?" : "I'm sorry, nobody is available right now. Shall I schedule a callback for you?"],
        undefined,
      );
    }
    this.afterAgentTurn();
  }

  /**
   * Speak either fixed sentences or sentences streamed from the reasoning
   * engine. Synthesis of sentence N+1 overlaps playback of sentence N.
   */
  private async speak(
    fixed: string[],
    signal: AbortSignal | undefined,
    events?: AsyncGenerator<BrainEvent>,
    onControl?: (c: "end_call" | "transfer") => void,
  ) {
    const queue: string[] = [...fixed];
    let producerDone = !events;
    let wake: (() => void) | null = null;
    const notify = () => {
      wake?.();
      wake = null;
    };

    const producer = (async () => {
      if (!events) return;
      for await (const ev of events) {
        if (signal?.aborted) break;
        if (ev.type === "sentence") {
          queue.push(ev.text);
          notify();
        } else if (ev.type === "tool") {
          this.o.hooks.onTool?.({ ...ev, atMs: this.elapsedMs });
        } else if (ev.type === "control") {
          onControl?.(ev.action);
        }
      }
      producerDone = true;
      notify();
    })();

    let spoken = "";
    for (;;) {
      if (signal?.aborted || this.ended) break;
      const next = queue.shift();
      if (next === undefined) {
        if (producerDone) break;
        await new Promise<void>((r) => (wake = r));
        continue;
      }
      const atMs = this.elapsedMs;
      this.setStatus("speaking");
      this.agentSpeaking = true;
      this.speakingText = spoken ? `${spoken} ${next}` : next;
      try {
        for await (const chunk of synthesizeStream(next, {
          language: this.lastLanguage,
          voice: this.o.voice,
          pace: this.o.pace,
          sampleRate: this.o.sink.sampleRate as 8000 | 16000,
          signal,
        })) {
          if (signal?.aborted || this.ended) break;
          this.o.sink.play(chunk);
        }
      } catch (e) {
        if (!signal?.aborted) this.o.hooks.onError?.(e);
        break;
      }
      if (signal?.aborted) break;
      spoken = this.speakingText;
      this.o.hooks.onTranscript?.({ speaker: "agent", text: next, atMs, language: this.lastLanguage, final: true });
    }
    await producer.catch((e) => {
      if (!signal?.aborted) throw e;
    });
    if (!signal?.aborted && !this.ended) {
      await this.o.sink.drained();
      this.agentSpeaking = false;
      this.speakingText = "";
    }
  }

  private afterAgentTurn() {
    if (this.ended) return;
    this.setStatus("listening");
    this.armSilenceTimer();
  }

  private armSilenceTimer() {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => void this.onSilence(), this.o.silenceCheckinSec * 1000);
  }

  private clearSilenceTimer() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  private async onSilence() {
    if (this.ended || this.agentSpeaking || this.status === "processing") return;
    const lines = CHECKINS[this.lastLanguage] ?? CHECKINS["en-IN"]!;
    this.checkins++;
    if (this.checkins > this.o.maxSilenceCheckins) {
      await this.speak([lines[1]!], undefined);
      return void this.finish("silence_timeout");
    }
    await this.speak([lines[0]!], undefined);
    this.afterAgentTurn();
  }

  private async wrapUp(kind: EndKind) {
    if (this.ended) return;
    this.turnAbort?.abort();
    this.o.sink.clear();
    await this.speak([MAX_DURATION_LINE[this.lastLanguage] ?? MAX_DURATION_LINE["en-IN"]!], undefined);
    this.finish(kind);
  }

  /** Speak a final message that cannot be interrupted (e.g. voicemail), then end. */
  async sayAndEnd(text: string, kind: EndKind) {
    if (this.ended) return;
    this.turnAbort?.abort();
    this.o.sink.clear();
    this.clearSilenceTimer();
    this.vad.reset();
    this.muted = true; // ignore the line while the message plays
    await this.speak([text], undefined);
    this.finish(kind);
  }

  private fail(e: unknown) {
    this.o.hooks.onError?.(e);
    this.setStatus("error");
    this.finish("error");
  }

  /** End from our side (or after the remote side hung up). */
  finish(kind: EndKind) {
    if (this.ended) return;
    this.ended = true;
    this.clearSilenceTimer();
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.turnAbort?.abort();
    this.status = "ended";
    this.o.hooks.onStatus?.("ended");
    this.o.hooks.onEnd?.(kind);
  }
}
