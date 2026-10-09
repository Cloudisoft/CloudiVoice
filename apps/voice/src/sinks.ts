import type WebSocket from "ws";
import { pcm16ToBytes, pcm16ToMulaw, resample } from "@cloudivoice/core/audio";
import type { AudioSink } from "./conversation";

/** Tracks when queued audio will have finished playing at the far end. */
class PlayoutClock {
  private until = 0;
  add(samples: number, rate: number) {
    this.until = Math.max(this.until, Date.now()) + (samples / rate) * 1000;
  }
  reset() {
    this.until = Date.now();
  }
  async drained() {
    for (;;) {
      const wait = this.until - Date.now();
      if (wait <= 0) return;
      await new Promise((r) => setTimeout(r, Math.min(wait, 250)));
    }
  }
}

/** Phone-call media stream sink (carrier bidirectional stream protocol). */
export class TelephonySink implements AudioSink {
  readonly sampleRate: number;
  private clock = new PlayoutClock();
  private seq = 0;

  constructor(
    private readonly ws: WebSocket,
    private readonly streamId: () => string,
    private readonly format: "mulaw-8k" | "l16-16k",
  ) {
    this.sampleRate = format === "l16-16k" ? 16000 : 8000;
  }

  play(pcm: Int16Array) {
    if (this.ws.readyState !== this.ws.OPEN) return;
    const payload =
      this.format === "l16-16k" ? Buffer.from(pcm16ToBytes(pcm)).toString("base64") : Buffer.from(pcm16ToMulaw(pcm)).toString("base64");
    this.ws.send(
      JSON.stringify({
        event: "playAudio",
        media: {
          contentType: this.format === "l16-16k" ? "audio/x-l16" : "audio/x-mulaw",
          sampleRate: this.sampleRate,
          payload,
        },
      }),
    );
    this.clock.add(pcm.length, this.sampleRate);
    if (++this.seq % 25 === 0) this.ws.send(JSON.stringify({ event: "checkpoint", streamId: this.streamId(), name: `cv-${this.seq}` }));
  }

  clear() {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify({ event: "clearAudio", streamId: this.streamId() }));
    this.clock.reset();
  }

  drained() {
    return this.clock.drained();
  }
}

/** Browser demo sink: binary PCM16 frames + JSON control messages. */
export class BrowserSink implements AudioSink {
  readonly sampleRate = 16000;
  private clock = new PlayoutClock();

  constructor(private readonly ws: WebSocket) {}

  play(pcm: Int16Array) {
    if (this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(Buffer.from(pcm16ToBytes(pcm)), { binary: true });
    this.clock.add(pcm.length, this.sampleRate);
  }

  clear() {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify({ type: "clear" }));
    this.clock.reset();
  }

  drained() {
    return this.clock.drained();
  }
}

export { resample };
