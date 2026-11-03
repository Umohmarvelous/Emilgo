// The game's music (v4 rework R8; the owner: "do not create the music yourself
// but go online and search for game music background from sources online and
// use it, I do not want to hear a strings music again"). Every track is CC0
// from OpenGameArt, chosen electronic, drum and bass, or dark ambient (no
// orchestra, no strings, no chiptune). This fetches each, decodes it (WASM),
// trims silence, evens the loudness, fades the ends, and encodes MP3 (96 kb/s
// stereo; the stings 128) into assets-site/music/, which the site serves (and
// the EMILGO app's copy streams from it).
//
//   node tools/audio/music.mjs            (downloads into tools/audio/in/, cached)

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

/** [game name, file URL, page, artist, title, licence, seconds to keep (0: all), start offset s] */
export const TRACKS = [
  ["lobby", "https://opengameart.org/sites/default/files/specular_city_1.mp3", "https://opengameart.org/content/specular-city", "Vitalezzz", "Specular City", "CC0", 0, 0],
  ["explore", "https://opengameart.org/sites/default/files/orbital_graveyard_0.mp3", "https://opengameart.org/content/orbital-graveyard", "Vitalezzz", "Orbital Graveyard", "CC0", 0, 0],
  ["combat", "https://opengameart.org/sites/default/files/hunter-class_lifeform_1.mp3", "https://opengameart.org/content/hunter-class-lifeform", "Vitalezzz", "Hunter-class Lifeform", "CC0", 0, 0],
  ["final", "https://opengameart.org/sites/default/files/Final-Hour-isaiah658_0.mp3", "https://opengameart.org/content/final-hour", "isaiah658", "Final Hour", "CC0", 0, 0],
  ["rush", "https://opengameart.org/sites/default/files/virtual_rush_2.mp3", "https://opengameart.org/content/virtual-rush", "Vitalezzz", "Virtual Rush", "CC0", 0, 0],
  ["dead", "https://opengameart.org/sites/default/files/EmptyCity.ogg", "https://opengameart.org/content/emptycity-background-music", "(OpenGameArt)", "EmptyCity", "CC0", 0, 0],
  ["deadFight", "https://opengameart.org/sites/default/files/Factory.ogg", "https://opengameart.org/content/factory-ambiance", "(OpenGameArt)", "Factory", "CC0", 0, 0],
];
/** Stings cut from the tracks: [name, from track, start s, length s]. */
const STINGS = [
  ["victory", "rush", 20, 9],
  ["defeat", "dead", 4, 9],
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

async function decode(buf, url) {
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

function encode(a, kbps) {
  const enc = new Mp3Encoder(2, a.rate, kbps);
  const toI16 = (f) => {
    const o = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) o[i] = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767)));
    return o;
  };
  const L = toI16(a.ch[0]);
  const R = toI16(a.ch[1]);
  const parts = [];
  const B = 1152 * 64;
  for (let i = 0; i < L.length; i += B) {
    const m = enc.encodeBuffer(L.subarray(i, i + B), R.subarray(i, i + B));
    if (m.length) parts.push(Buffer.from(m));
  }
  const f = enc.flush();
  if (f.length) parts.push(Buffer.from(f));
  return Buffer.concat(parts);
}

const credits = ["EMILGO Games: the music. Every track is CC0 (public domain) from OpenGameArt.org; no credit is required, given here anyway.", ""];
const decoded = {};
const list = [];
for (const [name, url, page, artist, title, lic, keep, from] of TRACKS) {
  const src = join(IN, url.split("/").pop());
  const buf = await fetchTo(url, src);
  const a = await decode(buf, url);
  decoded[name] = a;
  const s = shape(a, from, keep, 0.04, 2.5);
  const mp3 = encode(s, 96);
  writeFileSync(join(OUT, `${name}.mp3`), mp3);
  const secs = s.ch[0].length / s.rate;
  list.push({ name, title, artist, page, licence: lic, seconds: Math.round(secs), bytes: mp3.length });
  credits.push(`${name}.mp3  "${title}" by ${artist}, ${lic}. ${page}`);
  console.log(name.padEnd(10), title.padEnd(24), `${secs.toFixed(0)} s`, `${(mp3.length / 1024).toFixed(0)} KB`);
}
for (const [name, from, at, len] of STINGS) {
  const s = shape(decoded[from], at, len, 0.02, 2.2);
  const mp3 = encode(s, 128);
  writeFileSync(join(OUT, `${name}.mp3`), mp3);
  list.push({ name, title: `${from} (excerpt)`, seconds: len, bytes: mp3.length });
  credits.push(`${name}.mp3  an excerpt of ${from}.mp3`);
  console.log(name.padEnd(10), `excerpt of ${from}`, `${(mp3.length / 1024).toFixed(0)} KB`);
}
writeFileSync(join(OUT, "CREDITS.txt"), credits.join("\n") + "\n");
writeFileSync(join(OUT, "music.json"), JSON.stringify({ tracks: list }, null, 1));
