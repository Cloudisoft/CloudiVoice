import { beforeEach, describe, expect, it, vi } from "vitest";

const transcribeMock = vi.fn();
const brains: { callerTexts: string[]; interrupted: string[]; agentSaid: string[] }[] = [];
const respondScript: { sentences: string[]; control?: "end_call" | "transfer"; delayMs?: number }[] = [];

vi.mock("@cloudivoice/core/speech", () => ({
  transcribe: (...a: unknown[]) => transcribeMock(...a),
  synthesize: async (_t: string, o: { sampleRate: number }) => ({ pcm: new Int16Array(o.sampleRate / 10).fill(3000), sampleRate: o.sampleRate }),
  // 100 ms of audio per sentence, delivered in two chunks.
  synthesizeStream: async function* (_text: string, opts: { sampleRate: number; signal?: AbortSignal }) {
    for (let i = 0; i < 2; i++) {
      await new Promise((r) => setTimeout(r, 5));
      if (opts.signal?.aborted) return;
      yield new Int16Array(opts.sampleRate / 20).fill(1000);
    }
  },
}));

vi.mock("@cloudivoice/core/brain", () => ({
  AgentBrain: class {
    primed = "";
    interrupted: string[] = [];
    callerTexts: string[] = [];
    pending: string[] = [];
    agentSaid: string[] = [];
    constructor() {
      brains.push(this);
    }
    addCallerText(t: string) {
      this.pending.push(t);
    }
    noteAgentSaid(t: string) {
      this.agentSaid.push(t);
    }
    dropUnheard() {}
    addContext() {}
    primeOpening(o: string) {
      this.primed = o;
    }
    noteInterrupted(t: string) {
      this.interrupted.push(t);
    }
    async *respond(text: string, signal?: AbortSignal) {
      // Like the real brain: unanswered caller text is merged into the next turn.
      this.pending.push(text);
      this.callerTexts.push(this.pending.join(" "));
      const step = respondScript.shift() ?? { sentences: ["Okay."] };
      for (const s of step.sentences) {
        await new Promise((r) => setTimeout(r, step.delayMs ?? 1));
        if (signal?.aborted) return;
        this.pending = [];
        yield { type: "sentence", text: s };
      }
      if (step.control) yield { type: "control", action: step.control };
      yield { type: "done" };
    }
  },
}));

const { Conversation } = await import("../src/conversation");

class FakeSink {
  sampleRate = 8000;
  played = 0;
  clears = 0;
  play(pcm: Int16Array) {
    this.played += pcm.length;
  }
  clear() {
    this.clears++;
  }
  async drained() {}
}

const speech = (ms: number) => Int16Array.from({ length: (8000 * ms) / 1000 }, (_, i) => Math.round(Math.sin(i / 3) * 9000));
const silence = (ms: number) => new Int16Array((8000 * ms) / 1000).fill(20);
const feed = (c: InstanceType<typeof Conversation>, pcm: Int16Array) => {
  for (let i = 0; i < pcm.length; i += 160) c.pushAudio(pcm.subarray(i, i + 160));
};
const until = async (cond: () => boolean, ms = 2000) => {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
};

function make(overrides: Partial<ConstructorParameters<typeof Conversation>[0]> = {}) {
  const sink = new FakeSink();
  const lines: { speaker: string; text: string }[] = [];
  const statuses: string[] = [];
  let ended: string | null = null;
  const conv = new Conversation({
    system: "sys",
    opening: "नमस्ते! मैं अनन्या बोल रही हूँ।",
    language: "hi-IN",
    voice: "priya",
    pace: 1,
    tools: { enabled: [], run: async () => "" },
    inputSampleRate: 8000,
    maxDurationSec: 600,
    silenceCheckinSec: 30,
    maxSilenceCheckins: 2,
    sink,
    hooks: {
      onTranscript: (l) => lines.push({ speaker: l.speaker, text: l.text }),
      onStatus: (s) => statuses.push(s),
      onEnd: (k) => (ended = k),
    },
    fillers: false,
    ...overrides,
  });
  return { conv, sink, lines, statuses, ended: () => ended };
}

describe("conversation engine", () => {
  beforeEach(() => {
    transcribeMock.mockReset();
    respondScript.length = 0;
    brains.length = 0;
  });

  it("speaks the opening, listens, and answers a caller turn", async () => {
    const { conv, sink, lines, statuses } = make();
    await conv.start();
    expect(lines[0]).toEqual({ speaker: "agent", text: "नमस्ते! मैं अनन्या बोल रही हूँ।" });
    expect(sink.played).toBeGreaterThan(0);
    expect(statuses.at(-1)).toBe("listening");

    transcribeMock.mockResolvedValueOnce({ text: "मुझे appointment चाहिए", language: "hi-IN" });
    respondScript.push({ sentences: ["ज़रूर।", "कल शाम पाँच बजे का slot खाली है।"] });
    feed(conv, speech(600));
    feed(conv, silence(900));
    await until(() => lines.length >= 4);
    expect(lines.slice(1).map((l) => l.speaker)).toEqual(["caller", "agent", "agent"]);
    expect(lines[2]!.text).toBe("ज़रूर।");
    conv.finish("caller_hung_up");
  });

  it("ignores short clicks and background noise", async () => {
    const { conv, lines } = make();
    await conv.start();
    feed(conv, speech(60));
    feed(conv, silence(900));
    await new Promise((r) => setTimeout(r, 50));
    expect(transcribeMock).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    conv.finish("caller_hung_up");
  });

  it("stops talking and clears queued audio when the caller interrupts", async () => {
    const { conv, sink, lines } = make();
    await conv.start();
    transcribeMock.mockResolvedValueOnce({ text: "Tell me about prices", language: "en-IN" });
    respondScript.push({ sentences: ["One.", "Two.", "Three.", "Four.", "Five."], delayMs: 40 });
    feed(conv, speech(500));
    feed(conv, silence(800));
    await until(() => lines.some((l) => l.text === "One."));
    const clearsBefore = sink.clears;
    feed(conv, speech(900)); // barge-in: sustained speech over the agent
    await until(() => sink.clears > clearsBefore);
    await new Promise((r) => setTimeout(r, 300));
    expect(lines.some((l) => l.text === "Five.")).toBe(false);
    conv.finish("caller_hung_up");
  });

  it("ends the call when the agent decides to hang up", async () => {
    const { conv, ended } = make();
    await conv.start();
    transcribeMock.mockResolvedValueOnce({ text: "बस, धन्यवाद", language: "hi-IN" });
    respondScript.push({ sentences: ["आपका दिन शुभ हो!"], control: "end_call" });
    feed(conv, speech(400));
    feed(conv, silence(900));
    await until(() => ended() !== null);
    expect(ended()).toBe("agent_ended");
  });

  it("checks in on a silent caller, then wraps up politely", async () => {
    const { conv, lines, ended } = make({ silenceCheckinSec: 0.05 as unknown as number, maxSilenceCheckins: 1 });
    await conv.start();
    await until(() => ended() !== null, 3000);
    expect(lines.map((l) => l.text)).toContain("क्या आप अभी भी line पर हैं?");
    expect(ended()).toBe("silence_timeout");
  });

  it("hands off to a person when transfer succeeds", async () => {
    const onTransfer = vi.fn().mockResolvedValue(true);
    const { conv, ended } = make();
    (conv as unknown as { o: { hooks: { onTransfer: typeof onTransfer } } }).o.hooks.onTransfer = onTransfer;
    await conv.start();
    transcribeMock.mockResolvedValueOnce({ text: "I want to talk to a person", language: "en-IN" });
    respondScript.push({ sentences: ["Sure, connecting you now."], control: "transfer" });
    feed(conv, speech(400));
    feed(conv, silence(900));
    await until(() => ended() !== null);
    expect(onTransfer).toHaveBeenCalled();
    expect(ended()).toBe("transferred");
  });

  describe("with streaming recognition", () => {
    /** Fake streaming recognizer: finals come from a queue of scripted texts. */
    class FakeTranscriber {
      isOpen = false;
      onPartial: ((t: string) => void) | null = null;
      finals: string[] = [];
      partials: string[] = [];
      open() {
        this.isOpen = true;
      }
      push() {
        const p = this.partials.shift();
        if (p !== undefined) this.onPartial?.(p);
      }
      async finalize() {
        this.isOpen = false;
        await new Promise((r) => setTimeout(r, 30));
        return { text: this.finals.shift() ?? "", language: "hi-IN" };
      }
      discard() {
        this.isOpen = false;
      }
      close() {}
    }

    it("answers right after a short pause, without waiting for long silence", async () => {
      const tr = new FakeTranscriber();
      const { conv, lines } = make({ transcriber: tr as never });
      await conv.start();
      tr.finals.push("कल का slot है?");
      respondScript.push({ sentences: ["जी, कल शाम पाँच बजे खाली है।"] });
      feed(conv, speech(500));
      feed(conv, silence(300)); // well under the old end-of-turn silence
      await until(() => lines.some((l) => l.speaker === "agent" && l.text.startsWith("जी")));
      conv.finish("caller_hung_up");
    });

    it("merges a mid-sentence pause with what the caller says next", async () => {
      const tr = new FakeTranscriber();
      const { conv, lines } = make({ transcriber: tr as never });
      await conv.start();
      tr.finals.push("मुझे appointment चाहिए", "कल शाम को");
      respondScript.push({ sentences: ["ठीक है।"], delayMs: 200 }, { sentences: ["कल शाम पाँच बजे ठीक रहेगा?"] });
      feed(conv, speech(500));
      feed(conv, silence(260)); // short pause: early transcript, reply starts
      await new Promise((r) => setTimeout(r, 60));
      feed(conv, speech(400)); // ...but the caller keeps going
      feed(conv, silence(300));
      await until(() => lines.some((l) => l.text === "कल शाम पाँच बजे ठीक रहेगा?"));
      expect(lines.some((l) => l.text === "ठीक है।")).toBe(false);
      expect(brains[0]!.callerTexts.at(-1)).toBe("मुझे appointment चाहिए कल शाम को");
      conv.finish("caller_hung_up");
    });

    it("keeps talking through backchannels like 'haan' / 'hmm'", async () => {
      const tr = new FakeTranscriber();
      const { conv, sink, lines } = make({ transcriber: tr as never });
      await conv.start();
      tr.finals.push("prices बताइए", "हाँ");
      respondScript.push({ sentences: ["पहला plan।", "दूसरा plan।", "तीसरा plan।"], delayMs: 60 });
      feed(conv, speech(500));
      feed(conv, silence(300));
      await until(() => lines.some((l) => l.text === "पहला plan।"));
      const clears = sink.clears;
      feed(conv, speech(300)); // "हाँ"
      feed(conv, silence(300));
      await until(() => lines.some((l) => l.text === "तीसरा plan।"));
      expect(sink.clears).toBe(clears);
      conv.finish("caller_hung_up");
    });

    it("stops and listens when the caller really cuts in", async () => {
      const tr = new FakeTranscriber();
      const { conv, sink, lines } = make({ transcriber: tr as never });
      await conv.start();
      tr.finals.push("prices बताइए", "नहीं नहीं, मुझे सिर्फ़ basic plan चाहिए");
      respondScript.push({ sentences: ["पहला plan।", "दूसरा plan।", "तीसरा plan।", "चौथा plan।"], delayMs: 80 }, { sentences: ["जी, basic plan।"] });
      feed(conv, speech(500));
      feed(conv, silence(300));
      await until(() => lines.some((l) => l.text === "पहला plan।"));
      const clears = sink.clears;
      tr.partials.push("नहीं नहीं मुझे");
      feed(conv, speech(300));
      await until(() => sink.clears > clears);
      feed(conv, speech(300));
      feed(conv, silence(300));
      await until(() => lines.some((l) => l.text === "जी, basic plan।"));
      expect(lines.some((l) => l.text === "चौथा plan।")).toBe(false);
      expect(brains[0]!.interrupted.length).toBe(1);
      conv.finish("caller_hung_up");
    });

    it("politely asks again when speech couldn't be understood", async () => {
      const tr = new FakeTranscriber();
      const { conv, lines } = make({ transcriber: tr as never });
      transcribeMock.mockResolvedValue({ text: "", language: null });
      await conv.start();
      tr.finals.push("");
      feed(conv, speech(800));
      feed(conv, silence(300));
      await until(() => lines.some((l) => l.speaker === "agent" && l.text.includes("दोबारा")));
      expect(lines.at(-1)!.text).toContain("सुन नहीं पाई"); // feminine voice
      conv.finish("caller_hung_up");
    });
  });
});
