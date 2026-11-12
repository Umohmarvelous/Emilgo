#!/bin/zsh
# The announcer, recorded once (v6 2.12): one voice on every phone, like COD.
# Run on the Mac from anywhere; about 2 GB the first time (the speech model and
# its Python libraries, kept in tools/audio/in/, git-ignored), then a minute.
#
#   games/emilgo-games/tools/audio/voice.sh              every line → assets-site/voice/
#   AUDITION=1 games/emilgo-games/tools/audio/voice.sh   one line in 8 voices, to choose by ear
#   VOICE="zf_xiaoyi:0.8,af_heart:0.2" games/emilgo-games/tools/audio/voice.sh   that voice instead
#   SPEED=1.05 ...                                       a touch quicker
#   SET=us games/emilgo-games/tools/audio/voice.sh       v7 (2.10): the American woman → assets-site/voice-us/
#   SET=us AUDITION=1 ...                                her line in 8 American voices
#
# The model: Kokoro-82M (Apache-2.0). English words in a Mandarin woman's voice
# (blended with a fifth of an English one, so every word stays clear).
# Then: scripts/deploy-site.sh ships assets-site/voice/ with the site; the
# EMILGO app streams the clips from the site. Lines added to src/audio/voice.ts
# later: run this again (a line with no clip is said by the phone's own voice).
set -e
G="$(cd "$(dirname "$0")/../.." && pwd)"
T="$G/tools/audio"
# v7 (2.10): two announcers. zh: the Mandarin-accented woman (voice/); us: an American woman (voice-us/).
SET="${SET:-zh}"
case "$SET" in
  zh) DIR=voice ;;
  us) DIR=voice-us; export VOICE="${VOICE:-af_heart}" ;;
  *) echo "SET is zh or us"; exit 1 ;;
esac
export AUDITION_SET="$SET"
W="$T/in/$DIR"
VENV="$T/in/voice-venv"
mkdir -p "$W"

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
  if [ "$SET" = us ]; then echo "  SET=us VOICE=\"af_bella\" $0"; else echo "  VOICE=\"zf_xiaoyi:0.8,af_heart:0.2\" $0"; fi
  open "$W/audition" 2>/dev/null || true
  exit 0
fi
rm -rf "$W/wav"
"$VENV/bin/python" "$T/voice_speak.py" "$W/lines.json" "$W/wav"
node "$T/voice.mjs" encode "$W/wav" "$G/assets-site/$DIR"
echo ""
echo "Done. Hear them in a match (npm run dev); ship them with scripts/deploy-site.sh."
