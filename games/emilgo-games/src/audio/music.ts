// The score (v4 rework R8): real tracks from online (CC0, OpenGameArt; see
// tools/audio/music.mjs and assets-site/music/CREDITS.txt) in place of the
// synthesised pad the owner disliked. Streamed (an <audio> element each, into
// the music bus through a MediaElementSource), so a five-minute track costs no
// decoded memory on a phone.
//
//   lobby    the menus and the lobby
//   explore  Free For All, nothing happening       (Dead Streets: dead)
//   combat   a shot, a hit or a claw near you      (Dead Streets: deadFight)
//   final    the final circle
//   low      under 30 health: the current track, low-passed
//   victory / defeat   one-shot stings at the end
//
// Each track resumes where it left off when it comes back (combat and calm
// trade places often); changes crossfade over 1.6 s. With no network (the
// app offline) the files don't load and the game simply has no score.

import type { Sound } from "./sound";

export type Track = "lobby" | "explore" | "combat" | "final" | "rush" | "dead" | "deadFight";
type Sting = "victory" | "defeat";

/** Where the files are: the site's own /music/ (dev, web); the EMILGO app's offline copy streams them from the site. */
const BASE =
  (import.meta.env.VITE_MUSIC_BASE as string | undefined) ??
  (__HOST_BUILD__ === "emilgo" ? "https://milgogames.pages.dev/music/" : `${import.meta.env.BASE_URL}music/`);

interface Voice {
  el: HTMLAudioElement;
  gain: GainNode;
  ok: boolean;
}

const FADE = 1.6;

export class Music {
  private voices = new Map<string, Voice>();
  private now: Track | null = null;
  private filter: BiquadFilterNode | null = null;
  private low = false;

  constructor(private readonly sound: Sound) {}

  private voice(name: string, loop: boolean): Voice | null {
    const g = this.sound.graph;
    if (!g) return null;
    let v = this.voices.get(name);
    if (v) return v;
    if (!this.filter) {
      this.filter = g.ctx.createBiquadFilter();
      this.filter.type = "lowpass";
      this.filter.frequency.value = 18000;
      this.filter.connect(g.music);
    }
    const el = new Audio();
    el.crossOrigin = "anonymous";
    el.preload = "auto";
    el.loop = loop;
    el.src = `${BASE}${name}.mp3`;
    const gain = g.ctx.createGain();
    gain.gain.value = 0;
    try {
      g.ctx.createMediaElementSource(el).connect(gain).connect(this.filter);
    } catch {
      return null;
    }
    v = { el, gain, ok: true };
    el.addEventListener("error", () => (v!.ok = false));
    this.voices.set(name, v);
    return v;
  }

  /** Play a track (null: silence), crossfading from whatever is on. */
  play(track: Track | null): void {
    if (track === this.now) return;
    const g = this.sound.graph;
    if (!g) return;
    const t = g.ctx.currentTime;
    const old = this.now ? this.voices.get(this.now) : null;
    if (old) {
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setTargetAtTime(0, t, FADE / 4);
      const el = old.el;
      const was = this.now;
      setTimeout(() => {
        if (this.now !== was) el.pause();
      }, FADE * 1000 + 200);
    }
    this.now = track;
    if (!track) return;
    const v = this.voice(track, true);
    if (!v || !v.ok) return;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(1, t, FADE / 4);
    void v.el.play().catch(() => {});
  }

  /** Under 30 health: muffle whatever plays. */
  setLow(on: boolean): void {
    if (on === this.low || !this.filter) return;
    this.low = on;
    const g = this.sound.graph!;
    this.filter.frequency.setTargetAtTime(on ? 420 : 18000, g.ctx.currentTime, 0.4);
  }

  /** The end of a match: the score stops and the sting plays once. */
  sting(s: Sting): void {
    this.play(null);
    const v = this.voice(s, false);
    if (!v || !v.ok) return;
    const g = this.sound.graph!;
    v.el.currentTime = 0;
    v.gain.gain.cancelScheduledValues(g.ctx.currentTime);
    v.gain.gain.setValueAtTime(1, g.ctx.currentTime);
    void v.el.play().catch(() => {});
  }

  /** Paused (the pause menu, a hidden tab): everything stops; resume() carries on. */
  hush(on: boolean): void {
    const v = this.now ? this.voices.get(this.now) : null;
    if (!v) return;
    if (on) v.el.pause();
    else void v.el.play().catch(() => {});
  }

  get playing(): Track | null {
    return this.now;
  }
}
