/**
 * Reasoning layer for live conversations. Streams the reply sentence by
 * sentence so speech synthesis can start on the first sentence while the
 * rest is still being generated, and runs the agent's tools in between.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "./env";

export const TOOL_SCHEMAS = {
  end_call: z.object({ reason: z.string().max(200).default("goodbye") }),
  transfer_to_human: z.object({ reason: z.string().max(200).default("caller asked for a person") }),
  schedule_callback: z.object({
    when_iso: z.string().describe("ISO 8601 date-time in the caller's timezone"),
    note: z.string().max(300).default(""),
  }),
  book_appointment: z.object({
    when_iso: z.string(),
    service: z.string().max(120).default(""),
    note: z.string().max(300).default(""),
  }),
  save_caller_details: z.object({
    name: z.string().max(80).optional(),
    email: z.string().max(120).optional(),
    city: z.string().max(80).optional(),
    pincode: z.string().max(10).optional(),
    notes: z.string().max(500).optional(),
  }),
  add_to_dnc: z.object({ reason: z.string().max(200).default("caller request") }),
  lookup_knowledge: z.object({ query: z.string().min(1).max(300) }),
  mark_qualified: z.object({ note: z.string().max(300).default("") }),
  mark_disqualified: z.object({ reason: z.string().max(300).default("") }),
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;

const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  end_call: "End the call. Only after a clear goodbye, a polite disqualification, or when the caller asks to end.",
  transfer_to_human: "Hand the call to a human team member immediately. Use in the same reply as a one-sentence acknowledgement.",
  schedule_callback: "Schedule a callback at the time the caller asked for.",
  book_appointment: "Book an appointment slot the caller confirmed.",
  save_caller_details: "Save details the caller shared (name, email, city, PIN code, notes).",
  add_to_dnc: "Add this number to the do-not-call list because the caller asked not to be called again.",
  lookup_knowledge: "Search the company's knowledge base for facts, prices, policies or FAQs.",
  mark_qualified: "Record that the caller meets the qualification criteria.",
  mark_disqualified: "Record that the caller does not meet the qualification criteria.",
};

const JSON_SCHEMAS: Record<ToolName, Anthropic.Tool["input_schema"]> = {
  end_call: { type: "object", properties: { reason: { type: "string" } }, required: [] },
  transfer_to_human: { type: "object", properties: { reason: { type: "string" } }, required: [] },
  schedule_callback: {
    type: "object",
    properties: { when_iso: { type: "string", description: "ISO 8601 date-time with offset, e.g. 2026-10-12T15:00:00+05:30" }, note: { type: "string" } },
    required: ["when_iso"],
  },
  book_appointment: {
    type: "object",
    properties: { when_iso: { type: "string" }, service: { type: "string" }, note: { type: "string" } },
    required: ["when_iso"],
  },
  save_caller_details: {
    type: "object",
    properties: {
      name: { type: "string" },
      email: { type: "string" },
      city: { type: "string" },
      pincode: { type: "string" },
      notes: { type: "string" },
    },
    required: [],
  },
  add_to_dnc: { type: "object", properties: { reason: { type: "string" } }, required: [] },
  lookup_knowledge: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  mark_qualified: { type: "object", properties: { note: { type: "string" } }, required: [] },
  mark_disqualified: { type: "object", properties: { reason: { type: "string" } }, required: [] },
};

export interface ToolHost {
  /** Which tools this conversation may use. */
  enabled: ToolName[];
  run(name: ToolName, input: Record<string, unknown>): Promise<string>;
}

export type BrainEvent =
  | { type: "sentence"; text: string }
  | { type: "tool"; name: ToolName; input: Record<string, unknown>; result: string; isError: boolean }
  | { type: "control"; action: "end_call" | "transfer" }
  | { type: "done" };

/**
 * Older models (Claude Haiku 4.5 and earlier) don't accept `effort` or the
 * server-side fallback beta; newer models get both.
 */
function supportsModernParams(model: string) {
  return !/^claude-(haiku-4|sonnet-4-[05]|opus-4-[015]|3)/.test(model);
}

function requestExtras(model: string, effort: "low" | "medium" | "high") {
  return supportsModernParams(model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort } }
    : {};
}

let client: Anthropic | undefined;
function anthropic() {
  if (!env.anthropicApiKey) throw new Error("Reasoning engine is not configured");
  client ??= new Anthropic({ apiKey: env.anthropicApiKey, timeout: 30_000, maxRetries: 1 });
  return client;
}

/** Split streamed text into speakable sentences. */
export class SentenceSplitter {
  private buf = "";
  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    const re = /[.!?।]+["')\]]?\s+|\n+/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.buf))) {
      const end = m.index + m[0].length;
      const candidate = this.buf.slice(last, end).trim();
      // Avoid speaking tiny fragments like "Ji." on their own; merge them forward.
      if (candidate.length >= 8) {
        out.push(candidate);
        last = end;
      }
    }
    this.buf = this.buf.slice(last);
    return out;
  }
  flush(): string | null {
    const rest = this.buf.trim();
    this.buf = "";
    return rest ? rest : null;
  }
}

export class AgentBrain {
  private messages: Anthropic.Beta.BetaMessageParam[] = [];

  constructor(
    private readonly system: string,
    private readonly tools: ToolHost,
    private readonly model = env.llmModel,
  ) {}

  /** Seed the transcript with the agent's opening line (already spoken). */
  primeOpening(opening: string) {
    this.messages.push({ role: "user", content: "[call connected]" });
    this.messages.push({ role: "assistant", content: opening });
  }

  /** Record what the agent actually said when it was interrupted mid-reply. */
  noteInterrupted(spokenSoFar: string) {
    const last = this.messages.at(-1);
    if (last?.role === "user" && spokenSoFar.trim()) {
      this.messages.push({ role: "assistant", content: `${spokenSoFar.trim()} —` });
    }
  }

  async *respond(callerText: string, signal?: AbortSignal): AsyncGenerator<BrainEvent> {
    this.pushUser(callerText);
    const toolDefs = this.tools.enabled.map((name) => ({
      name,
      description: TOOL_DESCRIPTIONS[name],
      input_schema: JSON_SCHEMAS[name],
      eager_input_streaming: true,
    })) as Anthropic.Beta.BetaTool[];

    for (let hop = 0; hop < 4; hop++) {
      const splitter = new SentenceSplitter();
      const pending: string[] = [];
      const stream = anthropic().beta.messages.stream(
        {
          model: this.model,
          max_tokens: 1024, // spoken turns are deliberately short
          ...requestExtras(this.model, env.llmEffort),
          system: [{ type: "text", text: this.system, cache_control: { type: "ephemeral" } }],
          tools: toolDefs,
          messages: this.messages,
        } as Anthropic.Beta.MessageCreateParamsStreaming,
        { signal },
      );
      stream.on("text", (delta: string) => pending.push(...splitter.push(delta)));

      // Yield sentences as they complete while the stream is still running.
      const done = stream.finalMessage();
      let finished = false;
      done.then(
        () => (finished = true),
        () => (finished = true),
      );
      while (!finished) {
        while (pending.length) yield { type: "sentence", text: pending.shift()! };
        await new Promise((r) => setTimeout(r, 15));
      }
      const message = await done;
      while (pending.length) yield { type: "sentence", text: pending.shift()! };
      const tail = splitter.flush();
      if (tail) yield { type: "sentence", text: tail };

      this.messages.push({ role: "assistant", content: message.content as Anthropic.Beta.BetaContentBlockParam[] });
      if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens") break;

      const uses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (uses.length === 0) break;

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      let control: "end_call" | "transfer" | null = null;
      for (const use of uses) {
        const name = use.name as ToolName;
        const schema = TOOL_SCHEMAS[name];
        const parsed = schema?.safeParse(use.input);
        if (!schema || !parsed?.success || !this.tools.enabled.includes(name)) {
          results.push({ type: "tool_result", tool_use_id: use.id, content: "INVALID_INPUT", is_error: true });
          continue;
        }
        let result: string;
        let isError = false;
        try {
          result = await this.tools.run(name, parsed.data as Record<string, unknown>);
        } catch (e) {
          result = e instanceof Error ? e.message : "Tool failed";
          isError = true;
        }
        yield { type: "tool", name, input: parsed.data as Record<string, unknown>, result, isError };
        results.push({ type: "tool_result", tool_use_id: use.id, content: result, is_error: isError });
        if (!isError && name === "end_call") control = "end_call";
        if (!isError && name === "transfer_to_human") control = "transfer";
      }
      this.messages.push({ role: "user", content: results });
      if (control) {
        yield { type: "control", action: control };
        break;
      }
    }
    yield { type: "done" };
  }

  private pushUser(text: string) {
    const last = this.messages.at(-1);
    // Two caller turns in a row (e.g. after an interruption) are merged.
    if (last?.role === "user" && typeof last.content === "string") {
      last.content = `${last.content} ${text}`;
    } else {
      this.messages.push({ role: "user", content: text });
    }
  }
}

/** One-shot call summary + QA score after the call ends. */
export async function summarizeCall(
  transcript: { speaker: string; text: string }[],
  rubric = "Followed the script and goals; handled objections; qualification correct; polite and clear.",
): Promise<{ summary: string; score: number; notes: string } | null> {
  if (!env.anthropicApiKey || transcript.length === 0) return null;
  const text = transcript.map((l) => `${l.speaker.toUpperCase()}: ${l.text}`).join("\n");
  const res = await anthropic().messages.create({
    model: env.llmModel,
    max_tokens: 2000,
    output_config: {
      ...(supportsModernParams(env.llmModel) ? { effort: "low" } : {}),
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: { type: "string" },
            score: { type: "integer" },
            notes: { type: "string" },
          },
          required: ["summary", "score", "notes"],
        },
      },
    },
    system:
      "You review phone conversations between an AI voice agent and a caller. Write a 2-3 sentence English summary of what happened and the next step, a 0-100 quality score against the rubric, and one or two sentences of notes explaining the score.",
    messages: [{ role: "user", content: `Rubric: ${rubric}\n\nTranscript:\n${text}` }],
  } as Anthropic.MessageCreateParamsNonStreaming);
  if (res.stop_reason === "refusal") return null;
  const block = res.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return null;
  try {
    const data = JSON.parse(block.text) as { summary: string; score: number; notes: string };
    return { ...data, score: Math.max(0, Math.min(100, Math.round(data.score))) };
  } catch {
    return null;
  }
}
