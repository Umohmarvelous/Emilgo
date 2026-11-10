// Recorded sound effects (v4 rework R8; the brief: "sound effects from sources
// online for everything"). CC0 recordings from OpenGameArt: real gunshots at a
// range, a handgun's reload, cannon and firework bangs, park birds, a river,
// wind, a crowd. Each shot is cut at its first transient, trimmed, evened and
// faded; loops are cut to a length and cross-faded end to start. MP3 (mono) into
// assets-site/lib/sfx/ with a manifest the game reads (src/audio/samples.ts):
// a listed sample takes over its synthesised sound.
//
//   node tools/audio/sfx.mjs        (sources in tools/audio/in/sfx/, fetched if missing)

import { MPEGDecoder } from "mpg123-decoder";
import { OggVorbisDecoder } from "@wasm-audio-decoders/ogg-vorbis";
import { Mp3Encoder } from "@breezystack/lamejs";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const IN = join(here, "in/sfx");
const OUT = join(here, "../../assets-site/lib/sfx");
mkdirSync(IN, { recursive: true });
mkdirSync(OUT, { recursive: true });

/** The sources: [local file, URL, page]. */
const SRC = {
  // v5: the owner asked for a new gunshot. CC0 ("None needed"), real shots with a little room on them.
  magnum: ["22 Magnum.wav", "https://opengameart.org/sites/default/files/22%20Magnum.wav", "https://opengameart.org/content/gunshots"],
  pistol22: ["22 Pistol.wav", "https://opengameart.org/sites/default/files/22%20Pistol.wav", "https://opengameart.org/content/gunshots"],
  powder: ["Black Powder.wav", "https://opengameart.org/sites/default/files/Black%20Powder.wav", "https://opengameart.org/content/gunshots"],
  unknown: ["Unkown.wav", "https://opengameart.org/sites/default/files/Unkown.wav", "https://opengameart.org/content/gunshots"],
  range: ["sounds.zip", "https://opengameart.org/sites/default/files/sounds.zip", "https://opengameart.org/content/gunshot-sounds"],
  bangs: ["25-CC0-bang-sfx.zip", "https://opengameart.org/sites/default/files/25-CC0-bang-sfx.zip", "https://opengameart.org/content/25-cc0-bang-firework-sfx"],
  reload: ["reload.wav", "https://opengameart.org/sites/default/files/reload.wav", "https://opengameart.org/content/handgun-reload-sound-effect"],
  arReload: ["assaultriflereload1_0.wav", "https://opengameart.org/sites/default/files/assaultriflereload1_0.wav", "https://opengameart.org/content/gun-reload-sounds"],
  pump: ["shotguncock_0.wav", "https://opengameart.org/sites/default/files/shotguncock_0.wav", "https://opengameart.org/content/gun-reload-sounds"],
  birds: ["birds-isaiah658_0.ogg", "https://opengameart.org/sites/default/files/birds-isaiah658_0.ogg", "https://opengameart.org/content/ambient-bird-sounds"],
  river: ["park_ambience_river.wav", "https://opengameart.org/sites/default/files/park_ambience_river.wav", "https://opengameart.org/content/park-ambiences"],
  wind: ["park_ambience_wind.wav", "https://opengameart.org/sites/default/files/park_ambience_wind.wav", "https://opengameart.org/content/park-ambiences"],
  crowd: ["applause-clapping-church-crowd-immersive.wav", "https://opengameart.org/sites/default/files/applause-clapping-church-crowd-immersive.wav", "https://opengameart.org/content/applause-in-a-large-hall-or-church"],
};

async function fetchTo(url, file) {
  if (existsSync(file)) return;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

/** A PCM WAV (8/16/24/32-bit int or 32-bit float), mixed to mono. */
function decodeWav(buf) {
  let o = 12;
  let fmt = null;
  while (o < buf.length - 8) {
    const id = buf.toString("ascii", o, o + 4);
    const len = buf.readUInt32LE(o + 4);
    if (id === "fmt ") fmt = { tag: buf.readUInt16LE(o + 8), ch: buf.readUInt16LE(o + 10), rate: buf.readUInt32LE(o + 12), bits: buf.readUInt16LE(o + 22) };
    if (id === "data") {
      const n = Math.floor(len / (fmt.bits / 8) / fmt.ch);
      const out = new Float32Array(n);
      const bps = fmt.bits / 8;
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < fmt.ch; c++) {
          const p = o + 8 + (i * fmt.ch + c) * bps;
          if (p + bps > buf.length) break;
          if (fmt.tag === 3) s += buf.readFloatLE(p);
          else if (bps === 2) s += buf.readInt16LE(p) / 32768;
          else if (bps === 3) s += buf.readIntLE(p, 3) / 8388608;
          else if (bps === 4) s += buf.readInt32LE(p) / 2147483648;
          else s += (buf[p] - 128) / 128;
        }
        out[i] = s / fmt.ch;
      }
      return { rate: fmt.rate, d: out };
    }
    o += 8 + len + (len & 1);
  }
  throw new Error("no data chunk");
}

async function decode(file) {
  const buf = readFileSync(file);
  if (file.endsWith(".wav")) return decodeWav(buf);
  const ogg = file.endsWith(".ogg");
  const dec = ogg ? new OggVorbisDecoder() : new MPEGDecoder();
  await dec.ready;
  const r = ogg ? await dec.decodeFile(new Uint8Array(buf)) : dec.decode(new Uint8Array(buf));
  dec.free();
  const ch = r.channelData;
  const d = new Float32Array(ch[0].length);
  for (let i = 0; i < d.length; i++) {
    let s = 0;
    for (const c of ch) s += c[i];
    d[i] = s / ch.length;
  }
  return { rate: r.sampleRate, d };
}

/** Resample (linear) to 44.1 kHz: the encoder's rate. */
function to44k(a) {
  if (a.rate === 44100) return a;
  const k = a.rate / 44100;
  const n = Math.floor(a.d.length / k);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * k;
    const j = Math.floor(x);
    d[i] = a.d[j] + ((a.d[j + 1] ?? a.d[j]) - a.d[j]) * (x - j);
  }
  return { rate: 44100, d };
}

/** The n-th shot's onset: where the level leaps after quiet (5 ms windows). */
function onset(a, nth = 0, from = 0) {
  const w = Math.round(a.rate * 0.005);
  const lv = [];
  for (let i = 0; i + w < a.d.length; i += w) {
    let m = 0;
    for (let j = i; j < i + w; j++) m = Math.max(m, Math.abs(a.d[j]));
    lv.push(m);
  }
  const peak = Math.max(...lv);
  let seen = -1;
  let quiet = 99;
  for (let k = Math.round(from * a.rate / w); k < lv.length; k++) {
    if (lv[k] > peak * 0.45 && quiet > 30) {
      seen++;
      if (seen === nth) return Math.max(0, k * w - Math.round(a.rate * 0.004));
      quiet = 0;
    }
    quiet = lv[k] < peak * 0.08 ? quiet + 1 : 0;
  }
  return 0;
}

/** Cut [at, at+len s], fade the tail (and a hair at the head), peak to −1 dBFS. */
function cut(a, at, len, tail = 0.35) {
  const n = Math.min(a.d.length - at, Math.round(len * a.rate));
  const d = a.d.slice(at, at + n);
  let pk = 0;
  for (const v of d) pk = Math.max(pk, Math.abs(v));
  const k = 0.89 / (pk || 1);
  const fi = Math.round(0.002 * a.rate);
  const fo = Math.round(tail * n);
  for (let i = 0; i < n; i++) {
    let g = k;
    if (i < fi) g *= i / fi;
    if (i > n - fo) g *= Math.pow((n - i) / fo, 1.6);
    d[i] *= g;
  }
  return { rate: a.rate, d };
}

/** A loop: [from, from+len], its end cross-faded into its start; RMS to `rms`. */
function loop(a, from, len, rms = 0.12) {
  const total = a.d.length / a.rate;
  len = Math.min(len, total - 0.5);
  from = Math.max(0, Math.min(from, total - len - 0.1));
  const s = Math.round(from * a.rate);
  const n = Math.min(a.d.length - s, Math.round(len * a.rate));
  const x = Math.round(Math.min(1.5, len / 6) * a.rate);
  const d = new Float32Array(n - x);
  for (let i = 0; i < d.length; i++) d[i] = a.d[s + i];
  for (let i = 0; i < x; i++) {
    const u = i / x;
    d[i] = d[i] * u + a.d[s + n - x + i] * (1 - u);
  }
  let sq = 0;
  for (const v of d) sq += v * v;
  const k = Math.min(rms / Math.sqrt(sq / d.length || 1), 4);
  for (let i = 0; i < d.length; i++) d[i] = Math.max(-0.95, Math.min(0.95, d[i] * k));
  return { rate: a.rate, d };
}

function mp3(a, kbps = 96) {
  const enc = new Mp3Encoder(1, a.rate, kbps);
  const pcm = new Int16Array(a.d.length);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(a.d[i] * 32767)));
  const parts = [];
  for (let i = 0; i < pcm.length; i += 1152 * 32) {
    const m = enc.encodeBuffer(pcm.subarray(i, i + 1152 * 32));
    if (m.length) parts.push(Buffer.from(m));
  }
  const f = enc.flush();
  if (f.length) parts.push(Buffer.from(f));
  return Buffer.concat(parts);
}

for (const [, [file, url]] of Object.entries(SRC)) await fetchTo(url, join(IN, file));
for (const z of ["sounds.zip", "25-CC0-bang-sfx.zip"]) execFileSync("unzip", ["-o", "-q", join(IN, z), "-d", join(IN, z.replace(".zip", ""))]);
const P = (f) => join(IN, f);
const L = async (f) => to44k(await decode(f));

const made = {};
const credits = ["EMILGO Games: recorded sound effects, all CC0 (public domain) from OpenGameArt.org.", "Thanks to cicifyre for the voice lines (credit appreciated, not required).", ""];
const put = (name, a, src, kbps) => {
  const b = mp3(a, kbps);
  writeFileSync(join(OUT, `${name}.mp3`), b);
  made[name] = `${name}.mp3`;
  credits.push(`${name}.mp3  from ${src}`);
  console.log(name.padEnd(14), `${(a.d.length / a.rate).toFixed(2)} s`, `${(b.length / 1024).toFixed(0)} KB`);
};

// Guns (v5): a new set. The first shot of each file, its echo faded early.
const mag = await L(P("22 Magnum.wav"));
const p22 = await L(P("22 Pistol.wav"));
const pow = await L(P("Black Powder.wav"));
const unk = await L(P("Unkown.wav"));
put("gun-pistol", cut(mag, onset(mag), 0.6, 0.6), SRC.magnum[2], 96);
put("gun-rifle", cut(unk, onset(unk), 0.7, 0.6), SRC.unknown[2], 96);
put("gun-smg", cut(p22, onset(p22), 0.32, 0.6), SRC.pistol22[2], 96);
put("gun-shotgun", cut(pow, onset(pow), 1.0, 0.6), SRC.powder[2], 96);
// The reloads, the blast.
const rl = await L(P("reload.wav"));
put("reload", cut(rl, 0, Math.min(2.2, rl.d.length / rl.rate), 0.15), SRC.reload[2], 80);
const ar = await L(P("assaultriflereload1_0.wav"));
put("reload-rifle", cut(ar, 0, Math.min(2.4, ar.d.length / ar.rate), 0.15), SRC.arReload[2], 80);
const pump = await L(P("shotguncock_0.wav"));
put("pump", cut(pump, 0, Math.min(1.2, pump.d.length / pump.rate), 0.2), SRC.pump[2], 80);
const boom = await L(P("25-CC0-bang-sfx/cannon_01.ogg"));
put("explosion", cut(boom, onset(boom), 2.6, 0.6), SRC.bangs[2], 96);
// The world's loops.
const birds = await L(P("birds-isaiah658_0.ogg"));
put("loop-birds", loop(birds, 2, 24, 0.1), SRC.birds[2], 64);
put("loop-gulls", loop(birds, 30, 18, 0.1), SRC.birds[2], 64);
const river = await L(P("park_ambience_river.wav"));
put("loop-water", loop(river, 2, 20, 0.12), SRC.river[2], 64);
const wind = await L(P("park_ambience_wind.wav"));
put("loop-turbine", loop(wind, 2, 16, 0.12), SRC.wind[2], 64);
const crowd = await L(P("applause-clapping-church-crowd-immersive.wav"));
put("loop-crowd", loop(crowd, 1, 14, 0.12), SRC.crowd[2], 64);
// v6 max: the body's effort sounds (the owner: "the sound a human makes when they jump, like they are using
// their energy"). A woman's short "hah!" shouts, CC0: cicifyre's Female RPG Voice Starter Pack (OpenGameArt),
// its "attack" lines. Pitched down (and so a touch longer) from a light voice to an adult soldier's. The host
// throttles the 8.8 MB zip, so the lines are taken from whatever part of it arrived (a zip's files come in
// order, each whole): tools/audio/in/sfx/rpgvoice/attack{1,2,3}.wav.
const VOICE_PAGE = "https://opengameart.org/content/female-rpg-voice-starter-pack (cicifyre, CC0)";
/** Resample by k (< 1: lower and longer), as a tape played slower. */
function slower(a, k) {
  const n = Math.floor(a.d.length / k);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * k;
    const j = Math.floor(x);
    d[i] = a.d[j] + ((a.d[j + 1] ?? a.d[j]) - a.d[j]) * (x - j);
  }
  return { rate: a.rate, d };
}
/** Trim the silence before the voice and after it (−40 dB), a 4 ms lead kept. */
function trimVoice(a) {
  let pk = 0;
  for (const v of a.d) pk = Math.max(pk, Math.abs(v));
  const th = pk * 0.01;
  let i0 = 0;
  while (i0 < a.d.length && Math.abs(a.d[i0]) < th) i0++;
  let i1 = a.d.length - 1;
  while (i1 > i0 && Math.abs(a.d[i1]) < th) i1--;
  return { rate: a.rate, d: a.d.slice(Math.max(0, i0 - Math.round(0.004 * a.rate)), i1 + 1) };
}
const rpg = (f) => join(IN, "rpgvoice", f);
if (existsSync(rpg("attack1.wav"))) {
  // Three takes, each lower by its own amount so they don't sound like one clip.
  const ks = { "voice-jump": ["attack1.wav", 0.78], "voice-jump2": ["attack3.wav", 0.9], "voice-jump3": ["attack2.wav", 0.8] };
  for (const [name, [f, k]] of Object.entries(ks)) {
    const a = slower(trimVoice(await L(rpg(f))), k);
    put(name, cut(a, 0, a.d.length / a.rate, 0.3), VOICE_PAGE, 64);
  }
  // The melee swing's grunt: the deepest take, shorter.
  const sw = slower(trimVoice(await L(rpg("attack3.wav"))), 0.82);
  put("voice-swing", cut(sw, 0, Math.min(0.36, sw.d.length / sw.rate), 0.4), VOICE_PAGE, 64);
}

// The club: a stretch of a downloaded track (the music tool's), mono.
const club = join(here, "../../assets-site/music/rush.mp3");
if (existsSync(club)) put("loop-club", loop(await L(club), 30, 32, 0.16), "music/rush.mp3 (Vitalezzz, Virtual Rush, CC0)", 64);

writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ sounds: made }, null, 1));
writeFileSync(join(OUT, "CREDITS.txt"), credits.join("\n") + "\n");
