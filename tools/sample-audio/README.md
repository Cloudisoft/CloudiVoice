# Sample-call audio

The hero demo on the website plays **real audio files** with a matching,
time-coded transcript. This folder generates them.

- `scripts.json` — the conversations (display text + optional pronunciation text).
- `generate.py` — synthesizes each turn, mixes a dual-channel call recording
  (agent left, caller right), encodes MP3, and writes
  `apps/web/src/content/samples.json` with exact segment timings and waveform peaks.

The current files were synthesized with Kokoro-82M (Apache-2.0 weights,
`hf_alpha`, `hf_beta`, `hm_omega`, `hm_psi` voices) and checked for
intelligibility with an independent speech recognizer. They are labelled on
the site as synthesized samples with fictional businesses.

**Replace them with recordings from the production voice stack** as soon as
verified recordings exist. Keep the manifest shape; add a new entry per
language and the language selector picks it up automatically.

```bash
python -m venv .venv && .venv/bin/pip install kokoro-onnx soundfile
# download kokoro-v1.0.onnx and voices-v1.0.bin from the kokoro-onnx releases
.venv/bin/python generate.py --model kokoro-v1.0.onnx --voices voices-v1.0.bin \
  --out ../../apps/web/public/samples --manifest ../../apps/web/src/content/samples.json
```
