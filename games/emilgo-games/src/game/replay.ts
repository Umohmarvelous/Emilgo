// The replay recorder (SPEC-V2 §2.7–2.9): a ring buffer of what the round
// looked like, kept small enough for a low-end phone.
//
// Each phone records what it SHOWS — the local referee in Solo, the server's
// snapshots (everyone else drawn 120 ms back, you predicted) online — 20 times
// a second, for the last 12 seconds: every runner (where, which way, how fast,
// stance, status, what they're doing, the ball they hold), every ball, and
// Mama (which way she faces, her head, whether she's watching). That's about
// 220 KB for a full room of 20 with 13 balls.
//
// From it the game cuts clips: the kill cam (the 2 s before you were shot,
// replayed from her eyes) and the play of the game (the best moment, kept the
// moment it's found, replayed after the match). A clip is a plain copy of
// frames; playing it is the replay view's job (rlgl/replayView.ts).
//
// Pure: no three.js, no DOM.

import { ballState, type Ball } from "./balls";
import { actCode } from "./combat";
import type { Contestant } from "./rules";

export const REPLAY = {
  /** Frames a second. */
  hz: 20,
  /** Seconds kept. */
  keep: 12,
} as const;

/** Per frame: t (seconds of play), phase index, doll yaw, doll head yaw, doll watching (0/1). */
const HEAD = 5;
/** Per runner: x, z, y, heading, vx, vz, stance, flags, ball. */
export const RUNNER = 9;
/** Per ball: x, z, state (balls.ts ballState). */
export const BALL = 3;

/** Flags: status (0 alive, 1 finished, 2 out) | sliding << 2 | action code << 3 | stunned << 6. */
export function packRunner(c: Contestant): number {
  const st = c.status === "alive" ? 0 : c.status === "finished" ? 1 : 2;
  return st | ((c.slide > 0 ? 1 : 0) << 2) | (actCode(c.actKind) << 3) | ((c.stun > 0 ? 1 : 0) << 6);
}

export function runnerStatus(flags: number): Contestant["status"] {
  const st = flags & 3;
  return st === 0 ? "alive" : st === 1 ? "finished" : "eliminated";
}

/** What Mama looks like this frame (the recorder doesn't know about three.js). */
export interface DollPose {
  yaw: number;
  head: number;
  watching: boolean;
}

/** A cut of the recording: `count` frames of `size` numbers each, oldest first. */
export interface Clip {
  readonly people: number;
  readonly balls: number;
  readonly size: number;
  readonly count: number;
  readonly data: Float32Array;
}

export function frameSize(people: number, balls: number): number {
  return HEAD + people * RUNNER + balls * BALL;
}

/** Read frame `f` of a clip: its time, phase and Mama. */
export function frameHead(clip: Clip, f: number): { t: number; phase: number; doll: DollPose } {
  const o = f * clip.size;
  const d = clip.data;
  return { t: d[o], phase: d[o + 1], doll: { yaw: d[o + 2], head: d[o + 3], watching: d[o + 4] > 0.5 } };
}

/** Offset of runner `i` in frame `f`. */
export function runnerAt(clip: Clip, f: number, i: number): number {
  return f * clip.size + HEAD + i * RUNNER;
}

/** Offset of ball `b` in frame `f`. */
export function ballAt(clip: Clip, f: number, b: number): number {
  return f * clip.size + HEAD + clip.people * RUNNER + b * BALL;
}

export class Recorder {
  readonly size: number;
  readonly capacity = REPLAY.hz * REPLAY.keep;
  private readonly ring: Float32Array;
  /** Frames written in all (the newest is at (written − 1) % capacity). */
  private written = 0;
  private clock = 0;

  constructor(
    readonly people: number,
    readonly balls: number,
  ) {
    this.size = frameSize(people, balls);
    this.ring = new Float32Array(this.size * this.capacity);
  }

  /** Call every fixed step of play (`dt` real seconds); a frame is kept REPLAY.hz times a second. */
  step(dt: number, t: number, phase: number, list: readonly Contestant[], balls: readonly Ball[], doll: DollPose): void {
    this.clock -= dt;
    if (this.clock > 0 && this.written > 0) return;
    this.clock += 1 / REPLAY.hz;
    if (this.clock < 0) this.clock = 0;
    const o = (this.written % this.capacity) * this.size;
    const r = this.ring;
    r[o] = t;
    r[o + 1] = phase;
    r[o + 2] = doll.yaw;
    r[o + 3] = doll.head;
    r[o + 4] = doll.watching ? 1 : 0;
    let k = o + HEAD;
    for (let i = 0; i < this.people; i++, k += RUNNER) {
      const c = list[i];
      if (!c) continue;
      r[k] = c.x;
      r[k + 1] = c.z;
      r[k + 2] = c.y;
      r[k + 3] = c.heading;
      r[k + 4] = c.vx;
      r[k + 5] = c.vz;
      r[k + 6] = c.stance;
      r[k + 7] = packRunner(c);
      r[k + 8] = c.ball;
    }
    for (let b = 0; b < this.balls; b++, k += BALL) {
      const ball = balls[b];
      if (!ball) continue;
      r[k] = ball.x;
      r[k + 1] = ball.z;
      r[k + 2] = ballState(ball);
    }
    this.written++;
  }

  /** Time of the newest frame (−1: none yet). */
  get latest(): number {
    return this.written ? this.ring[((this.written - 1) % this.capacity) * this.size] : -1;
  }

  /** Time of the oldest frame still kept. */
  get oldest(): number {
    if (!this.written) return -1;
    const first = Math.max(0, this.written - this.capacity);
    return this.ring[(first % this.capacity) * this.size];
  }

  /** Copy every kept frame with t0 ≤ t ≤ t1, oldest first (null: none). */
  clip(t0: number, t1: number): Clip | null {
    const first = Math.max(0, this.written - this.capacity);
    let from = -1;
    let to = -1;
    for (let w = first; w < this.written; w++) {
      const t = this.ring[(w % this.capacity) * this.size];
      if (t < t0 - 1e-6) continue;
      if (t > t1 + 1e-6) break;
      if (from < 0) from = w;
      to = w;
    }
    if (from < 0 || to - from < 2) return null;
    const count = to - from + 1;
    const data = new Float32Array(count * this.size);
    for (let w = from; w <= to; w++) {
      const src = (w % this.capacity) * this.size;
      data.set(this.ring.subarray(src, src + this.size), (w - from) * this.size);
    }
    return { people: this.people, balls: this.balls, size: this.size, count, data };
  }

  reset(): void {
    this.written = 0;
    this.clock = 0;
  }
}
