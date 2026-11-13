#!/bin/zsh
# The announcer, recorded once: one voice on every phone, like COD.
#
# v8 (A18, the owner, 13 Nov): ONE male, authoritative American voice, by ElevenLabs. Put the key in
# games/emilgo-games/tools/audio/.env (git-ignored; never printed), copied from .env.example:
#   ELEVENLABS_API_KEY=…            your ElevenLabs key (a free account: about 10,000 characters a month, enough for
#                                   every line; the free plan is non-commercial: move to a paid plan before launch)
#   ELEVENLABS_VOICE_ID=…           the voice (pick a deep, authoritative American man in ElevenLabs' Voice Library)
#   ELEVENLABS_MODEL=…              optional (default eleven_multilingual_v2)
# then run, from anywhere:
#   games/emilgo-games/tools/audio/voice.sh              every line → assets-site/voice/ (a re-run speaks only new or
#                                                        changed lines), then scripts/deploy-site.sh ships them
# Until the key is there, the clips already in assets-site/voice/ play (and a line with no clip is said by the
# phone's own voice, an American man's).
#
# Without a key (or KOKORO=1) it falls back to the old way: Kokoro-82M (Apache-2.0) on this Mac, about 2 GB the
# first time (kept in tools/audio/in/, git-ignored):
#   KOKORO=1 AUDITION=1 games/emilgo-games/tools/audio/voice.sh   one line in 8 voices, to choose by ear
#   KOKORO=1 VOICE="am_michael" games/emilgo-games/tools/audio/voice.sh
set -e
G="$(cd "$(dirname "$0")/../.." && pwd)"
T="$G/tools/audio"
# v8: one announcer, one folder.
DIR=voice
W="$T/in/$DIR"
VENV="$T/in/voice-venv"
mkdir -p "$W"

# v8 (A18): the ElevenLabs key, from the git-ignored .env (exported quietly; never echoed).
if [ -f "$T/.env" ]; then
  set -a
  source "$T/.env"
  set +a
fi
if [ -z "$KOKORO" ] && [ -n "$ELEVENLABS_API_KEY" ]; then
  if [ -z "$ELEVENLABS_VOICE_ID" ]; then
    echo "Set ELEVENLABS_VOICE_ID in $T/.env (the male American voice's id from ElevenLabs), then run again."
    exit 1
  fi
  echo "Recording every line with ElevenLabs (voice $ELEVENLABS_VOICE_ID) …"
  node "$T/voice.mjs" lines "$W/lines.json"
  node "$T/voice.mjs" eleven "$W/lines.json" "$W/eleven"
  node "$T/voice.mjs" encode "$W/eleven" "$G/assets-site/$DIR"
  echo ""
  echo "Done. Hear them in a match (npm run dev); ship them with scripts/deploy-site.sh."
  exit 0
fi
echo "(No ELEVENLABS_API_KEY in $T/.env: using the local Kokoro model instead.)"
export AUDITION_SET=us
export VOICE="${VOICE:-am_michael}"

# Kokoro needs Python 3.10–3.12.
PY=""
for p in python3.12 python3.11 python3.10 /usr/local/bin/python3.12 /opt/homebrew/bin/python3.12; do
  if command -v $p >/dev/null 2>&1; then PY=$(command -v $p); break; fi
done
if [ -z "$PY" ]; then
  echo "Needs Python 3.12: brew install python@3.12, then run this again."
  exit 1
fi
if [ ! -x "$VENV/bin/python" ]; then
  echo "First run: setting up the speech model's Python ($PY) in $VENV …"
  "$PY" -m venv "$VENV"
  "$VENV/bin/pip" install -q --upgrade pip
  "$VENV/bin/pip" install -q "kokoro>=0.9.4" soundfile
fi
# Its English pronouncer falls back to espeak-ng for words it doesn't know.
command -v espeak-ng >/dev/null 2>&1 || echo "(tip: brew install espeak-ng if a word comes out wrong)"

node "$T/voice.mjs" lines "$W/lines.json"
if [ -n "$AUDITION" ]; then
  rm -rf "$W/audition"
  "$VENV/bin/python" "$T/voice_speak.py" "$W/lines.json" "$W/audition" --audition
  echo ""
  echo "Listen to $W/audition, then run again with the one you like, e.g."
  echo "  KOKORO=1 VOICE=\"am_michael\" $0"
  open "$W/audition" 2>/dev/null || true
  exit 0
fi
rm -rf "$W/wav"
"$VENV/bin/python" "$T/voice_speak.py" "$W/lines.json" "$W/wav"
node "$T/voice.mjs" encode "$W/wav" "$G/assets-site/$DIR"
echo ""
echo "Done. Hear them in a match (npm run dev); ship them with scripts/deploy-site.sh."
