// Every sound in the game is synthesised: no audio files to download, so the
// game loads fast on mobile data and the whole soundtrack costs ~0 KB.
//
// Lagos Life review checklist §04: "sound starts only after the player's first
// tap" and stops on pause. So: no AudioContext exists until unlock() is called
// from a tap, and suspend()/resume() follow the world's onPause/onResume.
//
// Mama's songs (songs.ts) play at their own fixed tempo and loop. They carry NO
// information about when she will turn: the referee cuts them at a random
// moment, and the cut is instant — a short fade, no final note, no flourish.
// Notes are scheduled a little ahead of time (a look-ahead window), so a cut
// silences only what was already queued.

import { SONGS, type Hit, type Song, type SongId, type SungNote, type VoiceKind } from "./songs";

type Ctx = AudioContext;

const LOOKAHEAD_S = 0.25;
const TICK_MS = 50;

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Two formants per vowel, roughly: enough to make an oscillator "sing" a vowel. */
const VOWEL: Record<string, [number, number]> = {
  a: [800, 1200],
  e: [450, 2100],
  i: [320, 2500],
  o: [480, 900],
  u: [360, 800],
};

function vowelOf(text: string): [number, number] {
  const m = text.toLowerCase().match(/[aeiou]/g);
  return VOWEL[m ? m[m.length - 1] : "a"];
}

interface Playing {
  song: Song;
  /** Context time the song's beat 0 corresponds to. */
  origin: number;
  /** Everything before this context time is already scheduled. */
  until: number;
  timer: number;
}

interface Voice {
  wave: OscillatorType;
  transpose: number;
  gain: number;
  attack: number;
  formant: number;
  vibrato: number;
  vibratoHz: number;
  unison: number;
  spread: number;
}

const VOICES: Record<VoiceKind, Voice> = {
  // A child-like doll: high, thin, slightly too steady — then a slow wobble.
  doll: { wave: "triangle", transpose: 0, gain: 0.5, attack: 0.03, formant: 1.18, vibrato: 0.006, vibratoHz: 4.2, unison: 1, spread: 0 },
  // The caller in "Mama Say Waka": a fuller, lower voice.
  lead: { wave: "sawtooth", transpose: -12, gain: 0.32, attack: 0.02, formant: 1, vibrato: 0.012, vibratoHz: 5.5, unison: 1, spread: 0 },
  // The street answering: three voices, a little out of tune with each other.
  crowd: { wave: "sawtooth", transpose: -12, gain: 0.22, attack: 0.03, formant: 0.95, vibrato: 0.01, vibratoHz: 5, unison: 3, spread: 14 },
};

export class Sound {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private songNodes: AudioScheduledSourceNode[] = [];
  private songBus: GainNode | null = null;
  private playing: Playing | null = null;
  private enabled = true;
  private hidden = false;

  get unlocked(): boolean {
    return !!this.ctx;
  }

  /**
   * Build the audio engine ahead of time, SILENT. Browsers create a context made
   * before any tap in the "suspended" state: nothing can play until unlock()
   * resumes it from a tap. Doing this while the lobby sits idle moves the cost
   * of starting audio (half a second on some phones) away from the first tap.
   */
  prepare(): void {
    if (this.ctx) return;
    const ctx = this.create();
    // Some browsers start it "running" anyway; we hold it until the first tap.
    if (ctx && ctx.state === "running" && !this.tapped) void ctx.suspend();
  }

  private tapped = false;

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    this.tapped = true;
    if (this.ctx) {
      if (this.ctx.state === "suspended" && !this.hidden) void this.ctx.resume();
      return;
    }
    const ctx = this.create();
    if (ctx && ctx.state === "suspended" && !this.hidden) void ctx.resume();
  }

  private create(): Ctx | null {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    let ctx: Ctx;
    try {
      ctx = new AC({ latencyHint: "interactive" });
    } catch {
      return null;
    }
    this.ctx = ctx;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.9 : 0;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    this.music = this.ctx.createGain();
    this.music.gain.value = this.musicOn ? 0.55 : 0;
    this.music.connect(this.master);

    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  private musicOn = true;

  /** Mama's singing on or off (the words still show on screen). */
  setMusic(on: boolean): void {
    this.musicOn = on;
    if (this.music && this.ctx) this.music.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.02);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.02);
  }

  /** The world paused us (background, pay sheet): everything stops. */
  suspend(): void {
    this.hidden = true;
    if (this.ctx && this.ctx.state === "running") void this.ctx.suspend();
  }

  resume(): void {
    this.hidden = false;
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  // ── Building blocks ────────────────────────────────────────────────────────

  private tone(
    freq: number,
    at: number,
    dur: number,
    opts: { type?: OscillatorType; gain?: number; to?: number; bus?: AudioNode; attack?: number; track?: boolean } = {},
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? "sine";
    osc.frequency.setValueAtTime(freq, at);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), at + dur);
    const peak = opts.gain ?? 0.3;
    const atk = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(opts.bus ?? this.master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
    if (opts.track) this.songNodes.push(osc);
  }

  private noise(at: number, dur: number, opts: { gain?: number; freq?: number; type?: BiquadFilterType; bus?: AudioNode; track?: boolean } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? "highpass";
    f.frequency.value = opts.freq ?? 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain ?? 0.3, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(opts.bus ?? this.master);
    src.start(at, Math.random() * 0.5);
    src.stop(at + dur + 0.02);
    if (opts.track) this.songNodes.push(src);
  }

  // ── The song ───────────────────────────────────────────────────────────────

  /** Start (or resume) `id` from `fromBeat`. Loops until stopSong(). */
  playSong(id: SongId, fromBeat: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.music) return;
    this.stopSong();
    const song = SONGS[id];
    // Each song gets its own bus, so a cut can fade it in 25 ms without a click.
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(this.music);
    this.songBus = bus;
    const start = ctx.currentTime + 0.03;
    const p: Playing = {
      song,
      origin: start - (fromBeat * 60) / song.bpm,
      until: start,
      timer: 0,
    };
    this.playing = p;
    this.schedule(p);
    p.timer = window.setInterval(() => this.schedule(p), TICK_MS);
  }

  /** Cut the song NOW. Silence is the point: no last note, no tail. */
  stopSong(): void {
    const ctx = this.ctx;
    if (this.playing) {
      clearInterval(this.playing.timer);
      this.playing = null;
    }
    if (ctx && this.songBus) {
      const bus = this.songBus;
      bus.gain.setTargetAtTime(0, ctx.currentTime, 0.008);
      setTimeout(() => bus.disconnect(), 200);
    }
    this.songBus = null;
    for (const n of this.songNodes) {
      try {
        n.stop(ctx ? ctx.currentTime + 0.08 : 0);
      } catch {
        /* already stopped */
      }
    }
    this.songNodes = [];
  }

  /** Queue every note and hit that starts inside the look-ahead window. */
  private schedule(p: Playing): void {
    const ctx = this.ctx;
    if (!ctx || this.playing !== p || !this.songBus) return;
    // While suspended (app in background) the clock stands still: nothing to do.
    const end = ctx.currentTime + LOOKAHEAD_S;
    if (end <= p.until) return;
    const spb = 60 / p.song.bpm;
    const loopS = p.song.length * spb;
    const from = (p.until - p.origin) / spb;
    const to = (end - p.origin) / spb;
    const firstLoop = Math.floor(from / p.song.length);
    const lastLoop = Math.floor(to / p.song.length);
    for (let loop = firstLoop; loop <= lastLoop; loop++) {
      const base = p.origin + loop * loopS;
      for (const n of p.song.notes) {
        const at = base + n.t * spb;
        if (at >= p.until && at < end) this.sing(n, at, n.d * spb);
      }
      for (const h of p.song.hits) {
        const at = base + h.t * spb;
        if (at >= p.until && at < end) this.hit(h, at, spb);
      }
    }
    p.until = end;
    // Forget nodes that have finished, so the list doesn't grow for a long song.
    if (this.songNodes.length > 400) this.songNodes = this.songNodes.slice(-200);
  }

  /** A sung syllable: an oscillator through two vowel formants, with vibrato. */
  private sing(n: SungNote, at: number, dur: number): void {
    const ctx = this.ctx!;
    const bus = this.songBus!;
    const voice = VOICES[n.voice];
    const f0 = hz(n.midi + voice.transpose);
    const [f1, f2] = vowelOf(n.text);
    const len = Math.max(0.12, dur * 0.95);

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, at);
    out.gain.exponentialRampToValueAtTime(voice.gain, at + voice.attack);
    out.gain.setValueAtTime(voice.gain, at + Math.max(voice.attack, len - 0.08));
    out.gain.exponentialRampToValueAtTime(0.0001, at + len);
    out.connect(bus);

    const fA = ctx.createBiquadFilter();
    fA.type = "bandpass";
    fA.frequency.value = f1 * voice.formant;
    fA.Q.value = 6;
    const fB = ctx.createBiquadFilter();
    fB.type = "bandpass";
    fB.frequency.value = f2 * voice.formant;
    fB.Q.value = 8;
    fA.connect(out);
    fB.connect(out);

    const vib = ctx.createOscillator();
    const vibDepth = ctx.createGain();
    vib.frequency.value = voice.vibratoHz;
    vibDepth.gain.value = f0 * voice.vibrato;
    vib.connect(vibDepth);

    for (let k = 0; k < voice.unison; k++) {
      const osc = ctx.createOscillator();
      osc.type = voice.wave;
      osc.frequency.setValueAtTime(f0, at);
      osc.detune.value = (k - (voice.unison - 1) / 2) * voice.spread;
      vibDepth.connect(osc.frequency);
      osc.connect(fA);
      osc.connect(fB);
      osc.start(at);
      osc.stop(at + len + 0.05);
      this.songNodes.push(osc);
    }
    vib.start(at);
    vib.stop(at + len + 0.05);
    this.songNodes.push(vib);

    // The doll's breath: a whisper of noise on top, which is what makes it eerie.
    if (n.voice === "doll") this.noise(at, Math.min(0.12, len), { gain: 0.02, freq: 3000, bus, track: true });
  }

  private hit(h: Hit, at: number, spb: number): void {
    const bus = this.songBus!;
    const o = { bus, track: true };
    switch (h.kind) {
      case "box": {
        // Music box: a pure tine and a glassy partial, ringing off quickly.
        const f = hz(h.midi ?? 72);
        this.tone(f, at, 0.9, { type: "sine", gain: 0.13, ...o });
        this.tone(f * 4.07, at, 0.18, { type: "sine", gain: 0.025, ...o });
        break;
      }
      case "thump":
        this.tone(58, at, 0.18, { type: "sine", gain: 0.22, to: 42, ...o });
        break;
      case "pluck": {
        // Gayageum: a bright pluck that bends slightly flat as it rings.
        const f = hz(h.midi ?? 62);
        this.tone(f * 1.01, at, 0.55, { type: "triangle", gain: 0.12, to: f * 0.995, ...o });
        this.tone(f * 2, at, 0.12, { type: "sawtooth", gain: 0.025, ...o });
        break;
      }
      case "janggu-low":
        this.tone(95, at, 0.28, { type: "sine", gain: 0.3, to: 70, ...o });
        break;
      case "janggu-high":
        this.noise(at, 0.07, { gain: 0.16, freq: 1800, ...o });
        this.tone(340, at, 0.06, { type: "triangle", gain: 0.08, ...o });
        break;
      case "bell-high":
      case "bell-low": {
        // Agogo: two inharmonic partials, metal not wood.
        const f = h.kind === "bell-high" ? 1180 : 880;
        this.tone(f, at, 0.16, { type: "square", gain: 0.035, ...o });
        this.tone(f * 2.76, at, 0.08, { type: "sine", gain: 0.03, ...o });
        break;
      }
      case "shaker":
        this.noise(at, 0.05, { gain: 0.05, freq: 6500, ...o });
        break;
      case "kick":
        this.tone(110, at, 0.16, { type: "sine", gain: 0.28, to: 45, ...o });
        break;
      case "talk": {
        // Talking drum: the pitch bends as the player squeezes the strings.
        const f = hz(h.midi ?? 50);
        this.tone(f * 1.25, at, Math.min(0.4, spb * 0.9), { type: "sine", gain: 0.34, to: f * 0.8, ...o });
        break;
      }
    }
  }

  // ── Cues ───────────────────────────────────────────────────────────────────

  private get now(): number {
    return this.ctx ? this.ctx.currentTime + 0.01 : 0;
  }

  /** She starts turning: a falling talking-drum glide. */
  turn(): void {
    const t = this.now;
    this.tone(260, t, 0.42, { type: "sine", gain: 0.34, to: 120 });
    this.noise(t, 0.05, { gain: 0.12, freq: 2500 });
  }

  /** Detection is live: a low pulse so you FEEL the stare. */
  watch(): void {
    const t = this.now;
    this.tone(55, t, 0.6, { type: "sine", gain: 0.35, attack: 0.03 });
  }

  /** She turns back to the wall: a soft rising note — breathe out. */
  release(): void {
    const t = this.now;
    this.tone(330, t, 0.25, { type: "triangle", gain: 0.12, to: 440 });
  }

  /** The catch: a crack, a zap, and a deep drum that hangs. */
  catch(near: boolean): void {
    const t = this.now;
    this.noise(t, 0.14, { gain: near ? 0.55 : 0.3, freq: 1800 });
    this.tone(90, t, 0.08, { type: "square", gain: near ? 0.25 : 0.12 });
    this.tone(1200, t + 0.03, 0.28, { type: "sawtooth", gain: near ? 0.12 : 0.06, to: 140 });
    if (near) {
      this.tone(62, t + 0.08, 1.8, { type: "sine", gain: 0.7, to: 34, attack: 0.01 });
      this.noise(t + 0.08, 1.2, { gain: 0.18, freq: 160, type: "lowpass" });
    }
  }



  countdown(final: boolean): void {
    const t = this.now;
    this.tone(final ? 988 : 660, t, final ? 0.32 : 0.14, { type: "square", gain: 0.12 });
  }

  step(): void {
    const t = this.now;
    this.noise(t, 0.035, { gain: 0.05, freq: 900, type: "lowpass" });
  }

  win(): void {
    const t = this.now;
    [hz(72), hz(76), hz(79), hz(84)].forEach((f, i) =>
      this.tone(f, t + i * 0.11, 0.35, { type: "triangle", gain: 0.22 }),
    );
    this.tone(hz(67), t + 0.44, 0.6, { type: "triangle", gain: 0.12 });
  }

  lose(): void {
    const t = this.now;
    [hz(64), hz(62), hz(60)].forEach((f, i) => this.tone(f, t + i * 0.22, 0.4, { type: "triangle", gain: 0.16 }));
  }

  ui(): void {
    const t = this.now;
    this.tone(880, t, 0.05, { type: "sine", gain: 0.08 });
  }
}
