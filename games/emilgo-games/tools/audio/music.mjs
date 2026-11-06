// The game's music (v5; the owner: "download non-copyrighted interesting 8bit
// background musics for the lobby, the game environment screen, the victory
// screen"). Every track is CC0 chiptune from OpenGameArt. This fetches each,
// decodes it (WASM), evens the loudness, folds it to mono 22 kHz (fine for 8-bit,
// and a phone decodes the whole track up front so it can never skip) and encodes
// MP3 into assets-site/music/, which the site serves (and the EMILGO app's copy
// streams from it).
//
//   node tools/audio/music.mjs            (downloads into tools/audio/in/, cached)
//
// The jingles come from NES Shooter Music's WAV.zip: unzip it into tools/audio/in/nes/ first.

import { MPEGDecoder } from "mpg123-decoder";
import { OggVorbisDecoder } from "@wasm-audio-decoders/ogg-vorbis";
import { Mp3Encoder } from "@breezystack/lamejs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const IN = join(here, "in");
const OUT = join(here, "../../assets-site/music");
mkdirSync(IN, { recursive: true });
mkdirSync(OUT, { recursive: true });

const ACTION = "https://opengameart.org/content/5-chiptunes-action";
const ADV = "https://opengameart.org/content/4-chiptunes-adventure";
const NES = "https://opengameart.org/content/nes-shooter-music-5-tracks-3-jingles";
const F = "https://opengameart.org/sites/default/files";
const JJ = "Juhani Junkala";
const CC0 = "CC0";
/** [game name, file URL or nes/ file, page, artist, title, licence, seconds to keep (0: all), start offset s] */
export const TRACKS = [
  ["lobby", `${F}/level3.mp3`, ACTION, JJ, "Level 3", CC0, 0, 0],
  ["menu", `${F}/Juhani%20Junkala%20%5BChiptune%20Adventures%5D%204.%20Stage%20Select.ogg`, ADV, JJ, "Stage Select", CC0, 0, 0],
  ["explore", `${F}/level1.mp3`, ACTION, JJ, "Level 1", CC0, 0, 0],
  ["explore2", `${F}/level2.mp3`, ACTION, JJ, "Level 2", CC0, 0, 0],
  ["rush", `${F}/Juhani%20Junkala%20%5BChiptune%20Adventures%5D%201.%20Stage%201.ogg`, ADV, JJ, "Stage 1", CC0, 0, 0],
  ["final", `${F}/Juhani%20Junkala%20%5BChiptune%20Adventures%5D%203.%20Boss%20Fight.ogg`, ADV, JJ, "Boss Fight", CC0, 0, 0],
  ["dead", `${F}/Juhani%20Junkala%20%5BChiptune%20Adventures%5D%202.%20Stage%202.ogg`, ADV, JJ, "Stage 2", CC0, 0, 0],
  ["ending", `${F}/ending.mp3`, ACTION, JJ, "Ending", CC0, 0, 0],
  ["victory", "nes/Win Jingle.wav", NES, "SketchyLogic", "Win Jingle", CC0, 0, 0],
  ["defeat", "nes/BossIntro.wav", NES, "SketchyLogic", "Boss Intro", CC0, 0, 0],
];

async function fetchTo(url, file) {
  if (existsSync(file)) return readFileSync(file);
  for (let k = 0; k < 4; k++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status}`);
      const b = Buffer.from(await r.arrayBuffer());
      writeFileSync(file, b);
      return b;
    } catch (e) {
      console.warn("retry", url, e.message);
    }
  }
  throw new Error(`could not fetch ${url}`);
}

function decodeWav(buf) {
  // PCM only: find the fmt and data chunks.
  let o = 12;
  let ch = 2, rate = 44100, bits = 16, data = null;
  while (o + 8 <= buf.length) {
    const id = buf.toString("latin1", o, o + 4);
    const len = buf.readUInt32LE(o + 4);
    if (id === "fmt ") {
      ch = buf.readUInt16LE(o + 10);
      rate = buf.readUInt32LE(o + 12);
      bits = buf.readUInt16LE(o + 22);
    } else if (id === "data") data = buf.subarray(o + 8, o + 8 + len);
    o += 8 + len + (len & 1);
  }
  const bytes = bits / 8;
  const n = Math.floor(data.length / (bytes * ch));
  const out = [new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 2; c++) {
      const at = i * ch * bytes + Math.min(c, ch - 1) * bytes;
      out[c][i] = bits === 16 ? data.readInt16LE(at) / 32768 : bits === 8 ? (data[at] - 128) / 128 : data.readInt32LE(at) / 2147483648;
    }
  }
  return { rate, ch: out };
}

async function decode(buf, url) {
  if (url.endsWith(".wav")) return decodeWav(buf);
  const dec = url.endsWith(".ogg") ? new OggVorbisDecoder() : new MPEGDecoder();
  await dec.ready;
  const out = url.endsWith(".ogg") ? await dec.decodeFile(new Uint8Array(buf)) : dec.decode(new Uint8Array(buf));
  dec.free();
  const ch = out.channelData.length >= 2 ? [out.channelData[0], out.channelData[1]] : [out.channelData[0], out.channelData[0]];
  return { rate: out.sampleRate, ch };
}

/** Trim silence at both ends, keep [from, from+len], normalise to −1 dBFS peak / about −16 LUFS-ish RMS, fade the ends. */
function shape(a, from = 0, len = 0, fadeIn = 0.04, fadeOut = 1.5) {
  const n = a.ch[0].length;
  const loud = (i) => Math.max(Math.abs(a.ch[0][i]), Math.abs(a.ch[1][i]));
  let s = 0;
  while (s < n && loud(s) < 0.003) s++;
  let e = n - 1;
  while (e > s && loud(e) < 0.003) e--;
  s = Math.min(e, s + Math.round(from * a.rate));
  if (len > 0) e = Math.min(e, s + Math.round(len * a.rate));
  const L = a.ch[0].slice(s, e);
  const R = a.ch[1].slice(s, e);
  let peak = 0;
  let sq = 0;
  for (let i = 0; i < L.length; i++) {
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    sq += L[i] * L[i] + R[i] * R[i];
  }
  const rms = Math.sqrt(sq / (2 * L.length));
  // Aim for an RMS of 0.14 (a game score sits under the effects), never past −1 dBFS.
  const k = Math.min(0.89 / (peak || 1), 0.14 / (rms || 1));
  const fi = Math.round(fadeIn * a.rate);
  const fo = Math.round(fadeOut * a.rate);
  for (let i = 0; i < L.length; i++) {
    let g = k;
    if (i < fi) g *= i / fi;
    if (i > L.length - fo) g *= (L.length - i) / fo;
    L[i] *= g;
    R[i] *= g;
  }
  return { rate: a.rate, ch: [L, R] };
}

/** Fold to mono and bring down to 22,050 Hz (linear; chiptune's edge survives it well enough at this rate). */
function mono22(a) {
  const R = 22050;
  const step = a.rate / R;
  const n = Math.floor(a.ch[0].length / step);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f = i * step;
    const k = Math.floor(f);
    const u = f - k;
    const m = (j) => (a.ch[0][j] + a.ch[1][j]) / 2;
    out[i] = m(k) * (1 - u) + m(Math.min(a.ch[0].length - 1, k + 1)) * u;
  }
  return { rate: R, data: out };
}

function encode(a, kbps) {
  const enc = new Mp3Encoder(1, a.rate, kbps);
  const o = new Int16Array(a.data.length);
  for (let i = 0; i < o.length; i++) o[i] = Math.max(-32768, Math.min(32767, Math.round(a.data[i] * 32767)));
  const parts = [];
  const B = 1152 * 64;
  for (let i = 0; i < o.length; i += B) {
    const m = enc.encodeBuffer(o.subarray(i, i + B));
    if (m.length) parts.push(Buffer.from(m));
  }
  const f = enc.flush();
  if (f.length) parts.push(Buffer.from(f));
  return Buffer.concat(parts);
}

const credits = ["EMILGO Games: the music. Every track is CC0 (public domain) from OpenGameArt.org; no credit is required, it is listed for the record.", ""];
const list = [];
for (const [name, url, page, artist, title, lic, keep, from] of TRACKS) {
  const local = url.startsWith("nes/");
  const src = join(IN, local ? url : decodeURIComponent(url.split("/").pop()));
  const buf = local ? readFileSync(src) : await fetchTo(url, src);
  const a = await decode(buf, url);
  // No fade at the ends: the player overlaps a loop's ends itself.
  const s = mono22(shape(a, from, keep, 0.01, 0.02));
  const mp3 = encode(s, 56);
  writeFileSync(join(OUT, `${name}.mp3`), mp3);
  const secs = s.data.length / s.rate;
  list.push({ name, title, artist, page, licence: lic, seconds: Math.round(secs), bytes: mp3.length });
  credits.push(`${name}.mp3  "${title}" by ${artist}, ${lic}. ${page}`);
  console.log(name.padEnd(10), title.padEnd(24), `${secs.toFixed(0)} s`, `${(mp3.length / 1024).toFixed(0)} KB`);
}
writeFileSync(join(OUT, "CREDITS.txt"), credits.join("\n") + "\n");
writeFileSync(join(OUT, "music.json"), JSON.stringify({ tracks: list }, null, 1));
