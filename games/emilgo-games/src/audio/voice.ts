// The announcer (v5, 3.6; the owner: "a Chinese girl voice giving the player
// direction ... like cod", and "an AI voice to announce every player that is
// eliminated"). Settled: English with a Mandarin accent, an adult woman's voice.
//
// How it speaks, best first:
//   1. Recorded lines (v6 2.12: one voice on every phone, like COD): the site's
//      /voice/index.json lists the line ids it has, each <id>.mp3 beside it
//      (about 30 clips of a few KB, fetched once the lobby shows; played through
//      the game's own audio, so the volume and the pause apply). The owner makes
//      them once on the Mac with an open-licence speech model:
//      tools/audio/voice.sh (Kokoro-82M, Apache-2.0) → assets-site/voice/.
//   2. The phone's own speech voice (the Web Speech API) for a line the site
//      hasn't got: a Mandarin woman's voice reading the English where the phone
//      has one (iPhones: Tingting, Meijia; Android: the Google Chinese voice;
//      Windows: Xiaoxiao), else an English woman's voice.
//   3. Nothing (an app's web view without speech): the lines stay as text in
//      the feed, as before.
//
// Two voices (v7 2.10, Settings → Announcer voice): the Mandarin-accented
// woman above, or an American woman. Each has its own recorded set (voice/ and
// voice-us/, tools/audio/voice.sh and SET=us) and its own pick of phone voice.
//
// Names are never spoken (they can't be recorded ahead): she says "Enemy
// eliminated" and the name shows on screen, as COD does.
//
// Lines queue (at most two waiting; a stale one is dropped), the same line not
// twice within its cooldown, the music ducks while she speaks.

import type { Music } from "./music";
import type { Sound } from "./sound";

export type LineId =
  | "start_treasure" | "start_flag" | "start_hold" | "start_deliver" | "start_rally" | "start_royale" | "start_generic"
  | "zone_closing" | "zone_outside" | "zone_final" | "time_two" | "time_thirty"
  | "tre_found" | "tre_all" | "tre_upload" | "tre_enemy_upload" | "tre_lost" | "tre_mate" | "tre_exposed"
  | "flag_taken" | "flag_enemy" | "airdrop" | "print" | "serum"
  | "you_down" | "enemy_down" | "mate_down" | "tre_carrier" | "victory" | "defeat";

/** What each line says (the recorded clip says the same). */
export const LINES: Record<LineId, string> = {
  start_treasure: "Find the four treasures, and upload them at the machine.",
  start_flag: "Capture the flag and hold position. Do not reveal your location.",
  start_hold: "Take the flag and hold it. Every second counts.",
  start_deliver: "Grab the flags, and deliver them to the drop zones.",
  start_rally: "Stay with your squad. Take the rally point.",
  start_royale: "Last squad standing wins. Stay alive.",
  start_generic: "Mission start. Good luck.",
  zone_closing: "The safe zone is closing. Move.",
  zone_outside: "You are outside the safe zone.",
  zone_final: "Final circle.",
  time_two: "Two minutes remaining.",
  time_thirty: "Thirty seconds.",
  tre_found: "Treasure found.",
  tre_all: "All four treasures found. Get to the machine.",
  tre_upload: "Upload started. Hold the ring.",
  tre_enemy_upload: "Enemy uploading. Stop them.",
  tre_lost: "You lost your treasures.",
  tre_mate: "Your teammate found a treasure.",
  tre_exposed: "Your find exposed you. Move.",
  flag_taken: "You have the flag.",
  flag_enemy: "The enemy has the flag.",
  airdrop: "Supply drop incoming.",
  print: "Map print active.",
  serum: "Titan serum. You are stronger.",
  you_down: "You have been eliminated.",
  enemy_down: "Enemy eliminated.",
  mate_down: "Teammate eliminated.",
  tre_carrier: "An enemy is one treasure away. Check your compass.",
  victory: "Victory.",
  defeat: "Mission failed.",
};

/** Seconds before the same line may be said again. */
const COOLDOWN: Partial<Record<LineId, number>> = { zone_outside: 25, tre_found: 4, tre_mate: 4, airdrop: 20, flag_enemy: 15, tre_enemy_upload: 10, enemy_down: 2.2, mate_down: 3, tre_carrier: 20 };
/** A line still waiting after this long isn't worth saying. */
const STALE_MS = 3500;
/** The clips' fetch waits this long after the lobby shows (the lobby's own downloads first). */
const PREFETCH_MS = 1500;

/** The site's recorded lines (the app streams them from the site, like the music). */
const BASE =
  (import.meta.env.VITE_VOICE_BASE as string | undefined) ??
  (__HOST_BUILD__ === "emilgo" ? "https://milgogames.pages.dev/voice/" : `${import.meta.env.BASE_URL}voice/`);

/** v7 (2.10): the two announcers. */
export type VoiceSet = "zh" | "us";
/** Each set's folder: the American's sits beside the Mandarin-accented one's. */
const baseOf = (set: VoiceSet): string => (set === "us" ? BASE.replace(/voice\/?$/, "voice-us/") : BASE);

interface Said {
  text: string;
  clip: LineId;
  at: number;
  /** Interrupts what's being said (the end of a match). */
  urgent: boolean;
}

/**
 * Women's voices by name, best first (the platforms don't say which voices are
 * women's): Mandarin ones for the accent, then English ones. Apple: Tingting,
 * Yu-shu, Meijia, Sinji, Flo, Shelley, Sandy; Google: 普通话; Microsoft:
 * Xiaoxiao, Huihui, Yaoyao.
 */
const ZH_WOMEN = [/tingting|ting-ting/i, /google 普通话/i, /xiaoxiao/i, /yu-shu/i, /huihui/i, /yaoyao/i, /meijia|mei-jia/i, /sinji|hiumaan/i, /google 國語/i, /^flo\b/i, /^shelley\b/i, /^sandy\b/i];
const EN_WOMEN = /samantha|karen|moira|tessa|victoria|zira|aria|jenny|google us english|google uk english female|serena|fiona|catherine|kathy/i;
/** Mandarin men's voices on Apple: never picked while a woman's is there. */
const ZH_MEN = /li-mu|eddy|grandpa|reed|rocko|yunyang|kangkang/i;
/** American women's voices, best first: Apple, Google, Microsoft. */
const US_WOMEN = [/^samantha\b/i, /^ava\b/i, /^allison\b/i, /^susan\b/i, /^nicky\b/i, /google us english/i, /\baria\b/i, /\bjenny\b/i, /\bzira\b/i, /\bmichelle\b/i];
/** American men's voices: never picked while a woman's is there. */
const US_MEN = /\balex\b|\bfred\b|\btom\b|\baaron\b|\bguy\b|\bdavid\b|\bmark\b|\bchristopher\b|\beric\b|\bjunior\b|\bralph\b/i;

export class Voice {
  enabled = true;
  /** Whose voice (Settings → Announcer voice). */
  private set: VoiceSet = "zh";
  private queue: Said[] = [];
  private speaking = false;
  private readonly last = new Map<string, number>();
  private picked: SpeechSynthesisVoice | null = null;
  private clips: Set<string> | null = null;
  private clipsAsked = false;
  /** Each clip's bytes (fetched after the lobby shows), then its sound (decoded on first use). */
  private readonly bytes = new Map<string, Promise<ArrayBuffer | null>>();
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly synth: SpeechSynthesis | null = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;

  constructor(
    private readonly sound: Sound,
    private readonly music: Music,
  ) {
    this.synth?.addEventListener?.("voiceschanged", () => (this.picked = null));
  }

  /** Say a line now or next (dropped when off, too soon again, or the queue is full). */
  say(id: LineId, urgent = false): void {
    if (!this.enabled) return;
    const now = performance.now();
    const cd = (COOLDOWN[id] ?? 2) * 1000;
    if (now - (this.last.get(id) ?? -1e9) < cd) return;
    this.last.set(id, now);
    this.push({ text: LINES[id], clip: id, at: now, urgent });
  }

  /** Someone out: you, a teammate, an enemy (the name is on screen; at most one every 2.2 s in a big fight). */
  eliminated(who: "you" | "mate" | "enemy"): void {
    this.say(who === "you" ? "you_down" : who === "mate" ? "mate_down" : "enemy_down");
  }

  /**
   * v7 (2.10): switch announcer. The other's clips are let go and this one's
   * fetched the next time the lobby asks (or now, if it already has).
   */
  use(set: VoiceSet): void {
    if (set === this.set) return;
    this.set = set;
    this.picked = null;
    this.clips = null;
    this.bytes.clear();
    this.buffers.clear();
    const asked = this.clipsAsked;
    this.clipsAsked = false;
    if (asked) this.prepare();
  }

  /** Say a line straight away, past the cooldown: Settings plays it when the voice changes. */
  preview(): void {
    this.last.delete("start_generic");
    this.say("start_generic", true);
  }

  /** Stop everything (leaving a match). */
  hush(): void {
    this.queue = [];
    this.synth?.cancel();
    this.speaking = false;
    this.music.duck(false);
  }

  /**
   * Learn which recorded lines the site has and fetch them (once; a missing list
   * is no clips). The lobby calls it, so the clips are in before a match starts.
   */
  prepare(delayMs = 0): void {
    if (this.clipsAsked) return;
    this.clipsAsked = true;
    const set = this.set;
    window.setTimeout(() => {
      fetch(`${baseOf(set)}index.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: unknown) => {
          // Switched again while this was on its way: the newer set's list wins.
          if (set !== this.set) return;
          const ids = Array.isArray(j) ? j.filter((x): x is string => typeof x === "string" && x in LINES) : [];
          this.clips = new Set(ids);
          for (const id of ids) this.fetchClip(id);
        })
        .catch(() => set === this.set && (this.clips = new Set()));
    }, delayMs);
  }

  /** prepare(), a beat after the lobby shows. */
  prefetch(): void {
    this.prepare(PREFETCH_MS);
  }

  private fetchClip(id: string): Promise<ArrayBuffer | null> {
    let p = this.bytes.get(id);
    if (!p) {
      p = fetch(`${baseOf(this.set)}${id}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null);
      this.bytes.set(id, p);
    }
    return p;
  }

  private push(s: Said): void {
    if (s.urgent) {
      this.queue = [s];
      this.synth?.cancel();
      this.speaking = false;
    } else {
      if (this.queue.length >= 2) return;
      this.queue.push(s);
    }
    this.next();
  }

  private next(): void {
    if (this.speaking) return;
    let s: Said | undefined;
    while ((s = this.queue.shift()) && performance.now() - s.at > STALE_MS && !s.urgent);
    if (!s) return;
    this.speaking = true;
    this.music.duck(true);
    const done = () => {
      this.speaking = false;
      if (!this.queue.length) this.music.duck(false);
      this.next();
    };
    if (this.clips?.has(s.clip)) void this.playClip(s.clip).then((ok) => (ok ? done() : this.speak(s!.text, done)));
    else this.speak(s.text, done);
  }

  private speak(text: string, done: () => void): void {
    try {
      this.speakNow(text, done);
    } catch {
      // A speech engine that throws (a broken voice, a web view without one) never jams the queue.
      done();
    }
  }

  private speakNow(text: string, done: () => void): void {
    const sy = this.synth;
    if (!sy || this.sound.muted) return done();
    const u = new SpeechSynthesisUtterance(text);
    const v = this.voice();
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else u.lang = "en-US";
    // A calm, clear operator: a touch quick, a touch high (the American: her own pitch).
    u.rate = 1.04;
    u.pitch = this.set === "us" ? 1 : 1.08;
    u.volume = Math.min(1, this.sound.levelOf("sfx") * 1.1);
    let over = false;
    const end = () => {
      if (over) return;
      over = true;
      clearTimeout(guard);
      done();
    };
    u.onend = end;
    u.onerror = end;
    // Some engines never say they've finished.
    const guard = window.setTimeout(end, 1200 + text.length * 90);
    try {
      sy.speak(u);
    } catch {
      end();
    }
  }

  /**
   * The voice. Mandarin-accented: a Mandarin woman's, else any Mandarin, else an
   * English woman's, else English. American: an American woman's, else any
   * American but a man's, else an English woman's, else English.
   */
  private voice(): SpeechSynthesisVoice | null {
    if (this.picked) return this.picked;
    const all = this.synth?.getVoices() ?? [];
    if (this.set === "us") {
      const us = all.filter((v) => /^en[-_]us/i.test(v.lang));
      const en = all.filter((v) => /^en/i.test(v.lang));
      let best: SpeechSynthesisVoice | undefined;
      for (const re of US_WOMEN) if ((best = us.find((v) => re.test(v.name)))) break;
      this.picked = best ?? us.find((v) => !US_MEN.test(v.name)) ?? en.find((v) => EN_WOMEN.test(v.name)) ?? us[0] ?? en[0] ?? null;
      return this.picked;
    }
    const zh = all.filter((v) => /^zh|^cmn/i.test(v.lang));
    const en = all.filter((v) => /^en/i.test(v.lang));
    let best: SpeechSynthesisVoice | undefined;
    for (const re of ZH_WOMEN) if ((best = zh.find((v) => re.test(v.name)))) break;
    this.picked = best ?? zh.find((v) => !ZH_MEN.test(v.name) && /cn|hans/i.test(v.lang)) ?? en.find((v) => EN_WOMEN.test(v.name)) ?? zh[0] ?? en[0] ?? null;
    return this.picked;
  }

  private playClip(id: LineId): Promise<boolean> {
    const g = this.sound.graph;
    if (!g) return Promise.resolve(false);
    let p = this.buffers.get(id);
    if (!p) {
      // A copy decoded: decoding takes the bytes over.
      p = this.fetchClip(id)
        .then((b) => (b ? g.ctx.decodeAudioData(b.slice(0)) : null))
        .catch(() => null);
      this.buffers.set(id, p);
    }
    return p.then(
      (buf) =>
        new Promise<boolean>((ok) => {
          if (!buf) return ok(false);
          const src = g.ctx.createBufferSource();
          src.buffer = buf;
          src.connect(g.sfx);
          // A suspended audio context (a phone call, iOS after an interruption) never ends a clip: the queue moves on anyway.
          const guard = window.setTimeout(() => ok(true), buf.duration * 1000 + 600);
          src.onended = () => {
            clearTimeout(guard);
            ok(true);
          };
          src.start();
        }),
    );
  }
}
