/**
 * Transport-agnostic real-time conversation engine.
 *
 *   caller audio ─▶ turn detection ─▶ speech-to-text ─▶ reasoning ─▶ text-to-speech ─▶ caller
 *
 * Built to feel like talking to a person:
 *  - Early turn-taking: speech is transcribed as soon as the caller pauses
 *    (~0.2 s), and the reply starts immediately. If the caller was only
 *    pausing mid-thought and keeps talking, the half-started reply is dropped
 *    silently and both parts are answered together.
 *  - Instant acknowledgement: if the reply needs a moment, a short natural
 *    filler ("जी…", "One moment…") plays from cache with no synthesis delay.
 *  - Real interruptions: when the caller cuts in, the agent stops, listens and
 *    answers what was just said. Backchannels ("haan", "hmm", "ok") don't
 *    stop the agent.
 *  - Didn't catch it: unclear speech gets a polite request to repeat.
 *  - Quiet-caller check-ins, maximum duration, supervisor takeover (pause/resume).
 */
import { AgentBrain, type BrainEvent, type ToolHost } from "@cloudivoice/core/brain";
import { voiceGender } from "@cloudivoice/core/agentConfig";
import { concatPcm, resample, TurnDetector } from "@cloudivoice/core/audio";
import { synthesize, synthesizeStream, type Transcript } from "@cloudivoice/core/speech";
import { transcribeSegment, type Synthesizer, type Transcriber } from "./realtime";

export type ConversationStatus = "connecting" | "listening" | "processing" | "speaking" | "paused" | "ended" | "error";

export interface AudioSink {
  /** Sample rate the sink expects for PCM16 frames. */
  readonly sampleRate: number;
  play(pcm: Int16Array): void;
  /** Drop any audio queued but not yet heard (barge-in). */
  clear(): void;
  /** Resolves when everything queued so far has been heard. */
  drained(): Promise<void>;
  /** Milliseconds of queued audio not yet heard. */
  remainingMs?(): number;
}

export interface ConversationHooks {
  onStatus?(status: ConversationStatus): void;
  onTranscript?(line: { speaker: "agent" | "caller"; text: string; atMs: number; language?: string | null; final: boolean }): void;
  onTool?(e: { name: string; input: Record<string, unknown>; result: string; isError: boolean; atMs: number }): void;
  onEnd?(reason: EndKind): void;
  onTransfer?(): Promise<boolean>;
  onError?(err: unknown): void;
  /** Every PCM frame the agent sends to the caller (for supervisor listening). */
  onAgentAudio?(pcm: Int16Array): void;
  /** Caller words as they are being spoken (not final). */
  onPartial?(text: string): void;
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
  /** Streaming speech engine clients; REST is used when omitted. */
  transcriber?: Transcriber;
  synthesizer?: Synthesizer;
  /** Play short cached fillers when a reply needs a moment (default on). */
  fillers?: boolean;
}

/** Backchannels and acknowledgements: never a reason to stop talking. */
const BACKCHANNEL =
  /^(h+m+|hmm+|haan+|ha+n|ji|ji haan|ok(ay)?|uh+ ?huh|yeah|yes|yep|right|accha|achha|acha|theek( hai)?|ठीक( है)?|हाँ+|हां+|हाँ जी|जी( हाँ)?|अच्छा|ओके|हम्म+|हूँ|उम्म)[.!?।, ]*$/i;
/** A partial transcript ending like this means the caller isn't finished. */
const TRAILING = /(\b(and|but|so|because|or|that|the|to|like|um+|uh+)|और|लेकिन|पर|तो|क्योंकि|कि|या|मतलब|वो|जो|के|की|का|में)[,]?\s*$/i;
/** The caller is clearly saying goodbye. */
const GOODBYE = /(\b(bye|goodbye|bye bye|good night)\b|बाय|अलविदा|टाटा|गुड बाय|रखता हूँ|रखती हूँ|फ़ोन रखत|फोन रखत)/i;
const ACK_PREFIX = /^(जी हाँ|जी|हाँ जी|अच्छा|ठीक है|okay|ok|sure|alright|right|got it)[,!।.]\s+/i;

const EARLY_FINALIZE_MS = 220; // pause that triggers an early transcript
const HESITANT_FINALIZE_MS = 700; // ... when the caller sounded unfinished
const FILLER_AFTER_MS = 380; // play a filler if the reply isn't audible by then
const BARGE_VOICED_MS = 650; // sustained speech that interrupts regardless of words
const REASK_MIN_VOICED_MS = 550; // only re-ask for real speech we couldn't read

const FILLERS: Record<string, string[]> = {
  "hi-IN": ["जी।", "अच्छा।", "हम्म।", "जी, एक सेकंड।"],
  "en-IN": ["Sure.", "Okay.", "Mm-hmm.", "Right, one moment."],
};
const CHECKINS: Record<string, string[]> = {
  "hi-IN": ["क्या आप अभी भी line पर हैं?", "लगता है आवाज़ नहीं आ रही। हम थोड़ी देर बाद फिर कोशिश करेंगे। धन्यवाद!"],
  "en-IN": ["Are you still there?", "It seems we got disconnected. We'll try again later. Thank you!"],
};
const MAX_DURATION_LINE: Record<string, string> = {
  "hi-IN": "हमारा समय लगभग पूरा हो गया है। आपके समय के लिए बहुत धन्यवाद, आपका दिन शुभ हो!",
  "en-IN": "We're almost out of time for this call. Thank you so much for your time — have a great day!",
};
function reaskLines(lang: string, male: boolean): string[] {
  if (lang === "hi-IN") {
    const paa = male ? "पाया" : "पाई";
    return [
      `माफ़ कीजिए, मैं ठीक से सुन नहीं ${paa}। क्या आप दोबारा बता सकते हैं?`,
      "सॉरी, आवाज़ थोड़ी कट गई। एक बार फिर बोलेंगे?",
      "लगता है line थोड़ी साफ़ नहीं है। क्या आप थोड़ा धीरे और ज़ोर से बोल सकते हैं?",
    ];
  }
  return [
    "Sorry, I didn't quite catch that. Could you say it again?",
    "Apologies, the line broke up a little. Could you repeat that?",
    "The line seems a bit unclear — could you speak a little slower and louder?",
  ];
}

// Fillers are synthesized once per voice and reused across calls.
const fillerCache = new Map<string, Promise<Int16Array[]>>();
function loadFillers(lang: string, voice: string, pace: number, rate: number) {
  const key = `${lang}|${voice}|${pace}|${rate}`;
  let p = fillerCache.get(key);
  if (!p) {
    p = Promise.all(
      (FILLERS[lang] ?? FILLERS["en-IN"]!).map(async (text) => {
        const r = await synthesize(text, { language: lang, voice, pace, sampleRate: rate });
        return trimSilence(r.sampleRate === rate ? r.pcm : resample(r.pcm, r.sampleRate, rate));
      }),
    ).catch(() => {
      fillerCache.delete(key);
      return [];
    });
    fillerCache.set(key, p);
  }
  return p;
}
function trimSilence(pcm: Int16Array): Int16Array {
  let a = 0;
  let b = pcm.length - 1;
  while (a < b && Math.abs(pcm[a]!) < 400) a++;
  while (b > a && Math.abs(pcm[b]!) < 400) b--;
  const out = pcm.slice(Math.max(0, a - 80), Math.min(pcm.length, b + 400));
  // Short fades so cached clips never click on a phone line.
  const fade = Math.min(80, out.length >> 2);
  for (let i = 0; i < fade; i++) {
    out[i] = Math.round((out[i]! * i) / fade);
    out[out.length - 1 - i] = Math.round((out[out.length - 1 - i]! * i) / fade);
  }
  return out;
}

interface Turn {
  abort: AbortController;
  realAudio: boolean;
  fillerPlayed: boolean;
  fillerTimer: NodeJS.Timeout | null;
}

export class Conversation {
  private readonly brain: AgentBrain;
  private readonly vad: TurnDetector;
  private status: ConversationStatus = "connecting";
  private readonly startedAt = Date.now();
  private readonly male: boolean;
  private turn: Turn | null = null;
  private speakingText = "";
  private replySpeaking = false;
  private silenceTimer: NodeJS.Timeout | null = null;
  private maxTimer: NodeJS.Timeout | null = null;
  private checkins = 0;
  private reasks = 0;
  private ended = false;
  private paused = false;
  private muted = false;
  private lastLanguage: string;
  private fillerIdx = 0;
  // Current speech segment
  private segActive = false;
  private segFrames: Int16Array[] = [];
  private segVoicedMs = 0;
  private segStartMs = 0;
  private segHesitant = false;
  private textChain: Promise<void> = Promise.resolve();
  private bargeAt: number | null = null;
  private turnStartedAt = 0;
  private lastPartial = "";

  constructor(private readonly o: ConversationOptions) {
    this.brain = new AgentBrain(o.system, o.tools);
    this.vad = new TurnDetector({ sampleRate: o.inputSampleRate, endSilenceMs: 550, minSpeechMs: 200 });
    this.lastLanguage = o.language;
    this.male = voiceGender(o.voice) === "male";
    if (o.transcriber) {
      o.transcriber.onPartial = (text) => this.onPartial(text);
    }
  }

  /** Per-stage latency, logged when DEBUG_LATENCY=1. */
  private mark(stage: string, ms: number) {
    if (process.env.DEBUG_LATENCY === "1") console.log(`[latency] ${stage} ${ms}ms`);
  }

  get elapsedMs() {
    return Date.now() - this.startedAt;
  }

  get isEnded() {
    return this.ended;
  }

  get isPaused() {
    return this.paused;
  }

  private setStatus(s: ConversationStatus) {
    if (this.status === s || this.status === "ended") return;
    this.status = s;
    this.o.hooks.onStatus?.(s);
  }

  async start() {
    this.maxTimer = setTimeout(() => void this.wrapUp("max_duration"), Math.max(30, this.o.maxDurationSec - 10) * 1000);
    if (this.o.fillers !== false) void loadFillers(this.o.language, this.o.voice, this.o.pace, this.o.sink.sampleRate);
    this.brain.primeOpening(this.o.opening);
    await this.say([this.o.opening]);
    this.afterAgentTurn();
  }

  // -------------------------------------------------------------------------
  // Listening
  // -------------------------------------------------------------------------

  /** Feed caller audio (PCM16 at inputSampleRate). */
  pushAudio(pcm: Int16Array) {
    if (this.ended || this.muted) return;
    for (const ev of this.vad.push(pcm)) {
      switch (ev.type) {
        case "begin":
          this.openSegment(ev.preroll);
          break;
        case "audio":
          if (ev.voiced && !this.segActive) {
            // The caller kept talking after a short pause: new segment, and
            // whatever reply was being prepared is no longer right.
            this.openSegment([ev.pcm]);
            this.onCallerSpeaking();
          } else if (this.segActive) {
            this.segFrames.push(ev.pcm);
            if (ev.voiced) this.segVoicedMs += (ev.pcm.length / this.o.inputSampleRate) * 1000;
            this.o.transcriber?.push(ev.pcm);
            const wait = this.segHesitant ? HESITANT_FINALIZE_MS : EARLY_FINALIZE_MS;
            if (this.o.transcriber && !ev.voiced && ev.silenceMs >= wait && this.segVoicedMs >= 200) this.finalizeSegment();
          }
          if (this.bargeAt !== null && ev.voiced && ev.speechMs - this.bargeAt >= BARGE_VOICED_MS) this.interrupt();
          break;
        case "speech_start":
          this.clearSilenceTimer();
          this.onCallerSpeaking();
          break;
        case "noise":
          if (this.segActive) {
            this.o.transcriber?.discard();
            this.segActive = false;
          }
          this.bargeAt = null;
          break;
        case "utterance":
          if (this.segActive) this.finalizeSegment();
          this.bargeAt = null;
          break;
      }
    }
  }

  private openSegment(preroll: Int16Array[]) {
    this.segActive = true;
    this.segFrames = [...preroll];
    this.segVoicedMs = 0;
    this.segHesitant = false;
    this.segStartMs = this.elapsedMs;
    this.o.transcriber?.open(preroll);
  }

  private onPartial(text: string) {
    if (text !== this.lastPartial) this.o.hooks.onPartial?.(text);
    this.lastPartial = text;
    this.segHesitant = TRAILING.test(text.trim());
    // A real interruption: words that aren't just "haan / hmm / ok".
    if (this.bargeAt !== null && !BACKCHANNEL.test(text.trim()) && text.trim().split(/\s+/).length >= 2) this.interrupt();
  }

  /** The caller started (or resumed) talking. */
  private onCallerSpeaking() {
    this.clearSilenceTimer();
    if (this.paused) return;
    const t = this.turn;
    if (t && !t.realAudio) {
      // Still thinking, nothing said yet (maybe a filler): drop it and keep listening.
      this.abortTurn(false);
    } else if (this.replySpeaking && this.bargeAt === null) {
      // Mid-reply: decide from the words (partials) or sustained speech.
      this.bargeAt = this.vad.currentSpeechMs;
      if (!this.o.transcriber) this.bargeAt = Math.max(0, this.bargeAt - 150);
    }
  }

  private finalizeSegment() {
    const frames = this.segFrames;
    const voicedMs = this.segVoicedMs;
    const atMs = this.segStartMs;
    this.segActive = false;
    this.segFrames = [];
    const tr = this.o.transcriber;
    const rate = this.o.inputSampleRate;
    const t0 = Date.now();
    const result: Promise<Transcript | null> = (tr ? tr.finalize() : Promise.resolve(null))
      .then((t) => t ?? transcribeSegment(concatPcm(frames), rate))
      .catch((e) => {
        this.o.hooks.onError?.(e);
        return null;
      });
    // Transcripts are handled strictly in the order they were spoken.
    this.textChain = this.textChain.then(async () => {
      const t = await result;
      this.mark("stt", Date.now() - t0);
      this.onCallerText(t, voicedMs, atMs);
    });
  }

  private onCallerText(t: Transcript | null, voicedMs: number, atMs: number) {
    if (this.ended) return;
    const text = (t?.text ?? "").trim();
    if (t?.language === "hi-IN" || t?.language === "en-IN") this.lastLanguage = t.language;
    if (!text) {
      this.bargeAt = null;
      if (!this.paused && voicedMs >= REASK_MIN_VOICED_MS && !this.replySpeaking && !this.turn && !this.segActive) void this.reask();
      else if (!this.turn && !this.replySpeaking) this.armSilenceTimer();
      return;
    }
    this.o.hooks.onTranscript?.({ speaker: "caller", text, atMs, language: this.lastLanguage, final: true });
    if (this.paused) return;
    this.checkins = 0;
    this.reasks = 0;
    const backchannel = BACKCHANNEL.test(text);
    if (this.replySpeaking && backchannel) {
      // "haan… hmm…" while the agent talks: keep going.
      this.bargeAt = null;
      return;
    }
    if (this.replySpeaking) this.interrupt();
    if (this.turn) this.abortTurn(false);
    if (this.segActive) {
      // The caller is already speaking again; this text will be merged with the next piece.
      this.brain.addCallerText(text);
      return;
    }
    this.startTurn(text);
  }

  // -------------------------------------------------------------------------
  // Replying
  // -------------------------------------------------------------------------

  private startTurn(text: string) {
    const turn: Turn = { abort: new AbortController(), realAudio: false, fillerPlayed: false, fillerTimer: null };
    this.turn = turn;
    this.turnStartedAt = Date.now();
    this.setStatus("processing");
    if (this.o.fillers !== false) {
      turn.fillerTimer = setTimeout(() => void this.playFiller(turn), FILLER_AFTER_MS);
    }
    void this.runTurn(turn, text);
  }

  private async playFiller(turn: Turn) {
    if (this.turn !== turn || turn.realAudio || turn.abort.signal.aborted || turn.fillerPlayed) return;
    const set = await loadFillers(this.lastLanguage, this.o.voice, this.o.pace, this.o.sink.sampleRate);
    if (!set.length || this.turn !== turn || turn.realAudio || turn.abort.signal.aborted) return;
    const pcm = set[this.fillerIdx++ % set.length]!;
    turn.fillerPlayed = true;
    this.mark("filler_after_transcript", Date.now() - this.turnStartedAt);
    this.play(pcm);
  }

  private async runTurn(turn: Turn, text: string) {
    const signal = turn.abort.signal;
    let control: "end_call" | "transfer" | null = null;
    let spokenReply = "";
    try {
      spokenReply = await this.say([], {
        signal,
        events: this.brain.respond(text, signal),
        onControl: (c) => {
          control = c;
          // Handing over: don't let anything interrupt the handoff line.
          if (c === "transfer") this.muted = true;
        },
        turn,
        // Start the handoff just before the last word ends, so there is no gap.
        leadMs: () => (control === "transfer" ? 350 : 0),
      });
    } catch (e) {
      if (signal.aborted) return;
      this.o.hooks.onError?.(e);
      await this.say([this.lastLanguage === "hi-IN" ? "माफ़ कीजिए, एक पल।" : "Sorry, just a moment."], { signal });
    }
    if (turn.fillerTimer) clearTimeout(turn.fillerTimer);
    if (signal.aborted || this.turn !== turn) return;
    this.turn = null;
    // The caller said bye and the agent said goodbye without asking anything: hang up
    // like a person would, instead of waiting on a silent line.
    if (!control && GOODBYE.test(text) && !/[?？]/.test(spokenReply)) control = "end_call";
    if (control === "end_call") return void this.finish("agent_ended");
    if (control === "transfer") {
      const ok = (await this.o.hooks.onTransfer?.()) ?? false;
      if (ok) return void this.finish("transferred");
      this.muted = false;
      this.vad.reset();
      await this.say([
        this.lastLanguage === "hi-IN"
          ? "माफ़ कीजिए, अभी कोई उपलब्ध नहीं है। क्या मैं आपके लिए callback schedule कर दूँ?"
          : "I'm sorry, nobody is available right now. Shall I schedule a callback for you?",
      ]);
    }
    this.afterAgentTurn();
  }

  private abortTurn(heardSomething: boolean) {
    const t = this.turn;
    if (!t) return;
    if (t.fillerTimer) clearTimeout(t.fillerTimer);
    t.abort.abort();
    this.turn = null;
    this.o.sink.clear();
    if (heardSomething && this.speakingText) this.brain.noteInterrupted(this.speakingText);
    else if (!t.realAudio) this.brain.dropUnheard();
    this.speakingText = "";
    this.replySpeaking = false;
    this.setStatus("listening");
  }

  /** The caller cut in: stop talking right away and listen. */
  private interrupt() {
    this.bargeAt = null;
    if (!this.replySpeaking && !this.turn) return;
    this.mark("barge_in", 0);
    if (this.turn) this.abortTurn(true);
    else {
      this.o.sink.clear();
      if (this.speakingText) this.brain.noteInterrupted(this.speakingText);
      this.speakingText = "";
      this.replySpeaking = false;
      this.setStatus("listening");
    }
  }

  private play(pcm: Int16Array) {
    this.o.sink.play(pcm);
    this.o.hooks.onAgentAudio?.(pcm);
  }

  /**
   * Speak fixed sentences and/or sentences streamed from the reasoning
   * engine. Synthesis of sentence N+1 overlaps playback of sentence N.
   */
  private async say(
    fixed: string[],
    opts: {
      signal?: AbortSignal;
      events?: AsyncGenerator<BrainEvent>;
      onControl?: (c: "end_call" | "transfer") => void;
      turn?: Turn;
      leadMs?: () => number;
    } = {},
  ) {
    const { signal, events, onControl, turn } = opts;
    const queue: string[] = [...fixed];
    let producerDone = !events;
    let firstSentence = true;
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
          let text = ev.text;
          if (firstSentence) {
            firstSentence = false;
            this.mark("llm_first_sentence", Date.now() - this.turnStartedAt);
            // Don't say "जी" twice if a filler already acknowledged the caller.
            if (turn?.fillerPlayed && ACK_PREFIX.test(text)) text = text.replace(ACK_PREFIX, "");
          }
          // Skip fragments with nothing speakable (e.g. a lone "—").
          if (/[\p{L}\p{N}]/u.test(text)) queue.push(text);
          notify();
        } else if (ev.type === "tool") {
          this.o.hooks.onTool?.({ ...ev, atMs: this.elapsedMs });
          // Looking something up takes a moment: acknowledge instead of dead air.
          if (turn && !turn.realAudio && !turn.fillerPlayed) void this.playFiller(turn);
        } else if (ev.type === "control") {
          onControl?.(ev.action);
        }
      }
      producerDone = true;
      notify();
    })();

    let spoken = "";
    let firstAudio = true;
    for (;;) {
      if (signal?.aborted || this.ended) break;
      const next = queue.shift();
      if (next === undefined) {
        if (producerDone) break;
        await new Promise<void>((r) => (wake = r));
        continue;
      }
      const atMs = this.elapsedMs;
      this.speakingText = spoken ? `${spoken} ${next}` : next;
      try {
        const audio = this.o.synthesizer
          ? this.o.synthesizer.speak(next, { language: this.lastLanguage, voice: this.o.voice, pace: this.o.pace, signal })
          : synthesizeStream(next, { language: this.lastLanguage, voice: this.o.voice, pace: this.o.pace, sampleRate: this.o.sink.sampleRate as 8000 | 16000, signal });
        for await (const chunk of audio) {
          if (signal?.aborted || this.ended) break;
          if (firstAudio) {
            firstAudio = false;
            if (turn) {
              turn.realAudio = true;
              if (turn.fillerTimer) clearTimeout(turn.fillerTimer);
              this.mark("first_audio_after_transcript", Date.now() - this.turnStartedAt);
            }
            this.replySpeaking = true;
            this.setStatus("speaking");
          }
          this.play(chunk);
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
      const lead = opts.leadMs?.() ?? 0;
      if (lead > 0 && this.o.sink.remainingMs) {
        while (this.o.sink.remainingMs() > lead && !signal?.aborted) await new Promise((r) => setTimeout(r, 20));
      } else {
        await this.o.sink.drained();
      }
      if (!signal?.aborted) {
        this.replySpeaking = false;
        this.speakingText = "";
      }
    }
    return spoken;
  }

  private async reask() {
    if (this.ended || this.paused) return;
    const lines = reaskLines(this.lastLanguage, this.male);
    const line = lines[Math.min(this.reasks, lines.length - 1)]!;
    this.reasks = this.reasks >= 2 ? 0 : this.reasks + 1;
    const turn: Turn = { abort: new AbortController(), realAudio: false, fillerPlayed: true, fillerTimer: null };
    this.turn = turn;
    this.brain.noteAgentSaid(line);
    await this.say([line], { signal: turn.abort.signal, turn });
    if (this.turn === turn) {
      this.turn = null;
      this.afterAgentTurn();
    }
  }

  private afterAgentTurn() {
    if (this.ended || this.paused) return;
    this.setStatus("listening");
    this.armSilenceTimer();
  }

  private armSilenceTimer() {
    this.clearSilenceTimer();
    if (this.paused) return;
    this.silenceTimer = setTimeout(() => void this.onSilence(), this.o.silenceCheckinSec * 1000);
  }

  private clearSilenceTimer() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  private async onSilence() {
    if (this.ended || this.paused || this.replySpeaking || this.turn || this.segActive) return;
    const lines = CHECKINS[this.lastLanguage] ?? CHECKINS["en-IN"]!;
    this.checkins++;
    if (this.checkins > this.o.maxSilenceCheckins) {
      await this.say([lines[1]!]);
      return void this.finish("silence_timeout");
    }
    this.brain.noteAgentSaid(lines[0]!);
    await this.say([lines[0]!]);
    this.afterAgentTurn();
  }

  private async wrapUp(kind: EndKind) {
    if (this.ended) return;
    this.abortTurn(true);
    this.o.sink.clear();
    await this.say([MAX_DURATION_LINE[this.lastLanguage] ?? MAX_DURATION_LINE["en-IN"]!]);
    this.finish(kind);
  }

  // -------------------------------------------------------------------------
  // Supervisor controls
  // -------------------------------------------------------------------------

  /** A human takes over: the agent stops and stays silent, transcripts continue. */
  pause() {
    if (this.ended || this.paused) return;
    this.abortTurn(true);
    this.o.sink.clear();
    this.paused = true;
    this.clearSilenceTimer();
    this.setStatus("paused");
  }

  /** Hand the call back to the agent, with a note of what happened meanwhile. */
  resume(note?: string) {
    if (this.ended || !this.paused) return;
    this.paused = false;
    if (note) this.brain.addContext(note);
    this.afterAgentTurn();
  }

  /** Speak a final message that cannot be interrupted (e.g. voicemail), then end. */
  async sayAndEnd(text: string, kind: EndKind) {
    if (this.ended) return;
    this.abortTurn(false);
    this.o.sink.clear();
    this.clearSilenceTimer();
    this.vad.reset();
    this.muted = true; // ignore the line while the message plays
    await this.say([text]);
    this.finish(kind);
  }

  /** End from our side (or after the remote side hung up). */
  finish(kind: EndKind) {
    if (this.ended) return;
    this.ended = true;
    this.clearSilenceTimer();
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.turn?.abort.abort();
    if (this.turn?.fillerTimer) clearTimeout(this.turn.fillerTimer);
    this.status = "ended";
    this.o.transcriber?.close();
    this.o.synthesizer?.close();
    this.o.hooks.onStatus?.("ended");
    this.o.hooks.onEnd?.(kind);
  }
}
