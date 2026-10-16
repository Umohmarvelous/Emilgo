// Mama's songs. Every one is an ORIGINAL composition, written for this game as
// note data and played by the synthesiser in sound.ts — no recordings, no files.
//
//   lullaby    "Mama's Lullaby"  a music box and a doll's voice, A minor, slow
//   mugunghwa  "Mugunghwa"       the traditional words of the Korean children's
//                                game (public domain, like "Red light, green
//                                light" itself) on a new pentatonic tune with
//                                gayageum plucks and janggu drum
//   naija      "Mama Say Waka"   Pidgin call and response, talking drum, agogo
//                                bell and shekere
//
// Not used, on purpose: any music, voice, recording or melody from the TV show
// Squid Game. Netflix owns them, and Lagos Life requires us to own everything
// in the game (Vatar Developer Agreement §3.3, §4(i)).
//
// Each song plays at its own fixed tempo and loops. It never speeds up and
// never "lands" on a turn: Mama cuts it wherever she likes. Some songs even sing
// "freeze" — a red herring. Watch HER.

export type SongId = "lullaby" | "mugunghwa" | "naija";
export type SongChoice = SongId | "shuffle";
export type VoiceKind = "doll" | "lead" | "crowd";
export type Instrument = "box" | "thump" | "pluck" | "janggu-low" | "janggu-high" | "bell-low" | "bell-high" | "shaker" | "talk" | "kick";

export interface SungNote {
  /** Start, in beats from the top of the song. */
  t: number;
  /** Length, beats. */
  d: number;
  midi: number;
  /** What is sung (shown on screen too). */
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
  blurb: string;
  bpm: number;
  /** Loop length, beats. */
  length: number;
  notes: SungNote[];
  hits: Hit[];
  /** Line breaks for the on-screen lyrics: the beat each line starts on. */
  lines: number[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Notes from compact rows: [beat, length, midi, text]. */
function sung(voice: VoiceKind, rows: [number, number, number, string][]): SungNote[] {
  return rows.map(([t, d, midi, text]) => ({ t, d, midi, text, voice }));
}

/** Repeat a one-bar pattern across `bars` bars of `beatsPerBar`. */
function every(bars: number, beatsPerBar: number, pattern: Omit<Hit, "t">[], offsets: number[]): Hit[] {
  const out: Hit[] = [];
  for (let b = 0; b < bars; b++) {
    offsets.forEach((o, i) => out.push({ ...pattern[i % pattern.length], t: b * beatsPerBar + o }));
  }
  return out;
}

// ── 1. Mama's Lullaby ────────────────────────────────────────────────────────

const LULLABY: Song = {
  id: "lullaby",
  title: "Mama's Lullaby",
  blurb: "A music box and a doll's voice. Slow, sweet, wrong.",
  bpm: 76,
  length: 16,
  lines: [0, 4, 8, 12],
  notes: sung("doll", [
    // "Small small, waka slow"
    [0, 1, 76, "Small"], [1, 0.5, 72, "small,"], [1.5, 0.5, 71, "wa"], [2, 0.5, 69, "ka"], [2.5, 1.5, 64, "slow"],
    // "Mama dey look, where you go?"
    [4, 0.5, 69, "Ma"], [4.5, 0.5, 72, "ma"], [5, 0.5, 71, "dey"], [5.5, 0.5, 69, "look,"], [6, 0.5, 68, "where"], [6.5, 0.5, 71, "you"], [7, 1, 76, "go?"],
    // "Hold your body, no shake o"
    [8, 1, 76, "Hold"], [9, 0.5, 74, "your"], [9.5, 0.5, 72, "bo"], [10, 0.5, 71, "dy,"], [10.5, 0.5, 69, "no"], [11, 0.5, 72, "shake"], [11.5, 0.5, 71, "o"],
    // "Mama see you… you don go."
    [12, 0.5, 64, "Ma"], [12.5, 0.5, 69, "ma"], [13, 0.5, 72, "see"], [13.5, 1, 71, "you…"], [14.5, 0.5, 68, "you"], [15, 0.5, 71, "don"], [15.5, 0.5, 69, "go."],
  ]),
  hits: [
    // Music box arpeggios: Am · E · F · E (the G♯ is what makes it uneasy).
    ...[
      [57, 64, 69, 72, 76, 72, 69, 64],
      [52, 59, 64, 68, 71, 68, 64, 59],
      [53, 60, 65, 69, 72, 69, 65, 60],
      [52, 59, 64, 68, 71, 68, 64, 59],
    ].flatMap((bar, b) => bar.map((midi, i) => ({ t: b * 4 + i * 0.5, kind: "box" as const, midi: midi + 12 }))),
    // A heartbeat under it.
    ...every(4, 4, [{ kind: "thump" }, { kind: "thump" }], [0, 0.35]),
  ],
};

// ── 2. Mugunghwa (traditional words, new tune) ───────────────────────────────

const MUGUNGHWA: Song = {
  id: "mugunghwa",
  title: "Mugunghwa",
  blurb: "The old Korean playground words on a brand-new tune. Gayageum and janggu.",
  bpm: 96,
  length: 16,
  lines: [0, 8],
  notes: sung("doll", [
    // mu-gung-hwa kko-chi pi-eot-seum-ni-da — falls, then lifts
    [0, 0.5, 74, "mu"], [0.5, 0.5, 74, "gung"], [1, 1, 72, "hwa"], [2, 0.5, 69, "kko"], [2.5, 0.5, 69, "chi"],
    [3, 0.5, 67, "pi"], [3.5, 0.5, 69, "eot"], [4, 0.5, 72, "seum"], [4.5, 0.5, 69, "ni"], [5, 2, 67, "da"],
    // and again, higher, ending up in the air
    [8, 1, 76, "mu"], [9, 0.5, 74, "gung"], [9.5, 0.5, 72, "hwa"], [10, 0.5, 74, "kko"], [10.5, 0.5, 72, "chi"],
    [11, 0.5, 69, "pi"], [11.5, 0.5, 72, "eot"], [12, 1, 74, "seum"], [13, 1, 76, "ni"], [14, 2, 74, "da"],
  ]),
  hits: [
    // Gayageum: a plucked pentatonic figure, one per beat.
    ...every(4, 4, [{ kind: "pluck", midi: 55 }, { kind: "pluck", midi: 62 }, { kind: "pluck", midi: 67 }, { kind: "pluck", midi: 62 }], [0, 1, 2, 3]),
    // Janggu: deong · kung · deok deok.
    ...every(4, 4, [{ kind: "janggu-low" }, { kind: "janggu-low" }, { kind: "janggu-high" }, { kind: "janggu-high" }, { kind: "janggu-high" }], [0, 1.5, 2, 3, 3.5]),
  ],
};

// ── 3. Mama Say Waka (Pidgin call and response) ──────────────────────────────

const NAIJA: Song = {
  id: "naija",
  title: "Mama Say Waka",
  blurb: "Pidgin call and response with talking drum. It sings “Freeze!” — don't trust it.",
  bpm: 112,
  length: 16,
  lines: [0, 4, 8, 12],
  notes: [
    // Call: "Mama say waka!" — Response: "We dey waka!"
    ...sung("lead", [[0, 0.33, 69, "Ma"], [0.33, 0.33, 69, "ma"], [0.67, 0.33, 71, "say"], [1, 0.5, 74, "wa"], [1.5, 0.5, 71, "ka!"]]),
    ...sung("crowd", [[2, 0.5, 66, "We"], [2.5, 0.5, 69, "dey"], [3, 0.5, 71, "wa"], [3.5, 0.5, 69, "ka!"]]),
    // "No shake body!" — "We no go shake!"
    ...sung("lead", [[4, 0.5, 74, "No"], [4.5, 0.5, 74, "shake"], [5, 0.5, 71, "bo"], [5.5, 0.5, 69, "dy!"]]),
    ...sung("crowd", [[6, 0.33, 66, "We"], [6.33, 0.33, 69, "no"], [6.67, 0.33, 69, "go"], [7, 1, 62, "shake!"]]),
    // "Who go reach first?" — "Na me! Na me!"
    ...sung("lead", [[8, 0.5, 74, "Who"], [8.5, 0.5, 76, "go"], [9, 0.5, 74, "reach"], [9.5, 0.5, 71, "first?"]]),
    ...sung("crowd", [[10, 0.5, 69, "Na"], [10.5, 0.5, 66, "me!"], [11, 0.5, 69, "Na"], [11.5, 0.5, 62, "me!"]]),
    // "Mama dey look o!" — "Gbam! Freeze!"
    ...sung("lead", [[12, 0.33, 69, "Ma"], [12.33, 0.33, 71, "ma"], [12.67, 0.33, 74, "dey"], [13, 0.5, 76, "look"], [13.5, 0.5, 74, "o!"]]),
    ...sung("crowd", [[14, 0.75, 62, "Gbam!"], [15, 1, 57, "Freeze!"]]),
  ],
  hits: [
    // Agogo bell, the timeline every other part hangs on.
    ...every(8, 2, [{ kind: "bell-high" }, { kind: "bell-high" }, { kind: "bell-low" }, { kind: "bell-high" }, { kind: "bell-low" }], [0, 0.5, 0.75, 1.25, 1.5]),
    // Shekere on every off-sixteenth.
    ...every(16, 1, [{ kind: "shaker" }, { kind: "shaker" }], [0.25, 0.75]),
    // Kick on the beat.
    ...every(16, 1, [{ kind: "kick" }], [0]),
    // Talking drum answers each call.
    ...[0, 4, 8, 12].flatMap((b) => [
      { t: b + 1, kind: "talk" as const, midi: 50 },
      { t: b + 1.5, kind: "talk" as const, midi: 47 },
    ]),
  ],
};

export const SONGS: Record<SongId, Song> = { lullaby: LULLABY, mugunghwa: MUGUNGHWA, naija: NAIJA };
export const SONG_IDS: SongId[] = ["lullaby", "mugunghwa", "naija"];

interface Line {
  starts: number[];
  words: string[];
}

const lineCache = new Map<SongId, Line[]>();

function linesOf(song: Song): Line[] {
  let lines = lineCache.get(song.id);
  if (!lines) {
    lines = song.lines.map((from, i) => {
      const to = song.lines[i + 1] ?? song.length;
      const notes = song.notes.filter((n) => n.t >= from && n.t < to).sort((a, b) => a.t - b.t);
      return { starts: notes.map((n) => n.t), words: notes.map((n) => n.text) };
    });
    lineCache.set(song.id, lines);
  }
  return lines;
}

/**
 * The lyric line at `beat` (looped) and how far into it the singing is.
 * `words` is the same array every call for a given line, so callers can
 * compare by reference and only redraw when the line changes.
 */
export function lyricsAt(song: Song, beat: number): { line: number; words: string[]; lit: number } {
  const p = ((beat % song.length) + song.length) % song.length;
  let line = 0;
  for (let i = 0; i < song.lines.length; i++) if (song.lines[i] <= p) line = i;
  const l = linesOf(song)[line];
  let lit = -1;
  for (let i = 0; i < l.starts.length; i++) if (l.starts[i] <= p) lit = i;
  return { line, words: l.words, lit };
}
