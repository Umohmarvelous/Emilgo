// Every sound in the game is synthesised: no audio files to download, so the
// game loads fast on mobile data and the whole soundtrack costs ~0 KB.
//
// Lagos Life review checklist §04: "sound starts only after the player's first
// tap" and stops on pause. So: no AudioContext exists until unlock() is called
// from a tap, and suspend()/resume() follow the world's onPause/onResume.
//
// Ball Haunt's songs (songs.ts), sung from the sky, play at their own fixed
// tempo and loop. They carry NO information about when the eye will open: the
// referee cuts them at a random moment, and the cut is instant — a short fade,
// no final note, no flourish.
// Notes are scheduled a little ahead of time (a look-ahead window), so a cut
// silences only what was already queued.

import { loadSamples, sampleBuffer } from "./samples";
import type { Surface } from "../maps/registry";
import { RADIO_TRACK, type RadioId } from "./radio";
import { Music } from "./music";
import { Voice as Announcer } from "./voice";
import type { Hit, Song, SungNote, VoiceKind } from "./songs";

type Ctx = AudioContext;

const LOOKAHEAD_S = 0.25;
/**
 * Most one-shot voices at once (SPEC-V3 audio pooling). A budget phone's audio
 * thread chokes long before the ear can tell 30 sounds apart; past this,
 * the least important (footsteps first) are simply not started.
 */
const VOICE_CAP = 32;
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
  // A caller: a fuller, lower voice.
  lead: { wave: "sawtooth", transpose: -12, gain: 0.32, attack: 0.02, formant: 1, vibrato: 0.012, vibratoHz: 5.5, unison: 1, spread: 0 },
  // The street answering: three voices, a little out of tune with each other.
  crowd: { wave: "sawtooth", transpose: -12, gain: 0.22, attack: 0.03, formant: 0.95, vibrato: 0.01, vibratoHz: 5, unison: 3, spread: 14 },
};

export class Sound {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  /** Sound effects (everything but the songs and the warning hum). */
  private sfx: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private songNodes: AudioScheduledSourceNode[] = [];
  private songBus: GainNode | null = null;
  private playing: Playing | null = null;
  /** Volumes 0…1 (SPEC-V2 §7.2, §7.5 #12–13): master, music, effects (0 when switched off). */
  private levels = { master: 0.9, music: 1, sfx: 1 };
  private hidden = false;
  private farZapAt = -1;

  get unlocked(): boolean {
    return !!this.ctx;
  }

  /** The engine's context and buses (v4: the world's emitters and the music states plug in here), or null before the first tap. */
  get graph(): { ctx: Ctx; sfx: GainNode; music: GainNode } | null {
    return this.ctx && this.sfx && this.music ? { ctx: this.ctx, sfx: this.sfx, music: this.music } : null;
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
    this.master.gain.value = this.levels.master;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    // v4: the sample layer, from the asset CDN if there is one.
    loadSamples(this.ctx);
    this.music = this.ctx.createGain();
    this.music.gain.value = 0.55 * this.levels.music;
    this.music.connect(this.master);
    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = this.levels.sfx;
    this.sfx.connect(this.master);

    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  /**
   * Master, music and effects volumes, 0…1. Music off (0) still leaves the
   * warning hum: it is a rule of the game, so only the master volume turns it down.
   */
  setLevels(master: number, music: number, sfx: number): void {
    this.levels = { master: 0.9 * clamp01(master), music: clamp01(music), sfx: clamp01(sfx) };
    if (!this.ctx || !this.master || !this.music || !this.sfx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.hushed ? 0 : this.levels.master, t, 0.02);
    this.music.gain.setTargetAtTime(0.55 * this.levels.music, t, 0.02);
    this.sfx.gain.setTargetAtTime(this.levels.sfx, t, 0.02);
  }

  private hushed = false;

  /** v5: nothing would be heard (paused, hidden, master at 0): the announcer stays quiet too. */
  get muted(): boolean {
    return this.hushed || this.hidden || this.levels.master <= 0;
  }

  /** How loud a kind of sound plays now (master × its own), 0…1: the announcer's speech volume follows the effects'. */
  levelOf(kind: "sfx" | "music"): number {
    return (this.levels.master / 0.9) * this.levels[kind];
  }

  /**
   * Paused online (SPEC-V3: nothing plays during pause): the round goes on
   * underneath, so the clock can't stop — the whole mix fades out instead,
   * and back in on resume.
   */
  hush(on: boolean): void {
    this.hushed = on;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(on ? 0 : this.levels.master, this.ctx.currentTime, 0.03);
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

  /** One-shot voices playing now (tones and noise bursts). */
  private voices = 0;
  private readonly voiceEnded = (): void => {
    this.voices = Math.max(0, this.voices - 1);
  };

  /** True when this many voices or more are already playing: skip a sound that can be spared. */
  private busy(limit: number = VOICE_CAP): boolean {
    return this.voices >= limit;
  }

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
    osc.connect(g).connect(opts.bus ?? this.sfx ?? this.master);
    this.voices++;
    osc.onended = this.voiceEnded;
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
    src.connect(f).connect(g).connect(opts.bus ?? this.sfx ?? this.master);
    this.voices++;
    src.onended = this.voiceEnded;
    src.start(at, Math.random() * 0.5);
    src.stop(at + dur + 0.02);
    if (opts.track) this.songNodes.push(src);
  }

  // ── The song ───────────────────────────────────────────────────────────────

  /**
   * Start (or resume) Ball Haunt's `song` from `fromBeat`. Loops until
   * stopSong(). It comes from the sky (`skySend`). (The songs live in Ball
   * Haunt's chunk, modes/rlgl.ts: the caller hands one over.)
   */
  playSong(song: Song, fromBeat: number): void {
    // Ball Haunt's song from the sky has the music bus to itself.
    this.score.play(null);
    this.playLoop(song, fromBeat);
    if (this.songBus) this.skySend(this.songBus);
  }

  /** The song's open-air echo, its return level (zero between songs, so a cut stays a cut). */
  private sky: { in: AudioNode; wet: GainNode } | null = null;

  /**
   * Ball Haunt's song comes from the sky (SPEC-V3 Phase 11): the voice dry,
   * plus a wide, high echo off the open air (a made-up hall: two seconds of
   * noise dying away, a little late, its lows taken out). Built on first use.
   */
  private skySend(bus: GainNode): void {
    const ctx = this.ctx;
    if (!ctx || !this.music) return;
    if (!this.sky) {
      const rate = ctx.sampleRate;
      const len = Math.round(rate * 1.8);
      const ir = ctx.createBuffer(2, len, rate);
      let seed = 0x5eed;
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          const t = i / rate;
          d[i] = ((seed / 4294967296) * 2 - 1) * Math.exp(-t * 2.6) * Math.min(1, t / 0.05);
        }
      }
      const pre = ctx.createDelay(0.25);
      pre.delayTime.value = 0.08;
      const conv = ctx.createConvolver();
      conv.buffer = ir;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 380;
      const wet = ctx.createGain();
      wet.gain.value = 0;
      pre.connect(conv).connect(hp).connect(wet).connect(this.music);
      this.sky = { in: pre, wet };
    }
    const g = this.sky.wet.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setTargetAtTime(0.5, ctx.currentTime, 0.05);
    bus.connect(this.sky.in);
  }

  /**
   * The car radio (vehicles): a station, or off. v4 rework: the stations play
   * the downloaded CC0 tracks (music.ts), not loops made in code.
   */
  carRadio(id: RadioId | null): void {
    if (this.radioOn === id) return;
    this.radioOn = id;
    this.score.play(id ? RADIO_TRACK[id] : null);
  }

  /** The score: the downloaded tracks (v4 rework R8). */
  readonly score = new Music(this);
  /** v5 (3.6): the announcer. */
  readonly voice = new Announcer(this, this.score);

  private radioOn: RadioId | null = null;
  get radioPlaying(): boolean {
    return this.radioOn !== null;
  }

  private playLoop(song: Song, fromBeat: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.music) return;
    this.stopSong();
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
    // The sky's echo goes with it: no tail to blur the cut.
    if (ctx && this.sky) {
      this.sky.wet.gain.cancelScheduledValues(ctx.currentTime);
      this.sky.wet.gain.setTargetAtTime(0, ctx.currentTime, 0.012);
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

  /**
   * The warning hum (SPEC-V2 §2.2): a closed-mouth "mmm" under the song for
   * `dur` seconds, swelling and wavering. It sounds the same whether the song
   * cuts after it or not — the fake hums are the game. It goes on the effects bus,
   * not the music one: switching the music off never mutes the warning.
   */
  hum(dur: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = this.now;
    const end = t + dur;
    const out = ctx.createGain();
    // (Times clamp to the hum's own span, however short it is.)
    const at = (x: number) => Math.min(end, Math.max(t, x));
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.32, at(t + 0.9));
    out.gain.setValueAtTime(0.32, at(end - 0.5));
    out.gain.linearRampToValueAtTime(0.38, at(end - 0.12));
    out.gain.exponentialRampToValueAtTime(0.0001, end);
    // A nasal "m": a low pass with a soft resonance.
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 620;
    lp.Q.value = 4;
    lp.connect(out).connect(this.master);
    // Wavering pitch: the voice of someone humming to themselves.
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 4.6;
    depth.gain.value = 2.2;
    lfo.connect(depth);
    const nodes: OscillatorNode[] = [lfo];
    for (const [f, type, g] of [[147, "triangle", 0.8], [73.5, "sine", 0.6], [148.2, "sawtooth", 0.12]] as const) {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      // A slow lean down in the last second, like a breath running out.
      o.frequency.setValueAtTime(f, at(end - 1));
      o.frequency.linearRampToValueAtTime(f * 0.97, end);
      depth.connect(o.frequency);
      og.gain.value = g;
      o.connect(og).connect(lp);
      nodes.push(o);
    }
    for (const n of nodes) {
      n.start(t);
      n.stop(end + 0.05);
    }
  }

  /** The song cuts and the eye opens: a falling talking-drum glide. */
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

  /** The eye closes again: a soft rising note — breathe out. */
  release(): void {
    const t = this.now;
    this.tone(330, t, 0.25, { type: "triangle", gain: 0.12, to: 440 });
  }

  /** The shot: the laser's zap (the crack and the drum are their own cues). */
  catch(near: boolean): void {
    const t = this.now;
    // Several caught in one step far away: one zap stands for them all (each costs audio nodes).
    if (!near && t - this.farZapAt < 0.08) return;
    if (!near) this.farZapAt = t;
    this.noise(t, 0.1, { gain: near ? 0.3 : 0.16, freq: 2600 });
    this.tone(1200, t + 0.02, 0.28, { type: "sawtooth", gain: near ? 0.12 : 0.06, to: 140 });
  }

  /**
   * Her head snaps round to the offender (SPEC-V2 §2.6 step 1): a hard CRACK,
   * like a wooden neck twisted too far — a sharp split, a knock, a creak.
   */
  crack(near: boolean): void {
    const t = this.now;
    const g = near ? 1 : 0.55;
    this.noise(t, 0.05, { gain: 0.7 * g, freq: 3200, type: "highpass" });
    this.noise(t + 0.004, 0.09, { gain: 0.4 * g, freq: 900, type: "bandpass" });
    this.tone(180, t, 0.07, { type: "square", gain: 0.22 * g, to: 90 });
    this.tone(620, t + 0.05, 0.16, { type: "sawtooth", gain: 0.035 * g, to: 410 });
  }

  /**
   * The eye in the sky has caught someone (SPEC-V3 Phase 11; the doll's neck
   * crack before): a clap of thunder overhead, a split and a rolling rumble.
   */
  eyeFlash(near: boolean): void {
    const t = this.now;
    const g = near ? 1 : 0.6;
    this.noise(t, 0.06, { gain: 0.5 * g, freq: 4200, type: "highpass" });
    this.noise(t + 0.02, 1.4, { gain: 0.24 * g, freq: 240, type: "lowpass" });
    this.tone(70, t + 0.03, 1.1, { type: "sine", gain: 0.3 * g, to: 38 });
  }

  /** A low, ominous drum after a catch (step 6): a deep hit and its softer echo. */
  drum(near: boolean): void {
    const t = this.now + 0.12;
    const g = near ? 1 : 0.6;
    for (const [at, gain] of [[0, 0.8], [0.42, 0.45]] as const) {
      this.tone(64, t + at, 1.6, { type: "sine", gain: gain * g, to: 36, attack: 0.008 });
      this.tone(128, t + at, 0.25, { type: "triangle", gain: gain * 0.25 * g, to: 70 });
      this.noise(t + at, 0.5, { gain: gain * 0.2 * g, freq: 180, type: "lowpass" });
    }
  }

  private tension: { stop: (at: number) => void } | null = null;

  /**
   * Two runners left (SPEC-V2 §2.8): the music builds — a low drone that
   * swells under a heartbeat that quickens, for `dur` seconds, then a quiet
   * pulse that carries on until stopTension().
   */
  finalTwo(dur: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.music) return;
    this.stopTension();
    const t = this.now;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.exponentialRampToValueAtTime(0.9, t + dur * 0.85);
    bus.gain.setTargetAtTime(0.35, t + dur, 0.6);
    bus.connect(this.music);
    const nodes: OscillatorNode[] = [];
    for (const [f, type, g] of [[55, "sawtooth", 0.08], [55.4, "sawtooth", 0.08], [82.4, "triangle", 0.12], [110, "sine", 0.1]] as const) {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      // Rising a semitone over the build: the strain.
      o.frequency.linearRampToValueAtTime(f * 1.06, t + dur);
      og.gain.value = g;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(300, t);
      lp.frequency.exponentialRampToValueAtTime(1400, t + dur);
      o.connect(lp).connect(og).connect(bus);
      o.start(t);
      nodes.push(o);
    }
    // The heartbeat: lub-dub, faster and faster through the build.
    let at = t;
    let gap = 0.75;
    while (at < t + dur) {
      this.tone(58, at, 0.2, { type: "sine", gain: 0.5, to: 40, bus });
      this.tone(52, at + 0.16, 0.18, { type: "sine", gain: 0.32, to: 38, bus });
      at += gap;
      gap = Math.max(0.36, gap * 0.82);
    }
    // Afterwards a slower pulse, every 0.8 s, until the round is over.
    let pulse = 0;
    const begin = window.setTimeout(() => {
      pulse = window.setInterval(() => {
        // Paused (the clock stands still): don't pile beats up for the resume.
        if (ctx.state !== "running") return;
        const n = this.now;
        this.tone(58, n, 0.2, { type: "sine", gain: 0.3, to: 40, bus });
        this.tone(52, n + 0.16, 0.18, { type: "sine", gain: 0.2, to: 38, bus });
      }, 800);
    }, dur * 1000);
    this.tension = {
      stop: (when: number) => {
        clearTimeout(begin);
        clearInterval(pulse);
        bus.gain.cancelScheduledValues(when);
        bus.gain.setTargetAtTime(0, when, 0.15);
        for (const o of nodes) o.stop(when + 0.8);
        setTimeout(() => bus.disconnect(), 1200);
      },
    };
  }

  /** The tension bed stops (the round is over, or you left). */
  stopTension(): void {
    if (!this.tension || !this.ctx) return;
    this.tension.stop(this.ctx.currentTime);
    this.tension = null;
  }



  /**
   * The countdown, one per number (SPEC-V3: real countdown sounds, no bass
   * drops): a clean timer beep with a click, like a stopwatch's. The last
   * number (1) is higher and held a little longer: the go.
   */
  countTick(last: boolean): void {
    const t = this.now;
    this.noise(t, 0.012, { gain: 0.12, freq: 3200, type: "highpass" });
    this.tone(last ? 1320 : 880, t, last ? 0.42 : 0.16, { type: "sine", gain: last ? 0.3 : 0.24, attack: 0.003 });
    this.tone(last ? 2640 : 1760, t, last ? 0.2 : 0.08, { type: "sine", gain: 0.05, attack: 0.003 });
  }

  /**
   * Your footstep, by what it lands on (SPEC-V3): sand a soft hiss, concrete a
   * short hard tap, grass a brushed rustle, a car roof a hollow metal knock,
   * a puddle a wet slap, planks a hollow knock. `pace` 0 walk … 1 sprint: harder and brighter.
   * Steps are the first sounds dropped when too many are playing.
   */
  step(surface: Surface = "concrete", pace = 0.5, bus?: AudioNode): void {
    if (this.busy(VOICE_CAP - 6)) return;
    const t = this.now;
    const k = 0.75 + 0.5 * pace;
    const v = 0.92 + Math.random() * 0.16; // no two steps alike
    switch (surface) {
      case "sand":
        this.noise(t, 0.07 * v, { gain: 0.045 * k, freq: 2400 * v, type: "bandpass", bus });
        this.noise(t, 0.04, { gain: 0.03 * k, freq: 500, type: "lowpass", bus });
        break;
      case "grass":
        this.noise(t, 0.09 * v, { gain: 0.04 * k, freq: 3800 * v, type: "highpass", bus });
        this.noise(t + 0.01, 0.05, { gain: 0.028 * k, freq: 700, type: "lowpass", bus });
        break;
      case "metal":
        this.tone(320 * v, t, 0.12, { type: "triangle", gain: 0.07 * k, to: 260, bus });
        this.tone(1240 * v, t, 0.06, { type: "sine", gain: 0.025 * k, bus });
        this.noise(t, 0.02, { gain: 0.04 * k, freq: 1800, type: "bandpass", bus });
        break;
      case "wood":
        this.tone(210 * v, t, 0.07, { type: "triangle", gain: 0.06 * k, to: 150, bus });
        this.noise(t, 0.03, { gain: 0.035 * k, freq: 900 * v, type: "bandpass", bus });
        break;
      case "puddle":
        this.noise(t, 0.08 * v, { gain: 0.06 * k, freq: 1500 * v, type: "bandpass", bus });
        this.tone(900 * v, t + 0.015, 0.05, { type: "sine", gain: 0.02 * k, to: 1400, bus });
        break;
      default:
        this.noise(t, 0.03 * v, { gain: 0.06 * k, freq: 1100 * v, type: "lowpass", bus });
        this.tone(120 * v, t, 0.04, { type: "sine", gain: 0.035 * k, to: 70, bus });
    }
  }

  /**
   * v5: somebody else's footstep, so you can hear who is coming: `near` 1 at your
   * side down to 0 far off, `pan` −1 left … 1 right.
   */
  stepNear(surface: Surface, pace: number, near: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || near <= 0.01 || this.busy(VOICE_CAP - 10)) return;
    const g = ctx.createGain();
    g.gain.value = near * 1.6;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(this.sfx);
    this.step(surface, pace, g);
    setTimeout(() => {
      g.disconnect();
      p.disconnect();
    }, 400);
  }

  /**
   * Your jump: a woman's short effort shout ("hah!"), a recorded one of three takes (CC0, tools/audio/sfx.mjs),
   * never the same twice in a row, each a shade higher or lower; under it, the boots pushing off the ground.
   * The synthesised effort stands in until the library has loaded.
   */
  jump(): void {
    const t = this.now;
    // The push off: grit under the boots.
    this.noise(t, 0.05, { gain: 0.035, freq: 700, type: "lowpass" });
    const takes = ["voice-jump", "voice-jump2", "voice-jump3"].filter((n) => !!sampleBuffer(n));
    if (takes.length) {
      let k = Math.floor(Math.random() * takes.length);
      if (takes.length > 1 && takes[k] === this.lastJump) k = (k + 1) % takes.length;
      this.lastJump = takes[k];
      if (this.sample(takes[k], 0.5, 0.95 + Math.random() * 0.1)) return;
    }
    this.tone(310, t, 0.15, { type: "sawtooth", gain: 0.022, to: 235, attack: 0.012 });
    this.tone(620, t, 0.11, { type: "sine", gain: 0.02, to: 470, attack: 0.012 });
    this.noise(t, 0.13, { gain: 0.035, freq: 1300, type: "bandpass" });
  }
  private lastJump = "";

  /** v6 max (2.3): the tactical sprint's burst: a rush of air past the ears and a sharp breath in. */
  tacSprint(): void {
    const t = this.now;
    this.noise(t, 0.45, { gain: 0.05, freq: 900, type: "bandpass" });
    this.noise(t + 0.02, 0.18, { gain: 0.025, freq: 2600, type: "bandpass" });
    this.tone(160, t, 0.12, { type: "sine", gain: 0.05, to: 90 });
  }

  /** v6 max: your own swing: a grunt with it, now and then (not every swing: it would grate). */
  effort(): void {
    if (Math.random() < 0.45) this.sample("voice-swing", 0.42, 0.92 + Math.random() * 0.14);
  }

  /** v5: landing: boots on the ground and a breath out. */
  land(): void {
    if (this.sample("voice-land", 0.5, 0.95 + Math.random() * 0.1)) return;
    const t = this.now;
    this.tone(95, t, 0.09, { type: "sine", gain: 0.1, to: 60 });
    this.noise(t, 0.05, { gain: 0.07, freq: 900, type: "lowpass" });
    this.noise(t + 0.04, 0.12, { gain: 0.018, freq: 1500, type: "bandpass" });
  }

  /** v6: you're hit: a short pained breath (recorded "voice-hurt" when the library has it). At most one at a time. */
  hurt(heavy: boolean): void {
    const now = this.now;
    if (now < this.hurtUntil) return;
    this.hurtUntil = now + 0.45;
    if (this.sample("voice-hurt", heavy ? 0.65 : 0.45, 0.94 + Math.random() * 0.12)) return;
    this.tone(heavy ? 260 : 300, now, 0.16, { type: "sawtooth", gain: heavy ? 0.03 : 0.02, to: 190, attack: 0.008 });
    this.noise(now, 0.18, { gain: heavy ? 0.05 : 0.035, freq: 1100, type: "bandpass" });
  }
  private hurtUntil = 0;

  /** v6: out of breath after a long sprint: two hard breaths ("voice-breath" when recorded). */
  breath(): void {
    if (this.sample("voice-breath", 0.4)) return;
    const t = this.now;
    for (let i = 0; i < 2; i++) {
      this.noise(t + i * 0.55, 0.32, { gain: 0.03, freq: 1600, type: "bandpass" });
      this.noise(t + i * 0.55 + 0.32, 0.22, { gain: 0.018, freq: 900, type: "bandpass" });
    }
  }

  /** A swing: a whoosh, and if it landed, the hit — a thud (fist), a crack (slap), a shove (push). */
  strike(kind: "fist" | "slap" | "push", landed: boolean): void {
    const t = this.now;
    this.noise(t, 0.12, { gain: 0.07, freq: 700, type: "bandpass" });
    if (!landed) return;
    const at = t + 0.09;
    if (kind === "fist") {
      this.tone(95, at, 0.16, { type: "sine", gain: 0.42, to: 45 });
      this.noise(at, 0.06, { gain: 0.16, freq: 600, type: "lowpass" });
    } else if (kind === "slap") {
      this.noise(at, 0.07, { gain: 0.3, freq: 2400, type: "highpass" });
      this.tone(320, at, 0.05, { type: "triangle", gain: 0.08 });
    } else {
      this.tone(70, at, 0.22, { type: "sine", gain: 0.3, to: 40 });
      this.noise(at, 0.18, { gain: 0.1, freq: 400, type: "lowpass" });
    }
  }

  // ── Vehicles (Phase 5). `near`: 0 (out of earshot) … 1 (right there). ──

  /** A danfo horn: two reedy tones together, a short double blast. */
  horn(near: number): void {
    if (near <= 0.02) return;
    const t = this.now;
    for (const at of [t, t + 0.2]) {
      this.tone(415, at, 0.16, { type: "square", gain: 0.06 * near, attack: 0.01 });
      this.tone(523, at, 0.16, { type: "square", gain: 0.05 * near, attack: 0.01 });
    }
  }

  /** The Harmattan's warning: a long siren, rising and falling twice. */
  siren(): void {
    const t = this.now;
    this.tone(420, t, 1.4, { type: "triangle", gain: 0.07, to: 880, attack: 0.2 });
    this.tone(880, t + 1.4, 1.4, { type: "triangle", gain: 0.07, to: 420 });
    this.noise(t + 0.5, 2.6, { gain: 0.04, freq: 400, type: "lowpass" });
  }

  /** A car alarm: a siren that rises and falls, then whoops. */
  carAlarm(near: number): void {
    if (near <= 0.02 || this.busy()) return;
    const t = this.now;
    for (let i = 0; i < 6; i++) this.tone(900, t + i * 0.5, 0.45, { type: "triangle", gain: 0.06 * near, to: 1500 });
    for (let i = 0; i < 8; i++) this.tone(1300, t + 3 + i * 0.18, 0.12, { type: "square", gain: 0.03 * near });
  }

  carDoor(near: number): void {
    if (near <= 0.02) return;
    const t = this.now;
    this.tone(85, t, 0.12, { type: "sine", gain: 0.25 * near, to: 55 });
    this.noise(t, 0.06, { gain: 0.08 * near, freq: 900, type: "bandpass" });
  }

  /** Low fuel: one beep at 20%, two at 10%. */
  fuelBeep(n: number): void {
    const t = this.now;
    for (let i = 0; i < n; i++) this.tone(1760, t + i * 0.16, 0.09, { type: "square", gain: 0.05 });
  }

  /** Metal on something: a thud and a rattle. */
  crash(near: number): void {
    if (near <= 0.02 || this.busy()) return;
    const t = this.now;
    this.tone(70, t, 0.25, { type: "sine", gain: 0.35 * near, to: 40 });
    this.noise(t, 0.3, { gain: 0.18 * near, freq: 1800, type: "bandpass" });
    this.noise(t + 0.05, 0.2, { gain: 0.08 * near, freq: 5000, type: "highpass" });
  }

  // ── Guns (v4 Phase 2): synthesised until the sample layer (Phase 8). `near` 0 … 1. ──

  /** A shot: a crack and a body by gun; far off, only the low thump; yours is fullest. */
  gunshot(kind: "pistol" | "rifle" | "smg" | "shotgun", near: number, mine: boolean): void {
    if (near <= 0.03 || this.busy(mine ? VOICE_CAP : VOICE_CAP - 8)) return;
    // v6: no two shots quite alike: a few percent of pitch either way (a rifle's burst stops sounding like a loop).
    if (this.sample(`gun-${kind}`, (mine ? 1 : 0.75) * near, 1 + (Math.random() - 0.5) * (kind === "shotgun" ? 0.06 : 0.1))) return;
    const t = this.now;
    const g = (mine ? 1 : 0.75) * near;
    const far = 1 - near;
    if (kind === "shotgun") {
      this.noise(t, 0.28, { gain: 0.5 * g, freq: 1400 - far * 900, type: "lowpass" });
      this.tone(75, t, 0.3, { type: "sine", gain: 0.5 * g, to: 30 });
      if (near > 0.4) this.noise(t, 0.05, { gain: 0.25 * g, freq: 3500, type: "highpass" });
      // The pump.
      if (mine) {
        this.noise(t + 0.42, 0.05, { gain: 0.1, freq: 2200, type: "bandpass" });
        this.noise(t + 0.55, 0.05, { gain: 0.12, freq: 1800, type: "bandpass" });
      }
      return;
    }
    const len = kind === "rifle" ? 0.11 : kind === "smg" ? 0.065 : 0.09;
    const body = kind === "rifle" ? 105 : kind === "smg" ? 150 : 170;
    this.noise(t, len, { gain: (kind === "smg" ? 0.3 : 0.38) * g, freq: 2600 - far * 1800, type: "lowpass" });
    this.tone(body, t, len + 0.05, { type: "sine", gain: 0.35 * g, to: body * 0.42 });
    if (near > 0.35) this.noise(t, 0.025, { gain: 0.22 * g, freq: 4200, type: "highpass" });
  }

  /** A reload: the magazine out, in, the slide. */
  reload(kind: "pistol" | "rifle" | "smg" | "shotgun", seconds: number): void {
    // A recorded reload (v4 rework): the handgun's, the rifle's, the shotgun's pump at the end.
    if (kind === "shotgun" ? this.sample("pump", 0.7) : this.sample(kind === "pistol" ? "reload" : "reload-rifle", 0.7)) return;
    const t = this.now;
    if (kind === "shotgun") {
      for (let i = 0; i < 4; i++) this.noise(t + 0.25 + (i * (seconds - 0.6)) / 4, 0.04, { gain: 0.1, freq: 1600, type: "bandpass" });
    } else {
      this.noise(t + 0.15, 0.05, { gain: 0.1, freq: 900, type: "bandpass" });
      this.tone(220, t + seconds * 0.55, 0.04, { type: "square", gain: 0.03 });
      this.noise(t + seconds * 0.55, 0.05, { gain: 0.14, freq: 1500, type: "bandpass" });
    }
    this.noise(t + seconds - 0.15, 0.06, { gain: 0.14, freq: 2600, type: "bandpass" });
  }

  /** The trigger on an empty magazine. */
  dryFire(): void {
    this.noise(this.now, 0.025, { gain: 0.12, freq: 3200, type: "highpass" });
  }

  /** Your shot landed: a tick (a body), a ping (a head), a deeper knock (a kill). */
  hitMarker(head: boolean, kill: boolean): void {
    const t = this.now;
    if (kill) {
      this.tone(520, t, 0.09, { type: "triangle", gain: 0.1 });
      this.tone(780, t + 0.06, 0.12, { type: "triangle", gain: 0.09 });
    } else if (head) this.tone(1500, t, 0.07, { type: "sine", gain: 0.1, to: 1900 });
    else this.noise(t, 0.03, { gain: 0.12, freq: 2800, type: "bandpass" });
  }

  /** A bullet striking near you: the snap of the round and the hit. */
  impact(near: number, metal: boolean): void {
    if (near <= 0.05 || this.busy(VOICE_CAP - 10)) return;
    this.noise(this.now, 0.04, { gain: 0.12 * near, freq: metal ? 4200 : 1800, type: metal ? "highpass" : "bandpass" });
  }

  /** Armour plated on, or a pickup into the pouch. */
  plate(): void {
    const t = this.now;
    this.noise(t, 0.12, { gain: 0.12, freq: 900, type: "bandpass" });
    this.tone(180, t + 0.05, 0.08, { type: "sine", gain: 0.12, to: 120 });
  }

  /** A recorded sound from the sample layer (samples.ts), if it's there: true when it played. */
  private sample(name: string, gain: number, rate = 1): boolean {
    const ctx = this.ctx;
    const buf = sampleBuffer(name);
    if (!ctx || !buf || !this.sfx) return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (rate !== 1) src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.sfx);
    src.start();
    return true;
  }

  /** A car blowing up: a deep boom, a roar of noise, debris after. */
  explosion(near: number): void {
    if (this.sample("explosion", 0.9 * near)) return;
    const t = this.now;
    this.tone(60, t, 1.2, { type: "sine", gain: 0.6 * near, to: 25 });
    this.noise(t, 1.4, { gain: 0.45 * near, freq: 500, type: "lowpass" });
    this.noise(t + 0.02, 0.5, { gain: 0.2 * near, freq: 3000, type: "highpass" });
    for (let i = 0; i < 5; i++) this.noise(t + 0.4 + i * 0.13, 0.08, { gain: 0.06 * near, freq: 2500, type: "bandpass" });
  }

  private engineNodes: { osc: OscillatorNode; sub: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;

  /**
   * The engine you hear (yours, or the nearest car going): `level` 0 … 1
   * (0 stops it), `rev` 0 … 1 (its speed). One voice, kept running.
   */
  engine(level: number, rev: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const t = ctx.currentTime;
    if (level <= 0.01) {
      if (this.engineNodes) {
        const n = this.engineNodes;
        this.engineNodes = null;
        n.gain.gain.setTargetAtTime(0, t, 0.08);
        n.osc.stop(t + 0.4);
        n.sub.stop(t + 0.4);
      }
      return;
    }
    if (!this.engineNodes) {
      const osc = ctx.createOscillator();
      const sub = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      osc.type = "sawtooth";
      sub.type = "square";
      filter.type = "lowpass";
      filter.frequency.value = 400;
      gain.gain.value = 0;
      osc.connect(filter);
      sub.connect(filter);
      filter.connect(gain).connect(this.sfx);
      osc.start();
      sub.start();
      this.engineNodes = { osc, sub, gain, filter };
    }
    const n = this.engineNodes;
    const f = 38 + rev * 70;
    n.osc.frequency.setTargetAtTime(f, t, 0.1);
    n.sub.frequency.setTargetAtTime(f / 2, t, 0.1);
    n.filter.frequency.setTargetAtTime(300 + rev * 900, t, 0.1);
    n.gain.gain.setTargetAtTime(0.05 * level * (0.6 + rev * 0.4), t, 0.1);
  }

  /** A foot in a puddle: a wet slap and a spray. */
  splash(mine: boolean): void {
    const t = this.now;
    this.noise(t, 0.16, { gain: mine ? 0.16 : 0.07, freq: 1500, type: "bandpass" });
    this.noise(t + 0.03, 0.22, { gain: mine ? 0.1 : 0.05, freq: 3800, type: "highpass" });
  }

  /** A ball picked up, or dropped in a basket. */
  ball(banked: boolean): void {
    const t = this.now;
    this.tone(banked ? 180 : 240, t, 0.12, { type: "sine", gain: 0.2, to: banked ? 110 : 160 });
    this.noise(t, 0.05, { gain: 0.06, freq: 900, type: "lowpass" });
  }

  // ── Open worlds (SPEC-V3 §7, Phase 3) ──────────────────────────────────────

  /**
   * The sky laser coming down: a rising, tightening whine over `dur`
   * seconds; `near` 0 … 1 (far beams are barely there, out of range silent).
   */
  skyWarn(dur: number, near: number): void {
    if (near <= 0.03 || this.busy(VOICE_CAP - 4)) return;
    const t = this.now;
    this.tone(180, t, dur + 0.05, { type: "sawtooth", gain: 0.045 * near, to: 1500, attack: dur * 0.9 });
    this.tone(270, t, dur + 0.05, { type: "sine", gain: 0.07 * near, to: 2200, attack: dur * 0.9 });
  }

  /** It hits: a white crack, a deep thump and the hiss of the smoke. */
  skyHit(near: number): void {
    const t = this.now;
    // Several struck at once far away (Ball Haunt's catches come in batches): one stands for them all.
    if (near < 0.5) {
      if (t - this.farZapAt < 0.08) return;
      this.farZapAt = t;
    }
    const g = Math.max(0.12, near);
    this.noise(t, 0.09, { gain: 0.55 * g, freq: 2600, type: "highpass" });
    this.tone(95, t, 0.7, { type: "sine", gain: 0.5 * g, to: 34 });
    this.tone(1900, t, 0.22, { type: "sawtooth", gain: 0.045 * g, to: 280 });
    this.noise(t + 0.05, 1.3, { gain: 0.1 * g, freq: 900, type: "lowpass" });
  }

  /** Into the backpack: a soft double click and a cloth rustle. */
  pickup(): void {
    const t = this.now;
    this.tone(660, t, 0.05, { type: "triangle", gain: 0.1 });
    this.tone(990, t + 0.06, 0.06, { type: "triangle", gain: 0.08 });
    this.noise(t, 0.12, { gain: 0.05, freq: 2400, type: "bandpass" });
  }

  /** v5: each item used has its own sound. */
  useItem(kind: string): void {
    const t = this.now;
    switch (kind) {
      case "kola": // An injector: click, hiss, the rush.
        this.noise(t, 0.02, { gain: 0.1, freq: 3000, type: "bandpass" });
        this.noise(t + 0.03, 0.28, { gain: 0.08, freq: 5200, type: "highpass" });
        this.tone(220, t + 0.1, 0.4, { type: "sine", gain: 0.06, to: 660 });
        break;
      case "zobo": // A flask: two gulps.
        this.tone(260, t, 0.12, { type: "sine", gain: 0.16, to: 140 });
        this.tone(240, t + 0.2, 0.12, { type: "sine", gain: 0.14, to: 130 });
        break;
      case "big-bag": // A long zip.
        for (let k = 0; k < 7; k++) this.noise(t + k * 0.035, 0.03, { gain: 0.07, freq: 3400 + k * 300, type: "bandpass" });
        break;
      case "smoke-pot": // The pin, then the hiss of the canister.
        this.tone(1900, t, 0.04, { type: "triangle", gain: 0.07 });
        this.noise(t + 0.08, 1.1, { gain: 0.12, freq: 2600, type: "highpass" });
        break;
      case "talking-drum": // A scanner's sweep.
        this.tone(700, t, 0.16, { type: "sine", gain: 0.09, to: 1500 });
        this.tone(1500, t + 0.2, 0.09, { type: "sine", gain: 0.08 });
        break;
      case "aso-ebi": // Cloth pulled on.
        this.noise(t, 0.22, { gain: 0.09, freq: 1700, type: "bandpass" });
        break;
      case "decoy-flag": // A flag shaken out.
        for (let k = 0; k < 4; k++) this.noise(t + k * 0.07, 0.06, { gain: 0.07, freq: 1100, type: "bandpass" });
        break;
      case "zone-shield": // A shield coming up.
        this.tone(180, t, 0.45, { type: "triangle", gain: 0.09, to: 720 });
        break;
      case "jerrycan": // Fuel poured.
        this.noise(t, 0.5, { gain: 0.08, freq: 900, type: "bandpass" });
        break;
      case "titan-serum": // An auto-injector's punch, then a low surge and a heartbeat.
        this.noise(t, 0.03, { gain: 0.12, freq: 2400, type: "bandpass" });
        this.tone(70, t + 0.05, 0.7, { type: "sawtooth", gain: 0.09, to: 140 });
        this.tone(55, t + 0.45, 0.16, { type: "sine", gain: 0.2, to: 40 });
        this.tone(55, t + 0.7, 0.16, { type: "sine", gain: 0.16, to: 40 });
        break;
      case "map-print": // Paper unfolded, then a sweep and three pings.
        this.noise(t, 0.18, { gain: 0.08, freq: 1500, type: "bandpass" });
        this.tone(500, t + 0.15, 0.3, { type: "sine", gain: 0.07, to: 1400 });
        for (let k = 0; k < 3; k++) this.tone(1760, t + 0.5 + k * 0.14, 0.08, { type: "sine", gain: 0.06 });
        break;
      case "danfo-key": // A key fob's two chirps.
        this.tone(2100, t, 0.06, { type: "square", gain: 0.04 });
        this.tone(2100, t + 0.11, 0.06, { type: "square", gain: 0.04 });
        break;
      default:
        this.noise(t, 0.09, { gain: 0.06, freq: 2100, type: "bandpass" });
        this.tone(520, t, 0.08, { type: "triangle", gain: 0.06, to: 780 });
    }
  }

  /** The backpack's full: a dull knock. */
  full(): void {
    const t = this.now;
    this.tone(140, t, 0.12, { type: "square", gain: 0.06, to: 110 });
  }

  /** Airfall's flare goes up: a fizzing hiss rising into the sky. */
  flare(near: number): void {
    const t = this.now;
    const g = Math.max(0.2, near);
    this.noise(t, 1.6, { gain: 0.12 * g, freq: 3000, type: "bandpass" });
    this.tone(500, t, 1.4, { type: "sawtooth", gain: 0.02 * g, to: 1600, attack: 0.3 });
  }

  /** A crate opened: wood knocks and a creak. */
  crate(): void {
    const t = this.now;
    this.tone(180, t, 0.08, { type: "triangle", gain: 0.12, to: 130 });
    this.tone(160, t + 0.09, 0.08, { type: "triangle", gain: 0.1, to: 120 });
    this.tone(420, t + 0.15, 0.3, { type: "sawtooth", gain: 0.025, to: 300 });
  }

  /** One heartbeat, lub-dub; `level` 0 … 1 makes it harder (the zone's meter). */
  heartbeat(level: number): void {
    const t = this.now;
    const g = 0.18 + 0.32 * level;
    this.tone(58, t, 0.2, { type: "sine", gain: g, to: 40 });
    this.tone(52, t + 0.16, 0.18, { type: "sine", gain: g * 0.65, to: 38 });
  }

  /** The zone starts closing: two low notes on a horn. */
  zoneAlert(): void {
    const t = this.now;
    this.tone(hz(45), t, 0.45, { type: "sawtooth", gain: 0.07, attack: 0.04 });
    this.tone(hz(45) * 1.5, t + 0.5, 0.6, { type: "sawtooth", gain: 0.07, attack: 0.04 });
  }

  // ── Free For All (SPEC-V3 §4, Phase 4) ─────────────────────────────────────

  /** A parry: a sharp clap of forearms and a ring. */
  parry(): void {
    const t = this.now;
    this.noise(t, 0.05, { gain: 0.3, freq: 3200, type: "highpass" });
    this.tone(1250, t, 0.25, { type: "triangle", gain: 0.07, to: 1100 });
  }

  /** Down on the ground: a body's thud and the dust. `near` 0 … 1. */
  thud(near: number): void {
    if (near <= 0.05) return;
    const t = this.now;
    this.tone(62, t, 0.3, { type: "sine", gain: 0.45 * near, to: 34 });
    this.noise(t + 0.02, 0.35, { gain: 0.12 * near, freq: 500, type: "lowpass" });
  }

  /** A flag in someone's hands: a talking-drum rise (yours: louder and higher). */
  flag(mine: boolean): void {
    const t = this.now;
    const g = mine ? 0.3 : 0.14;
    this.tone(mine ? 190 : 150, t, 0.16, { type: "sine", gain: g, to: mine ? 320 : 240 });
    this.tone(mine ? 260 : 200, t + 0.15, 0.22, { type: "sine", gain: g * 0.8, to: mine ? 420 : 300 });
  }

  /** Treasure Hunt: a box's lid; then a treasure found (a bright rising chime) or nothing. */
  treasure(mine: boolean, near = 1): void {
    if (near <= 0.02) return;
    const t = this.now;
    const g = (mine ? 0.22 : 0.1) * near;
    for (const [k, f] of [523, 659, 784, 1047].entries()) this.tone(f, t + k * 0.07, 0.5, { type: "triangle", gain: g * (1 - k * 0.12), attack: 0.004 });
    this.tone(2093, t + 0.28, 0.9, { type: "sine", gain: g * 0.35, attack: 0.002 });
  }

  /** The upload machine: a scanning beep each `step` (0…1 along), then a long confirm tone when done. */
  uploadBeep(along: number, done = false): void {
    const t = this.now;
    if (done) {
      this.tone(880, t, 0.18, { type: "square", gain: 0.06 });
      this.tone(1320, t + 0.16, 0.6, { type: "square", gain: 0.06 });
      return;
    }
    this.tone(600 + along * 700, t, 0.07, { type: "square", gain: 0.035 });
  }

  /** The radio: a burst of static and two blips (a hint is in). */
  /** Dead Streets (§3.4 #18): a church bell far off, soft (a sanctuary near). Never a jump scare. */
  bell(near: number): void {
    if (near <= 0.02) return;
    const t = this.now;
    for (const [f, g] of [[392, 1], [784, 0.35], [1175, 0.18]] as const) this.tone(f, t, 3.2, { type: "sine", gain: 0.05 * g * near, attack: 0.005 });
  }

  /** A Screamer's call (§3.4 #2): a rising, ragged wail. */
  scream(near: number): void {
    if (near <= 0.02) return;
    const t = this.now;
    this.tone(420, t, 1.1, { type: "sawtooth", gain: 0.06 * near, to: 980, attack: 0.08 });
    this.noise(t, 1.0, { gain: 0.05 * near, freq: 1400, type: "bandpass" });
  }

  /** The talking drum before a horde (§3.4 #1): three quick bent tones. */
  talkingDrum(): void {
    const t = this.now;
    [0, 0.18, 0.32].forEach((at, i) => this.tone(i === 1 ? 220 : 180, t + at, 0.22, { type: "sine", gain: 0.12, to: i === 1 ? 300 : 120, attack: 0.005 }));
  }

  radio(): void {
    const t = this.now;
    this.noise(t, 0.35, { gain: 0.08, freq: 2000, type: "bandpass" });
    this.tone(880, t + 0.38, 0.07, { type: "square", gain: 0.05 });
    this.tone(1320, t + 0.48, 0.09, { type: "square", gain: 0.05 });
  }

  /** A stash spot searched and empty: a hollow knock. */
  empty(): void {
    const t = this.now;
    this.tone(210, t, 0.09, { type: "triangle", gain: 0.1, to: 160 });
    this.noise(t, 0.08, { gain: 0.05, freq: 1200, type: "bandpass" });
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

  /** Victory's sting under the cinematic: a boom, then a cut of a downloaded track (v4 rework: no chords made here). */
  victory(): void {
    const t = this.now;
    this.tone(62, t, 0.7, { type: "sine", gain: 0.32, to: 38 });
    this.noise(t, 0.5, { gain: 0.08, freq: 260, type: "lowpass" });
    this.score.sting("victory", "ending");
  }

  /** Defeat's sting: a boom, then a dark cut of a downloaded track. */
  defeat(): void {
    const t = this.now;
    this.tone(55, t, 0.9, { type: "sine", gain: 0.3, to: 32 });
    this.noise(t, 0.6, { gain: 0.07, freq: 180, type: "lowpass" });
    this.score.sting("defeat");
  }

  /** v6: the daily chest: the lid's wooden knock, then a bright chime and coins. */
  chestOpen(): void {
    const t = this.now;
    this.noise(t, 0.09, { gain: 0.16, freq: 380, type: "lowpass" });
    this.tone(150, t, 0.14, { type: "sine", gain: 0.22, to: 85 });
    for (const [k, f] of [784, 988, 1175, 1568].entries()) this.tone(f, t + 0.42 + k * 0.06, 0.45, { type: "triangle", gain: 0.13 * (1 - k * 0.12), attack: 0.004 });
    for (let k = 0; k < 6; k++) this.tone(2300 + k * 190, t + 0.46 + k * 0.05, 0.05, { type: "square", gain: 0.022 });
  }

  ui(): void {
    const t = this.now;
    this.tone(880, t, 0.05, { type: "sine", gain: 0.08 });
  }
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
}
