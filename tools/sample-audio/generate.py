"""
Generate the website's sample-call recordings and their manifest.

Each sample is synthesized turn by turn (Kokoro, Apache-2.0 weights), mixed
to a dual-channel call recording (agent = left, caller = right) and encoded to
MP3. The manifest stores exact segment timings, so the on-page transcript and
waveform follow the real audio.

Usage:
  python generate.py --model kokoro-v1.0.onnx --voices voices-v1.0.bin \
      --out ../../apps/web/public/samples --manifest ../../apps/web/public/samples/manifest.json

Replace these files with recordings from your production voice stack as soon
as verified recordings are available; the manifest format stays the same.
"""
import argparse
import json
import random
import subprocess
import sys
from pathlib import Path

import numpy as np
from kokoro_onnx import Kokoro

SR = 24000
PEAKS_PER_SEC = 24


def trim_silence(x: np.ndarray, thresh=0.01) -> np.ndarray:
    idx = np.where(np.abs(x) > thresh)[0]
    if len(idx) == 0:
        return x
    start = max(0, idx[0] - int(0.03 * SR))
    end = min(len(x), idx[-1] + int(0.08 * SR))
    return x[start:end]


def peaks(x: np.ndarray, duration: float) -> list:
    n = max(1, int(duration * PEAKS_PER_SEC))
    out = []
    step = len(x) / n
    for i in range(n):
        seg = x[int(i * step) : int((i + 1) * step)]
        out.append(float(np.sqrt(np.mean(seg**2))) if len(seg) else 0.0)
    m = max(out) or 1.0
    return [round(v / m, 3) for v in out]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--voices", required=True)
    ap.add_argument("--scripts", default=str(Path(__file__).with_name("scripts.json")))
    ap.add_argument("--out", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--only", default="")
    args = ap.parse_args()

    random.seed(7)
    k = Kokoro(args.model, args.voices)
    data = json.loads(Path(args.scripts).read_text(encoding="utf-8"))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = Path(args.manifest)
    existing = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"samples": []}
    by_id = {s["id"]: s for s in existing.get("samples", [])}

    for sample in data["samples"]:
        if args.only and sample["id"] not in args.only.split(","):
            continue
        print(f"[{sample['id']}]", file=sys.stderr)
        left, right = [], []
        t = 0.35  # brief line noise before the agent speaks
        cursor = int(t * SR)
        segments, events = [], []
        prev = None
        for turn in sample["turns"]:
            if turn["s"] == "tool":
                events.append({"atMs": int((cursor / SR) * 1000), "label": turn["text"]})
                cursor += int(0.25 * SR)
                continue
            who = sample[turn["s"]]
            text = turn.get("say", turn["text"])
            audio, sr = k.create(text, voice=who["voice"], speed=who.get("speed", 1.0), lang=who["lang"])
            assert sr == SR, sr
            audio = trim_silence(np.asarray(audio, dtype=np.float32))
            audio = audio / (np.max(np.abs(audio)) + 1e-9) * (0.82 if turn["s"] == "agent" else 0.72)
            # Natural turn-taking gaps (agent replies reflect real response latency).
            if prev is not None:
                if turn["s"] == "agent":
                    gap = random.uniform(0.55, 0.85)
                else:
                    gap = random.uniform(0.35, 0.7)
                cursor += int(gap * SR)
            start = cursor
            end = start + len(audio)
            (left if turn["s"] == "agent" else right).append((start, audio))
            segments.append(
                {
                    "speaker": turn["s"],
                    "name": who["name"],
                    "text": turn["text"],
                    "startMs": int(start / SR * 1000),
                    "endMs": int(end / SR * 1000),
                }
            )
            cursor = end
            prev = turn["s"]
        total = cursor + int(0.6 * SR)
        L = np.zeros(total, dtype=np.float32)
        R = np.zeros(total, dtype=np.float32)
        for s, a in left:
            L[s : s + len(a)] += a
        for s, a in right:
            R[s : s + len(a)] += a
        # Faint room tone so silences sound like a live line, not digital zero.
        noise = np.random.default_rng(3).normal(0, 0.0016, total).astype(np.float32)
        L += noise
        R += noise * 0.9
        stereo = np.stack([L, R], axis=1)
        pcm = (np.clip(stereo, -1, 1) * 32767).astype("<i2").tobytes()
        mp3 = out_dir / f"{sample['id']}.mp3"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(SR), "-ac", "2", "-i", "-", "-codec:a", "libmp3lame", "-b:a", "96k", str(mp3)],
            input=pcm,
            check=True,
        )
        duration = total / SR
        by_id[sample["id"]] = {
            "id": sample["id"],
            "scenario": sample["scenario"],
            "language": sample["language"],
            "business": sample["business"],
            "agentName": sample["agent"]["name"],
            "callerName": sample["caller"]["name"],
            "src": f"/samples/{sample['id']}.mp3",
            "durationMs": int(duration * 1000),
            "segments": segments,
            "events": events,
            "peaks": {"agent": peaks(L, duration), "caller": peaks(R, duration)},
            "provenance": "Synthesized sample conversation for demonstration. Businesses and people are fictional.",
        }
        print(f"  {duration:.1f}s, {len(segments)} turns", file=sys.stderr)

    order = [s["id"] for s in data["samples"]]
    manifest = {"samples": [by_id[i] for i in order if i in by_id]}
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
