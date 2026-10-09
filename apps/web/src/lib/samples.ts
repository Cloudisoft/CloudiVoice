import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface SampleSegment {
  speaker: "agent" | "caller";
  name: string;
  text: string;
  startMs: number;
  endMs: number;
}

export interface Sample {
  id: string;
  scenario: string;
  language: string;
  business: string;
  agentName: string;
  callerName: string;
  src: string;
  durationMs: number;
  segments: SampleSegment[];
  events: { atMs: number; label: string }[];
  peaks: { agent: number[]; caller: number[] };
  provenance: string;
}

export type SampleMeta = Omit<Sample, "segments" | "events" | "peaks">;

let cache: Sample[] | null = null;

/** Server-only: read the sample manifest shipped in /public/samples. */
export async function loadSamples(): Promise<Sample[]> {
  if (cache) return cache;
  const raw = await readFile(join(process.cwd(), "public", "samples", "manifest.json"), "utf8");
  cache = (JSON.parse(raw) as { samples: Sample[] }).samples;
  return cache;
}

export function toMeta(s: Sample): SampleMeta {
  const { segments: _s, events: _e, peaks: _p, ...meta } = s;
  return meta;
}
