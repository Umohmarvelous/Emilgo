// The score (v5): CC0 8-bit tracks (tools/audio/music.mjs, assets-site/music/).
//
// The owner's "the music keeps skipping" had two causes, both gone:
//   1. It streamed through <audio> elements, so a slow network or a busy main
//      thread stuttered it. Now each track is fetched and decoded whole, then
//      played by the audio thread, scheduled seconds ahead: nothing on the page
//      can interrupt it.
//   2. It jumped between tracks whenever a shot was fired (calm ↔ combat, each
//      resuming mid-song). Now one track plays for the whole match; only the
//      final circle changes it (audio/world.ts).
//
//   lobby    the menus and the lobby           menu   the room and loading
//   explore / explore2 / rush   a match (one picked per match)
//   final    the final circle                  dead   Dead Streets
//   ending   the results after a win
//   victory / defeat   one-shot jingles
//
// With no network (the app offline) the files don't load and there's no score.

import type { Sound } from "./sound";

export type Track = "lobby" | "menu" | "explore" | "explore2" | "rush" | "final" | "dead" | "ending";
type Sting = "victory" | "defeat";

/** Where the files are: the site's own /music/ (dev, web); the EMILGO app's offline copy streams them from the site. */
const BASE =
  (import.meta.env.VITE_MUSIC_BASE as string | undefined) ??
  (__HOST_BUILD__ === "emilgo" ? "https://milgogames.pages.dev/music/" : `${import.meta.env.BASE_URL}music/`);

const FADE = 1.2;
/** A loop's ends overlap by this much: an MP3 has a sliver of silence at each end, and this hides it. */
const OVERLAP = 0.09;
/** Keep the next pass of a loop scheduled this far ahead (a hidden tab's timers run about once a second). */
const AHEAD = 4;
/** Decoded tracks kept (a decoded track is 10–20 MB). */
const KEEP = 3;

interface Playing {
  track: Track;
  buf: AudioBuffer;
  gain: GainNode;
  /** When the pass now scheduled last ends, on the audio clock. */
  nextAt: number;
  /** Where in the track the audio clock's `t0` is. */
  t0: number;
  sources: AudioBufferSourceNode[];
}

export class Music {
  private readonly loaded = new Map<string, Promise<AudioBuffer | null>>();
  private now: Track | null = null;
  private cur: Playing | null = null;
  private filter: BiquadFilterNode | null = null;
  /** v5: the score dips under the announcer's voice. */
  private ducker: GainNode | null = null;
  private low = false;
  private hushed = false;
  private gen = 0;
  private timer = 0;
  /** Where each track was when it stopped: it carries on from there. */
  private readonly pos = new Map<string, number>();

  constructor(private readonly sound: Sound) {}

  private load(name: string): Promise<AudioBuffer | null> {
    const g = this.sound.graph;
    if (!g) return Promise.resolve(null);
    let p = this.loaded.get(name);
    if (!p) {
      p = fetch(`${BASE}${name}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => g.ctx.decodeAudioData(b))
        .catch(() => {
          this.loaded.delete(name);
          return null;
        });
      this.loaded.set(name, p);
      // The oldest other than what's playing goes.
      for (const k of this.loaded.keys()) {
        if (this.loaded.size <= KEEP) break;
        if (k !== name && k !== this.now && k !== "victory" && k !== "defeat") this.loaded.delete(k);
      }
    }
    return p;
  }

  private out(): BiquadFilterNode | null {
    const g = this.sound.graph;
    if (!g) return null;
    if (!this.filter) {
      this.filter = g.ctx.createBiquadFilter();
      this.filter.type = "lowpass";
      this.filter.frequency.value = 18000;
      this.ducker = g.ctx.createGain();
      this.filter.connect(this.ducker).connect(g.music);
    }
    return this.filter;
  }

  /** Play a track (null: silence), crossfading from whatever is on. */
  play(track: Track | null): void {
    if (track === this.now) return;
    const g = this.sound.graph;
    if (!g) return;
    this.fadeOut(FADE);
    this.now = track;
    const gen = ++this.gen;
    if (!track) return;
    void this.load(track).then((buf) => {
      if (buf && gen === this.gen && !this.hushed) this.start(track, buf);
    });
    // The end's jingles are small: have them ready, so they aren't late.
    void this.load("victory");
    void this.load("defeat");
  }

  private start(track: Track, buf: AudioBuffer): void {
    const g = this.sound.graph;
    const out = this.out();
    if (!g || !out) return;
    const t = g.ctx.currentTime + 0.03;
    const gain = g.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + FADE);
    gain.connect(out);
    const from = (this.pos.get(track) ?? 0) % buf.duration;
    this.cur = { track, buf, gain, nextAt: t, t0: t - from, sources: [] };
    this.schedule(from);
    if (!this.timer) this.timer = window.setInterval(() => this.schedule(0), 1000);
  }

  /** One more pass of the loop whenever the last one would end within AHEAD seconds. */
  private schedule(firstFrom: number): void {
    const c = this.cur;
    const g = this.sound.graph;
    if (!c || !g) return;
    let from = firstFrom;
    while (c.nextAt - g.ctx.currentTime < AHEAD) {
      const src = g.ctx.createBufferSource();
      src.buffer = c.buf;
      const env = g.ctx.createGain();
      const at = c.nextAt;
      const left = c.buf.duration - from;
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(1, at + OVERLAP);
      env.gain.setValueAtTime(1, at + left - OVERLAP);
      env.gain.linearRampToValueAtTime(0, at + left);
      src.connect(env).connect(c.gain);
      src.start(at, from);
      src.onended = () => {
        const k = c.sources.indexOf(src);
        if (k >= 0) c.sources.splice(k, 1);
      };
      c.sources.push(src);
      c.nextAt = at + left - OVERLAP;
      // The clock that says where we are in the track, for when it stops.
      if (from === 0) c.t0 = at;
      from = 0;
    }
  }

  private fadeOut(over: number): void {
    const c = this.cur;
    const g = this.sound.graph;
    if (!c || !g) return;
    this.cur = null;
    const t = g.ctx.currentTime;
    this.pos.set(c.track, Math.max(0, t - c.t0) % c.buf.duration);
    c.gain.gain.cancelScheduledValues(t);
    c.gain.gain.setTargetAtTime(0, t, over / 4);
    const end = t + over + 0.2;
    for (const s of c.sources) {
      s.onended = null;
      try {
        s.stop(end);
      } catch {
        // Already over.
      }
    }
    setTimeout(() => c.gain.disconnect(), (over + 0.4) * 1000);
  }

  /** The announcer speaks (on) and is done (off): the score dips to 35% and comes back. */
  duck(on: boolean): void {
    const g = this.sound.graph;
    if (!g || !this.ducker) return;
    this.ducker.gain.setTargetAtTime(on ? 0.35 : 1, g.ctx.currentTime, on ? 0.08 : 0.4);
  }

  /** Under 30 health: muffle whatever plays. */
  setLow(on: boolean): void {
    if (on === this.low || !this.filter) return;
    this.low = on;
    const g = this.sound.graph!;
    this.filter.frequency.setTargetAtTime(on ? 420 : 18000, g.ctx.currentTime, 0.4);
  }

  /** The end of a match: the score stops, the jingle plays once, then `then` (the results' track). */
  sting(s: Sting, then: Track | null = null): void {
    this.play(null);
    const gen = this.gen;
    void this.load(s).then((buf) => {
      const g = this.sound.graph;
      const out = this.out();
      if (!buf || !g || !out || gen !== this.gen) return;
      const src = g.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(out);
      src.start();
      if (then) src.onended = () => {
        if (gen === this.gen) this.play(then);
      };
    });
  }

  /** Paused (the pause menu, a hidden tab): the score stops; un-hushed it carries on from there. */
  hush(on: boolean): void {
    if (on === this.hushed) return;
    this.hushed = on;
    if (on) this.fadeOut(0.05);
    else if (this.now) {
      const track = this.now;
      const gen = ++this.gen;
      void this.load(track).then((buf) => {
        if (buf && gen === this.gen && !this.hushed) this.start(track, buf);
      });
    }
  }

  get playing(): Track | null {
    return this.now;
  }
}
