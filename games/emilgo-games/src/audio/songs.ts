// The doll's song: the traditional call of the Korean children's game
// "Mugunghwa kkochi pieotseumnida" (the hibiscus has bloomed) — the playground
// game the world knows as Red Light, Green Light. The words are traditional
// and public domain; the tune is the plain sol–mi playground chant children
// everywhere call their games with, written here as note data and sung by the
// synthesiser in sound.ts — no recordings, no files.
//
// Not used, on purpose: the music, voice, recording or melody of the TV show
// Squid Game. Netflix owns them, and Lagos Life requires us to own everything
// in the game (Vatar Developer Agreement §3.3, §4(i)).
//
// Like a real caller, she teases: one call at an easy pace, one rushed, one
// drawn out, one with the last syllable held. It never "lands" on a turn: she
// cuts it wherever she likes (with a hum first, which may be a lie). Nothing on
// screen names it or shows the words (SPEC-V2 §3.6).

export type SongId = "mugunghwa";
/** Older saves stored a choice ("shuffle", other songs): all of them now mean the one song. */
export type SongChoice = SongId | "shuffle";
export type VoiceKind = "doll" | "lead" | "crowd";
export type Instrument = "box" | "thump" | "pluck" | "janggu-low" | "janggu-high" | "bell-low" | "bell-high" | "shaker" | "talk" | "kick";

export interface SungNote {
  /** Start, in beats from the top of the song. */
  t: number;
  /** Length, beats. */
  d: number;
  midi: number;
  /** The syllable sung (it shapes the vowel; never shown). */
  text: string;
  voice: VoiceKind;
}

export interface Hit {
  t: number;
  kind: Instrument;
  midi?: number;
  d?: number;
}

export interface Song {
  id: SongId;
  title: string;
  bpm: number;
  /** Loop length, beats. */
  length: number;
  notes: SungNote[];
  hits: Hit[];
}

// ── The call ─────────────────────────────────────────────────────────────────

const SYL = ["mu", "gung", "hwa", "kko", "chi", "pi", "eot", "seum", "ni", "da"];
/** Sol–mi playground chant (G4 67, E4 64, A4 69): mu-gung-hwa · kko-chi · pi-eot-seum-ni-da. */
const PITCH = [67, 67, 64, 67, 64, 67, 69, 67, 64, 64];
/** Each syllable's length in beats at an easy pace; the last one held. */
const BEATS = [0.5, 0.5, 1, 0.5, 1, 0.5, 0.5, 0.5, 0.5, 1.5];

/** One call from beat `t`, its pace stretched by `k` (< 1 rushed, > 1 drawn out); `hold` stretches the last syllable. */
function call(t: number, k: number, hold: number): SungNote[] {
  const out: SungNote[] = [];
  let at = t;
  SYL.forEach((text, i) => {
    const d = BEATS[i] * k * (i === SYL.length - 1 ? hold : 1);
    out.push({ t: at, d, midi: PITCH[i], text, voice: "doll" });
    at += d;
  });
  return out;
}

const PACES: [pace: number, hold: number][] = [
  [1, 1], // easy
  [0.55, 1], // rushed
  [1.45, 1], // drawn out
  [0.9, 2.4], // the last syllable held… and held
];

const NOTES: SungNote[] = [];
let beat = 0;
for (const [k, hold] of PACES) {
  const c = call(beat, k, hold);
  NOTES.push(...c);
  const last = c[c.length - 1];
  beat = last.t + last.d + 1; // a breath between calls
}

const MUGUNGHWA: Song = {
  id: "mugunghwa",
  title: "Mugunghwa",
  bpm: 100,
  length: Math.ceil(beat),
  notes: NOTES,
  // A faint music box on each call's first and last syllables: a doll's song.
  hits: NOTES.filter((_, i) => i % SYL.length === 0 || i % SYL.length === SYL.length - 1).map((n) => ({ t: n.t, kind: "box" as const, midi: n.midi + 12 })),
};

export const SONGS: Record<SongId, Song> = { mugunghwa: MUGUNGHWA };
export const SONG_IDS: SongId[] = ["mugunghwa"];
