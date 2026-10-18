// Camera shots for the match flow (SPEC-V2 §1.3): walkouts, field previews,
// the tutorial. A shot is a length and a function from progress (0…1) to a
// frame; a reel is shots back to back, each one a cut. Any game builds its own
// shot list from these.
//
//   dolly   glide from one place to another, looking from one point to another
//   orbit   circle a point, rising or falling
//   hold    stand still
//   follow  any frame computed live (tracking something that moves)

import { Vector3 } from "three";

export type V3 = readonly [number, number, number];

/** Where the lens is, what it looks at, and how wide (vertical degrees). */
export interface Frame {
  pos: Vector3;
  look: Vector3;
  fov: number;
}

export interface Shot {
  /** Seconds. */
  dur: number;
  /** Fill `out` for progress u (0…1, eased by the shot itself). */
  at(u: number, out: Frame): void;
}

export function frame(): Frame {
  return { pos: new Vector3(), look: new Vector3(), fov: 50 };
}

/** Slow in, slow out. */
export const smooth = (u: number) => u * u * (3 - 2 * u);
/** Moving already, settling at the end. */
export const settle = (u: number) => 1 - Math.pow(1 - u, 3);

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

export function dolly(dur: number, from: V3, to: V3, lookFrom: V3, lookTo: V3, fov: number, ease = smooth): Shot {
  return {
    dur,
    at(u, out) {
      const e = ease(u);
      out.pos.set(lerp(from[0], to[0], e), lerp(from[1], to[1], e), lerp(from[2], to[2], e));
      out.look.set(lerp(lookFrom[0], lookTo[0], e), lerp(lookFrom[1], lookTo[1], e), lerp(lookFrom[2], lookTo[2], e));
      out.fov = fov;
    },
  };
}

/** Round `centre` from angle a0 to a1 (0 = on the +Z side), at `radius`, height h0 → h1. */
export function orbit(dur: number, centre: V3, radius: number, a0: number, a1: number, h0: number, h1: number, lookY: number, fov: number): Shot {
  return {
    dur,
    at(u, out) {
      const e = smooth(u);
      const a = lerp(a0, a1, e);
      out.pos.set(centre[0] + Math.sin(a) * radius, lerp(h0, h1, e), centre[2] + Math.cos(a) * radius);
      out.look.set(centre[0], lookY, centre[2]);
      out.fov = fov;
    },
  };
}

export function hold(dur: number, pos: V3, look: V3, fov: number): Shot {
  return dolly(dur, pos, pos, look, look, fov);
}

export function follow(dur: number, at: (u: number, out: Frame) => void): Shot {
  return { dur, at };
}

/** A reel: shots back to back. */
export class Reel {
  readonly length: number;

  constructor(readonly shots: readonly Shot[]) {
    this.length = shots.reduce((s, x) => s + x.dur, 0);
  }

  /** The frame at time t (clamped to the reel); returns the shot's index. */
  at(t: number, out: Frame): number {
    let start = 0;
    for (let i = 0; i < this.shots.length; i++) {
      const s = this.shots[i];
      if (t < start + s.dur || i === this.shots.length - 1) {
        s.at(Math.max(0, Math.min(1, (t - start) / s.dur)), out);
        return i;
      }
      start += s.dur;
    }
    return -1;
  }

  /** When shot `i` starts. */
  startOf(i: number): number {
    let t = 0;
    for (let k = 0; k < i && k < this.shots.length; k++) t += this.shots[k].dur;
    return t;
  }
}
