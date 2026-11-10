# The announcer's lines, spoken once by an open-licence speech model (v6 2.12).
#
# Kokoro-82M (hexgrad/Kokoro-82M, Apache-2.0: the weights and its voices; what it
# says is ours to ship). English words, read by a blend of its Mandarin women's
# voices and an English one: English with a Mandarin accent, an adult woman, the
# same on every phone. Run by tools/audio/voice.sh, never by hand:
#
#   python voice_speak.py <lines.json> <out dir>            every line, one WAV each
#   python voice_speak.py <lines.json> <out dir> --audition  one line in several voices
#
# VOICE picks the voice: "zf_xiaoxiao" or a weighted blend "zf_xiaoxiao:0.8,af_heart:0.2".
# SPEED: 1.0 is the model's own pace.

import json
import os
import sys

import numpy as np
import soundfile as sf
import torch
from kokoro import KPipeline

RATE = 24000
DEFAULT_VOICE = "zf_xiaoxiao:0.8,af_heart:0.2"
# The audition: each Mandarin woman alone, then each with a fifth and a third of an English woman.
AUDITION = [
    "zf_xiaoxiao", "zf_xiaoyi", "zf_xiaobei", "zf_xiaoni",
    "zf_xiaoxiao:0.8,af_heart:0.2", "zf_xiaoyi:0.8,af_heart:0.2",
    "zf_xiaoxiao:0.67,af_heart:0.33", "zf_xiaoyi:0.67,af_bella:0.33",
]
AUDITION_LINE = "start_treasure"


def blend(pipe, spec):
    """A voice pack: one voice, or a weighted mix ("a:0.8,b:0.2")."""
    parts = []
    for item in spec.split(","):
        name, _, w = item.strip().partition(":")
        parts.append((name, float(w) if w else 1.0))
    total = sum(w for _, w in parts) or 1.0
    pack = None
    for name, w in parts:
        p = pipe.load_voice(name) * (w / total)
        pack = p if pack is None else pack + p
    return pack


def speak(pipe, pack, text, speed):
    chunks = []
    for r in pipe(text, voice=pack, speed=speed):
        a = r.audio if hasattr(r, "audio") else r[2]
        if a is None:
            continue
        chunks.append(a.detach().cpu().numpy() if torch.is_tensor(a) else np.asarray(a))
    if not chunks:
        raise RuntimeError(f"no audio for: {text}")
    return np.concatenate(chunks).astype(np.float32)


def main():
    if len(sys.argv) < 3:
        sys.exit("usage: voice_speak.py <lines.json> <out dir> [--audition]")
    lines = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    os.makedirs(out, exist_ok=True)
    speed = float(os.environ.get("SPEED", "1.0"))
    # American English words and stress (lang "a"); the accent comes from the voice.
    pipe = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
    if "--audition" in sys.argv:
        text = lines[AUDITION_LINE]
        for i, spec in enumerate(AUDITION):
            name = f"{i + 1}_" + spec.replace(":", "-").replace(",", "+")
            sf.write(os.path.join(out, f"{name}.wav"), speak(pipe, blend(pipe, spec), text, speed), RATE, subtype="PCM_16")
            print(f"{i + 1}. VOICE=\"{spec}\"")
        return
    spec = os.environ.get("VOICE", DEFAULT_VOICE)
    pack = blend(pipe, spec)
    for k, (lid, text) in enumerate(lines.items()):
        sf.write(os.path.join(out, f"{lid}.wav"), speak(pipe, pack, text, speed), RATE, subtype="PCM_16")
        print(f"{k + 1:>2}/{len(lines)} {lid}: {text}")
    with open(os.path.join(out, "voice.txt"), "w") as f:
        f.write(f"{spec}\nspeed {speed}\n")


if __name__ == "__main__":
    main()
