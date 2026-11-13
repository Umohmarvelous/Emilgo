// The announcer's recorded lines (v6 2.12): the words out of the game, the
// spoken WAVs into small MP3s the site serves. tools/audio/voice.sh runs it
// around the speech model:
//
//   node tools/audio/voice.mjs lines  [lines.json]            the words (src/audio/voice.ts LINES) as JSON
//   node tools/audio/voice.mjs encode [wav dir] [out dir]      WAVs → <id>.mp3 + index.json + CREDITS.txt
//   node tools/audio/voice.mjs eleven [lines.json] [wav dir]   v8 (A18): every line spoken by ElevenLabs → WAVs
//        (ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID from the environment; the key is never printed)
//
// Each clip: silence trimmed, levelled (speech over the effects, never past
// −1 dBFS), mono MP3 at 32 kbps (LAME takes it to 22 kHz): a few KB a line,
// about 30 lines.
// The game reads index.json (the ids it has) and falls back to the phone's own
// voice for any line missing.

import { Mp3Encoder } from "@breezystack/lamejs";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "../..");
const WORK = join(here, "in/voice");
const KBPS = 32;

/** LINES from src/audio/voice.ts: `  id: "words",` between `export const LINES` and `};`. */
function readLines() {
  const src = readFileSync(join(ROOT, "src/audio/voice.ts"), "utf8");
  const body = src.split("export const LINES")[1]?.split("\n};")[0];
  if (!body) throw new Error("LINES not found in src/audio/voice.ts");
  const out = {};
  for (const m of body.matchAll(/^\s+([a-z0-9_]+):\s*"((?:[^"\\]|\\.)*)",?\s*$/gm)) out[m[1]] = JSON.parse(`"${m[2]}"`);
  if (Object.keys(out).length < 10) throw new Error("too few lines parsed from src/audio/voice.ts");
  return out;
}

function decodeWav(buf) {
  let o = 12;
  let ch = 1, rate = 24000, bits = 16, data = null;
  while (o + 8 <= buf.length) {
    const id = buf.toString("latin1", o, o + 4);
    const len = buf.readUInt32LE(o + 4);
    if (id === "fmt ") {
      ch = buf.readUInt16LE(o + 10);
      rate = buf.readUInt32LE(o + 12);
      bits = buf.readUInt16LE(o + 22);
    } else if (id === "data") data = buf.subarray(o + 8, o + 8 + Math.min(len, buf.length - o - 8));
    o += 8 + len + (len & 1);
  }
  if (!data || bits !== 16) throw new Error("16-bit PCM WAV expected");
  const n = Math.floor(data.length / (2 * ch));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += data.readInt16LE((i * ch + c) * 2) / 32768;
    out[i] = s / ch;
  }
  return { rate, data: out };
}

/** To 24 kHz (linear: the model speaks at 24 kHz already; anything else is a test). */
function to24(a) {
  if (a.rate === 24000) return a;
  const step = a.rate / 24000;
  const n = Math.floor(a.data.length / step);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f = i * step;
    const k = Math.floor(f);
    const u = f - k;
    out[i] = a.data[k] * (1 - u) + a.data[Math.min(a.data.length - 1, k + 1)] * u;
  }
  return { rate: 24000, data: out };
}

/** Trim the silence (a breath kept each side), level to an RMS of 0.2 under a −1 dBFS peak, soften the ends. */
function shape(a) {
  const d = a.data;
  const thr = 0.01;
  let s = 0;
  while (s < d.length && Math.abs(d[s]) < thr) s++;
  let e = d.length - 1;
  while (e > s && Math.abs(d[e]) < thr) e--;
  s = Math.max(0, s - Math.round(0.03 * a.rate));
  e = Math.min(d.length, e + Math.round(0.12 * a.rate));
  const x = d.slice(s, e);
  let peak = 0, sq = 0, loud = 0;
  for (const v of x) {
    peak = Math.max(peak, Math.abs(v));
    if (Math.abs(v) > thr) {
      sq += v * v;
      loud++;
    }
  }
  const rms = Math.sqrt(sq / (loud || 1));
  const k = Math.min(0.89 / (peak || 1), 0.2 / (rms || 1));
  const f = Math.round(0.01 * a.rate);
  for (let i = 0; i < x.length; i++) {
    let g = k;
    if (i < f) g *= i / f;
    if (i > x.length - f) g *= (x.length - i) / f;
    x[i] *= g;
  }
  return { rate: a.rate, data: x };
}

function encode(a) {
  const enc = new Mp3Encoder(1, a.rate, KBPS);
  const pcm = new Int16Array(a.data.length);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(a.data[i] * 32767)));
  const parts = [];
  const B = 1152 * 32;
  for (let i = 0; i < pcm.length; i += B) {
    const m = enc.encodeBuffer(pcm.subarray(i, i + B));
    if (m.length) parts.push(Buffer.from(m));
  }
  const f = enc.flush();
  if (f.length) parts.push(Buffer.from(f));
  return Buffer.concat(parts);
}

/** A WAV file (16-bit mono) around raw PCM. */
function wavOf(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "latin1");
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8, "latin1");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "latin1");
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/**
 * v8 (A18): every line in one ElevenLabs voice (the owner's choice: a male, authoritative American), as 24 kHz PCM,
 * into WAVs the encoder takes. A line already spoken in the same voice is kept (a re-run costs only new lines).
 */
async function eleven(linesFile, outDir) {
  const key = (process.env.ELEVENLABS_API_KEY ?? "").trim();
  const voice = (process.env.ELEVENLABS_VOICE_ID ?? "").trim();
  const model = (process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2").trim();
  if (!key || !voice) throw new Error("ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID must be set (tools/audio/.env)");
  const lines = JSON.parse(readFileSync(linesFile, "utf8"));
  mkdirSync(outDir, { recursive: true });
  const tag = `elevenlabs:${voice}:${model}`;
  const same = existsSync(join(outDir, "voice.txt")) && readFileSync(join(outDir, "voice.txt"), "utf8").split("\n")[0] === tag;
  let chars = 0;
  for (const [id, text] of Object.entries(lines)) {
    const file = join(outDir, `${id}.wav`);
    const said = join(outDir, `${id}.txt`);
    if (same && existsSync(file) && existsSync(said) && readFileSync(said, "utf8") === text) continue;
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=pcm_24000`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/pcm" },
      body: JSON.stringify({ text, model_id: model, voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true } }),
    });
    if (!res.ok) {
      const why = (await res.text().catch(() => "")).slice(0, 300).replace(key, "***");
      throw new Error(`ElevenLabs refused "${id}" (${res.status}): ${why}`);
    }
    writeFileSync(file, wavOf(Buffer.from(await res.arrayBuffer()), 24000));
    writeFileSync(said, text);
    chars += text.length;
    console.log(id.padEnd(18), `${text.length} chars`);
  }
  writeFileSync(join(outDir, "voice.txt"), `${tag}\n`);
  console.log(`${chars} characters spoken this run (the free plan has about 10,000 a month; non-commercial)`);
}

const [cmd, a1, a2] = process.argv.slice(2);
if (cmd === "eleven") {
  await eleven(a1 ?? join(WORK, "lines.json"), a2 ?? join(WORK, "wav"));
} else if (cmd === "lines") {
  const file = a1 ?? join(WORK, "lines.json");
  mkdirSync(dirname(file), { recursive: true });
  const lines = readLines();
  writeFileSync(file, JSON.stringify(lines, null, 1));
  console.log(`${Object.keys(lines).length} lines → ${file}`);
} else if (cmd === "encode") {
  const wavs = a1 ?? join(WORK, "wav");
  const out = a2 ?? join(ROOT, "assets-site/voice");
  const lines = readLines();
  const missing = Object.keys(lines).filter((id) => !existsSync(join(wavs, `${id}.wav`)));
  if (missing.length) console.warn(`no WAV for ${missing.join(", ")}: the phone's voice says those`);
  // A fresh folder: a line taken out of the game never lingers on the site.
  if (existsSync(out)) for (const f of readdirSync(out)) if (/\.(mp3|json|txt)$/.test(f)) rmSync(join(out, f));
  mkdirSync(out, { recursive: true });
  const ids = [];
  let total = 0;
  for (const id of Object.keys(lines)) {
    const w = join(wavs, `${id}.wav`);
    if (!existsSync(w)) continue;
    const clip = shape(to24(decodeWav(readFileSync(w))));
    const mp3 = encode(clip);
    writeFileSync(join(out, `${id}.mp3`), mp3);
    ids.push(id);
    total += mp3.length;
    console.log(id.padEnd(18), `${(clip.data.length / clip.rate).toFixed(1)} s`.padStart(6), `${(mp3.length / 1024).toFixed(1)} KB`.padStart(8));
  }
  writeFileSync(join(out, "index.json"), JSON.stringify(ids));
  const voice = existsSync(join(wavs, "voice.txt")) ? readFileSync(join(wavs, "voice.txt"), "utf8").split("\n")[0] : "?";
  const el = voice.startsWith("elevenlabs:");
  writeFileSync(
    join(out, "CREDITS.txt"),
    [
      "LOOTLINE: the announcer's lines.",
      el
        ? `Spoken by ElevenLabs (https://elevenlabs.io), voice ${voice.split(":")[1]}, model ${voice.split(":")[2]}. A commercial game needs a paid ElevenLabs plan.`
        : `Spoken by Kokoro-82M (https://huggingface.co/hexgrad/Kokoro-82M, Apache-2.0), voice ${voice}.`,
      "Made with tools/audio/voice.sh; the words are src/audio/voice.ts LINES.",
      "",
    ].join("\n"),
  );
  console.log(`${ids.length} clips, ${(total / 1024).toFixed(0)} KB → ${out}`);
} else {
  console.error("usage: node tools/audio/voice.mjs lines [file] | encode [wav dir] [out dir]");
  process.exit(1);
}
