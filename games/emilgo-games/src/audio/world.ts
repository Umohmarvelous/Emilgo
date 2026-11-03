// The world's sound (v4 Phase 8): things you hear before you see them, and a
// score that follows the fight.
//
//   Emitters  turbines (a whoosh every blade pass), the club (the bass through
//             the walls, the whole mix at the door), generators, the
//             refinery's flares, the harbour's water and gulls, birds in the
//             forest, frogs in the swamp, the Arena's crowd. Each is a short
//             loop made here in code (nothing to download), through a
//             low-pass that opens as you come near, into a panner. Only the
//             nearest few play: 6 voices on Low, 12 above (pooled).
//   Music     explore (a soft pad) → combat (a pulse under it, for a while
//             after a shot or a hit) → final circle (faster, a riser) → low
//             health (everything low-passed); the win and lose stings stay
//             the Sound's own. Crossfaded, a bar at a time.
//
// A sample from the asset CDN takes over a loop when one is listed
// (samples.ts); otherwise the loops made here play.

import type { Sound } from "./sound";
import { sampleBuffer } from "./samples";

export type EmitterKind = "turbine" | "club" | "generator" | "flare" | "water" | "gulls" | "birds" | "frogs" | "crowd";

export interface Emitter {
  kind: EmitterKind;
  x: number;
  y: number;
  z: number;
  /** Heard to here (m). */
  range: number;
}

interface Voice {
  e: Emitter;
  src: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: PannerNode;
}

export type MusicState = "off" | "explore" | "combat" | "final" | "low";

const LOOP_S: Record<EmitterKind, number> = { turbine: 3.3, club: 1.935, generator: 1, flare: 2, water: 4, gulls: 7, birds: 6, frogs: 5, crowd: 4 };
const GAIN: Record<EmitterKind, number> = { turbine: 0.5, club: 0.7, generator: 0.25, flare: 0.45, water: 0.3, gulls: 0.35, birds: 0.3, frogs: 0.3, crowd: 0.45 };

/** Seeded noise for the loops (the same every time). */
function rnd(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

/** Make a loop for an emitter, sample by sample (mono). */
function makeLoop(ctx: BaseAudioContext, kind: EmitterKind): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(LOOP_S[kind] * sr);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const r = rnd(kind.length * 7919);
  let lp = 0;
  let lp2 = 0;
  const TAU = Math.PI * 2;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const n = r();
    let v = 0;
    switch (kind) {
      case "turbine": {
        // Low noise, swelling three times a turn as each blade sweeps past the tower.
        lp += (n - lp) * 0.02;
        const pass = Math.pow(0.5 + 0.5 * Math.cos(TAU * (t / LOOP_S.turbine) * 3), 3);
        v = lp * (0.25 + 1.6 * pass) * 3;
        break;
      }
      case "club": {
        // Four on the floor at 124 bpm, a bass line, a hat on the off-beats.
        const beat = 60 / 124;
        const bt = t % beat;
        const kick = Math.sin(TAU * (50 + 90 * Math.exp(-bt * 30)) * bt) * Math.exp(-bt * 9);
        const notes = [41, 41, 44, 39];
        const f = 440 * Math.pow(2, (notes[Math.floor(t / beat) % 4] - 69) / 12);
        const bass = Math.sign(Math.sin(TAU * f * t)) * 0.25 * Math.exp(-((t + beat / 2) % beat) * 4);
        const ht = (t + beat / 2) % beat;
        lp2 += (n - lp2) * 0.6;
        const hat = (n - lp2) * Math.exp(-ht * 60) * 0.5;
        v = kick * 0.9 + bass + hat;
        break;
      }
      case "generator":
        v = Math.sin(TAU * 50 * t) * 0.5 + Math.sin(TAU * 100 * t) * 0.25 + Math.sin(TAU * 150 * t) * 0.12 + n * 0.08;
        break;
      case "flare":
        lp += (n - lp) * 0.08;
        v = lp * 2.4 * (0.8 + 0.2 * Math.sin(TAU * 7 * t + Math.sin(TAU * 1.3 * t)));
        break;
      case "water":
        lp += (n - lp) * 0.03;
        v = lp * 2 * (0.6 + 0.4 * Math.sin(TAU * (t / LOOP_S.water) * 2));
        break;
      case "gulls": {
        // A cry now and then: a falling, rough tone.
        v = 0;
        for (const at of [0.6, 1.1, 3.9, 5.2]) {
          const u = t - at;
          if (u < 0 || u > 0.45) continue;
          const f = 1600 - u * 1500;
          v += Math.sin(TAU * f * u + Math.sin(TAU * 30 * u) * 2) * Math.sin((Math.PI * u) / 0.45) * 0.5;
        }
        break;
      }
      case "birds": {
        v = 0;
        for (let k = 0; k < 9; k++) {
          const at = (k * 0.67 + (k % 3) * 0.21) % LOOP_S.birds;
          const u = t - at;
          if (u < 0 || u > 0.12) continue;
          v += Math.sin(TAU * (3200 + 1400 * Math.sin(u * 90)) * u) * Math.sin((Math.PI * u) / 0.12) * 0.35;
        }
        break;
      }
      case "frogs": {
        const croak = (t * 2.3) % 1;
        v = croak < 0.15 ? Math.sign(Math.sin(TAU * 220 * t)) * Math.sin(TAU * 30 * t) * 0.3 * Math.sin((Math.PI * croak) / 0.15) : 0;
        // Crickets above it.
        v += Math.sin(TAU * 4800 * t) * (Math.sin(TAU * 18 * t) > 0.7 ? 0.08 : 0);
        break;
      }
      case "crowd":
        lp += (n - lp) * 0.25;
        lp2 += (lp - lp2) * 0.15;
        v = (lp - lp2) * 2.2 * (0.7 + 0.3 * Math.sin(TAU * (t / LOOP_S.crowd)));
        break;
    }
    d[i] = v;
  }
  // Ends meet: a short crossfade so the loop doesn't click.
  const x = Math.min(len >> 3, Math.floor(sr * 0.05));
  for (let i = 0; i < x; i++) {
    const w = i / x;
    d[i] = d[i] * w + d[len - x + i] * (1 - w);
  }
  return buf;
}

export class WorldSound {
  private readonly loops = new Map<EmitterKind, AudioBuffer>();
  private readonly voices: Voice[] = [];
  private emitters: Emitter[] = [];
  private pick = 0;
  private music: { gain: GainNode; filter: BiquadFilterNode; timer: number; at: number; bar: number } | null = null;
  private state: MusicState = "off";
  private wantState: MusicState = "off";

  constructor(
    private readonly sound: Sound,
    /** How many emitters may sound at once (6 Low, 12 above). */
    private readonly budget: number,
  ) {}

  setEmitters(list: Emitter[]): void {
    this.emitters = list;
  }

  private loop(kind: EmitterKind): AudioBuffer | null {
    const g = this.sound.graph;
    if (!g) return null;
    let b = sampleBuffer(`loop-${kind}`) ?? this.loops.get(kind) ?? null;
    if (!b) {
      b = makeLoop(g.ctx, kind);
      this.loops.set(kind, b);
    }
    return b;
  }

  /** Each frame: the listener where the camera is, the nearest emitters sounding, the music's state. */
  update(dt: number, cam: { x: number; y: number; z: number }, fwd: { x: number; y: number; z: number }): void {
    const g = this.sound.graph;
    if (!g) return;
    const ctx = g.ctx;
    const L = ctx.listener;
    const t = ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(cam.x, t, 0.05);
      L.positionY.setTargetAtTime(cam.y, t, 0.05);
      L.positionZ.setTargetAtTime(cam.z, t, 0.05);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.05);
      L.forwardY.setTargetAtTime(fwd.y, t, 0.05);
      L.forwardZ.setTargetAtTime(fwd.z, t, 0.05);
    } else {
      L.setPosition(cam.x, cam.y, cam.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
    // Every quarter second: who should be sounding (the nearest in range, up to the budget).
    this.pick -= dt;
    if (this.pick <= 0) {
      this.pick = 0.25;
      const near: [number, Emitter][] = [];
      for (const e of this.emitters) {
        const d = Math.hypot(e.x - cam.x, e.z - cam.z);
        if (d < e.range) near.push([d / e.range, e]);
      }
      near.sort((a, b) => a[0] - b[0]);
      const want = new Set(near.slice(0, this.budget).map((n) => n[1]));
      for (let k = this.voices.length - 1; k >= 0; k--) {
        const v = this.voices[k];
        if (want.has(v.e)) continue;
        v.gain.gain.setTargetAtTime(0, t, 0.3);
        const s = v.src;
        setTimeout(() => {
          try {
            s.stop();
          } catch {
            /* stopped */
          }
          v.pan.disconnect();
        }, 1500);
        this.voices.splice(k, 1);
      }
      for (const e of want) {
        if (this.voices.some((v) => v.e === e)) continue;
        const buf = this.loop(e.kind);
        if (!buf) continue;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const pan = ctx.createPanner();
        pan.panningModel = "equalpower";
        pan.distanceModel = "inverse";
        pan.refDistance = e.kind === "turbine" ? 14 : e.kind === "club" ? 8 : 5;
        pan.maxDistance = e.range;
        pan.rolloffFactor = 1.1;
        pan.positionX.value = e.x;
        pan.positionY.value = e.y;
        pan.positionZ.value = e.z;
        src.connect(filter).connect(gain).connect(pan).connect(g.sfx);
        src.start(t, Math.random() * buf.duration);
        this.voices.push({ e, src, filter, gain, pan });
      }
    }
    for (const v of this.voices) {
      const d = Math.hypot(v.e.x - cam.x, v.e.z - cam.z);
      const near = Math.max(0, 1 - d / v.e.range);
      // Far off only the low end carries (the club's bass through the walls); close, all of it.
      const open = v.e.kind === "club" ? 160 + 9000 * Math.pow(Math.max(0, 1 - d / 26), 2) : 400 + 9000 * near * near;
      v.filter.frequency.setTargetAtTime(open, t, 0.15);
      v.gain.gain.setTargetAtTime(GAIN[v.e.kind] * Math.min(1, near * 3), t, 0.2);
    }
    this.musicTick();
  }

  // ── Music ──

  /** The state the score should be in (it changes at the next bar). */
  setMusic(s: MusicState): void {
    this.wantState = s;
  }

  private musicTick(): void {
    const g = this.sound.graph;
    if (!g) return;
    const ctx = g.ctx;
    if (!this.music) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1800;
      gain.connect(filter).connect(g.music);
      this.music = { gain, filter, timer: 0, at: ctx.currentTime + 0.1, bar: 0 };
    }
    const M = this.music;
    const t = ctx.currentTime;
    if (this.wantState !== this.state) {
      this.state = this.wantState;
      const on = this.state !== "off";
      M.gain.gain.setTargetAtTime(on ? 0.42 : 0, t, on ? 1.2 : 0.6);
      M.filter.frequency.setTargetAtTime(this.state === "low" ? 380 : this.state === "combat" || this.state === "final" ? 2600 : 1500, t, 0.8);
    }
    if (this.state === "off") return;
    // Schedule a bar ahead.
    const bpm = this.state === "final" ? 124 : this.state === "combat" ? 104 : 84;
    const bar = (60 / bpm) * 4;
    while (M.at < t + 1.2) {
      this.bar(M.at, bar, M.bar++);
      M.at += bar;
    }
  }

  /** One bar of the score: the pad's chord, and (combat, final) the pulse; the final circle's riser. */
  private bar(at: number, len: number, n: number): void {
    const g = this.sound.graph!;
    const ctx = g.ctx;
    const out = this.music!.gain;
    // A minor walk, Am F C G.
    const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
    const ch = chords[n % 4];
    for (const midi of ch) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
        o.detune.value = det;
        const v = ctx.createGain();
        v.gain.setValueAtTime(0.0001, at);
        v.gain.exponentialRampToValueAtTime(0.035, at + len * 0.25);
        v.gain.setValueAtTime(0.035, at + len * 0.8);
        v.gain.exponentialRampToValueAtTime(0.0001, at + len * 1.02);
        o.connect(v).connect(out);
        o.start(at);
        o.stop(at + len * 1.05);
      }
    }
    if (this.state === "combat" || this.state === "final") {
      const beat = len / 4;
      for (let b = 0; b < 8; b++) {
        const tt = at + b * (beat / 2);
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(b % 2 ? 70 : 110, tt);
        o.frequency.exponentialRampToValueAtTime(45, tt + 0.12);
        const v = ctx.createGain();
        v.gain.setValueAtTime(b % 2 ? 0.12 : 0.22, tt);
        v.gain.exponentialRampToValueAtTime(0.0001, tt + 0.18);
        o.connect(v).connect(out);
        o.start(tt);
        o.stop(tt + 0.2);
      }
    }
    if (this.state === "final" && n % 4 === 3) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(220, at);
      o.frequency.exponentialRampToValueAtTime(880, at + len);
      const v = ctx.createGain();
      v.gain.setValueAtTime(0.0001, at);
      v.gain.exponentialRampToValueAtTime(0.04, at + len * 0.95);
      v.gain.exponentialRampToValueAtTime(0.0001, at + len);
      o.connect(v).connect(out);
      o.start(at);
      o.stop(at + len);
    }
  }

  dispose(): void {
    for (const v of this.voices) {
      try {
        v.src.stop();
      } catch {
        /* stopped */
      }
      v.pan.disconnect();
    }
    this.voices.length = 0;
    if (this.music) {
      const m = this.music;
      const g = this.sound.graph;
      if (g) m.gain.gain.setTargetAtTime(0, g.ctx.currentTime, 0.4);
      setTimeout(() => m.filter.disconnect(), 2000);
      this.music = null;
    }
    this.state = this.wantState = "off";
  }
}
