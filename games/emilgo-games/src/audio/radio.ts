// The car radio (SPEC-V3 §5): three short loops written here for EMILGO and
// played by the synthesiser in sound.ts, the way the doll's songs are — no
// recordings, nothing borrowed. Highlife (a bright guitar over a bell), an
// afrobeats-style groove (a syncopated kick, a log-drum bass, shakers) and a
// fuji-style one (talking drum and sakara-like thumps over bells).
//
// The radio is yours: only the phone in the car hears it, and it stops when
// you get out.

import type { Hit, Song } from "./songs";

export type RadioId = "highlife" | "afrobeats" | "fuji";
export const RADIO_IDS: readonly RadioId[] = ["highlife", "afrobeats", "fuji"];
export const RADIO_NAME: Record<RadioId, string> = { highlife: "Highlife", afrobeats: "Afrobeats", fuji: "Fuji" };

const every = (step: number, length: number, kind: Hit["kind"], from = 0): Hit[] => {
  const out: Hit[] = [];
  for (let t = from; t < length; t += step) out.push({ t, kind });
  return out;
};

// ── Highlife: C – F – G – C, the guitar picking each chord up the neck ──

const HL_CHORDS = [
  [60, 64, 67, 72],
  [65, 69, 72, 77],
  [67, 71, 74, 79],
  [60, 64, 67, 72],
];
const highlifeHits: Hit[] = [];
HL_CHORDS.forEach((ch, bar) => {
  const b = bar * 4;
  // A rolling pick: root, fifth, third, octave, the fifth again.
  [0, 0.5, 1, 1.5, 2, 2.75, 3, 3.5].forEach((t, i) => highlifeHits.push({ t: b + t, kind: "pluck", midi: ch[[0, 2, 1, 3, 2, 1, 3, 2][i]] }));
  highlifeHits.push({ t: b, kind: "kick" }, { t: b + 2, kind: "kick" });
});
// The bell's two-bar pattern.
for (const t of [0, 1, 1.5, 2.5, 3, 4, 5, 5.5, 6.5, 7, 8, 9, 9.5, 10.5, 11, 12, 13, 13.5, 14.5, 15]) highlifeHits.push({ t, kind: "bell-high" });
highlifeHits.push(...every(0.5, 16, "shaker", 0.25));

const HIGHLIFE: Song = { id: "highlife", title: "Highlife", bpm: 116, length: 16, notes: [], hits: highlifeHits };

// ── Afrobeats-style: a minor groove, the kick off the beat, a log-drum bass ──

const ab: Hit[] = [];
for (let bar = 0; bar < 4; bar++) {
  const b = bar * 4;
  for (const t of [0, 1.5, 2.5, 3.25]) ab.push({ t: b + t, kind: "kick" });
  ab.push({ t: b + 1, kind: "janggu-high" }, { t: b + 3, kind: "janggu-high" });
  // The log-drum bass line.
  const bass = [45, 45, 48, 43][bar];
  for (const [t, d] of [[0.5, 0], [1.75, 3], [2.75, 5], [3.5, 3]] as const) ab.push({ t: b + t, kind: "talk", midi: bass + d });
  // Chord stabs.
  for (const t of [0.75, 2.25]) for (const n of [57, 60, 64]) ab.push({ t: b + t, kind: "pluck", midi: n + (bar === 2 ? 3 : bar === 3 ? -2 : 0) });
}
ab.push(...every(0.25, 16, "shaker"));
const AFROBEATS: Song = { id: "afrobeats", title: "Afrobeats", bpm: 104, length: 16, notes: [], hits: ab };

// ── Fuji-style: talking drum calls over a running bell and low thumps ──

const fj: Hit[] = [];
const CALL = [62, 62, 57, 60, 62, 55, 57, 57];
for (let bar = 0; bar < 4; bar++) {
  const b = bar * 4;
  CALL.forEach((n, i) => fj.push({ t: b + i * 0.5, kind: "talk", midi: n - (bar % 2) * 2 }));
  for (const t of [0, 0.75, 2, 2.75]) fj.push({ t: b + t, kind: "thump" });
  for (const t of [0.5, 1.25, 2.5, 3.25]) fj.push({ t: b + t, kind: "janggu-low" });
}
fj.push(...every(0.5, 16, "bell-low"), ...every(1, 16, "bell-high", 0.75), ...every(0.25, 16, "shaker", 0.125));
const FUJI: Song = { id: "fuji", title: "Fuji", bpm: 128, length: 16, notes: [], hits: fj };

export const RADIO: Record<RadioId, Song> = { highlife: HIGHLIFE, afrobeats: AFROBEATS, fuji: FUJI };
