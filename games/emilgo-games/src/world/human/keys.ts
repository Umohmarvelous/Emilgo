// Keyframed poses: a few hand-set keys per movement, played back smoothly.
//
// A clip is keys at times through a period (looping, for dances) or once (a
// fall). Between keys every channel follows a Catmull-Rom curve through the
// keys round it, so motion eases through each key instead of stopping there.
// A bone a key leaves out is at rest (0) in that key.
//
// Conventions as animator.ts: −X swings a limb forward, +X a knee bends, +X a
// foot points its toes; spine, chest and head +X lean forward, +Y turn left;
// +Z lifts a left limb out (−Z a right one) and raises the left hip.

import type { Pose } from "./animator";
import { BONE_INDEX, type BoneName } from "./skeleton";

export type V3 = [number, number, number];

export interface Key {
  t: number;
  /** Bone rotations. */
  b: Partial<Record<BoneName, V3>>;
  /** The hips' offset (x, y, z), metres. */
  hips?: V3;
  /** Finger curl, left and right (0 open … 1 fist). */
  curl?: [number, number];
}

export interface Clip {
  period: number;
  loop: boolean;
  keys: Key[];
  /** Every bone some key moves. */
  bones: BoneName[];
  hips: boolean;
  curl: boolean;
}

export function clip(period: number, loop: boolean, keys: Key[]): Clip {
  const bones = new Set<BoneName>();
  for (const k of keys) for (const b of Object.keys(k.b)) bones.add(b as BoneName);
  return { period, loop, keys: keys.slice().sort((a, b) => a.t - b.t), bones: [...bones], hips: keys.some((k) => k.hips), curl: keys.some((k) => k.curl) };
}

const swap = (b: string) => (b.endsWith("L") ? `${b.slice(0, -1)}R` : b.endsWith("R") ? `${b.slice(0, -1)}L` : b) as BoneName;

/** A key with left and right swapped, at time t (a dance's other half). */
export function mirrorKey(k: Key, t: number): Key {
  const b: Partial<Record<BoneName, V3>> = {};
  // Across the body's middle: X stays, Y and Z change sign.
  for (const [n, v] of Object.entries(k.b) as [BoneName, V3][]) b[swap(n)] = [v[0], -v[1], -v[2]];
  return { t, b, hips: k.hips ? [-k.hips[0], k.hips[1], k.hips[2]] : undefined, curl: k.curl ? [k.curl[1], k.curl[0]] : undefined };
}

/** The same clip, left and right swapped (a fall to the other side). */
export function mirror(c: Clip): Clip {
  return clip(
    c.period,
    c.loop,
    c.keys.map((k) => mirrorKey(k, k.t)),
  );
}

function cr(p0: number, p1: number, p2: number, p3: number, u: number): number {
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
}

const ZERO: V3 = [0, 0, 0];

/**
 * Pose `out` at time t, blended in by w (1: the clip's pose; less: part way
 * from what `out` already holds). Only the channels the clip moves change.
 */
export function play(c: Clip, t: number, out: Pose, w = 1): void {
  if (w <= 0) return;
  const K = c.keys;
  const n = K.length;
  let tt = c.loop ? ((t % c.period) + c.period) % c.period : Math.max(K[0].t, Math.min(K[n - 1].t, t));
  // The segment [i, i+1] holding tt (for a loop the last runs on to the first, a period later).
  let i = n - 1;
  for (let k = 0; k < n - 1; k++)
    if (tt < K[k + 1].t) {
      i = k;
      break;
    }
  if (!c.loop && i === n - 1) i = n - 2;
  if (c.loop && tt < K[0].t) tt += c.period;
  const at = (j: number): Key => K[c.loop ? ((j % n) + n) % n : Math.max(0, Math.min(n - 1, j))];
  const time = (j: number): number => (c.loop ? K[((j % n) + n) % n].t + Math.floor(j / n) * c.period : at(j).t);
  const t1 = time(i);
  const t2 = time(i + 1);
  const u = t2 > t1 ? Math.max(0, Math.min(1, (tt - t1) / (t2 - t1))) : 0;
  const k0 = at(i - 1);
  const k1 = at(i);
  const k2 = at(i + 1);
  const k3 = at(i + 2);
  for (const b of c.bones) {
    const a0 = k0.b[b] ?? ZERO;
    const a1 = k1.b[b] ?? ZERO;
    const a2 = k2.b[b] ?? ZERO;
    const a3 = k3.b[b] ?? ZERO;
    const o = BONE_INDEX[b] * 3;
    for (let x = 0; x < 3; x++) {
      const v = cr(a0[x], a1[x], a2[x], a3[x], u);
      out.rot[o + x] += (v - out.rot[o + x]) * w;
    }
  }
  if (c.hips) {
    const h = (k: Key) => k.hips ?? ZERO;
    const v = [0, 1, 2].map((x) => cr(h(k0)[x], h(k1)[x], h(k2)[x], h(k3)[x], u));
    out.hipsX += (v[0] - out.hipsX) * w;
    out.hipsY += (v[1] - out.hipsY) * w;
    out.hipsZ += (v[2] - out.hipsZ) * w;
  }
  if (c.curl) {
    const f = (k: Key, s: 0 | 1) => (k.curl ?? [0.4, 0.4])[s];
    out.curlL += (cr(f(k0, 0), f(k1, 0), f(k2, 0), f(k3, 0), u) - out.curlL) * w;
    out.curlR += (cr(f(k0, 1), f(k1, 1), f(k2, 1), f(k3, 1), u) - out.curlR) * w;
  }
}

/** Add a clip's pose on top of `out` (a reaction over whatever the body is doing), scaled by w. */
export function playAdd(c: Clip, t: number, out: Pose, w = 1): void {
  if (w <= 0) return;
  _tmp.clear();
  _tmp.curlL = _tmp.curlR = 0;
  play(c, t, _tmp, 1);
  for (const b of c.bones) {
    const o = BONE_INDEX[b] * 3;
    for (let x = 0; x < 3; x++) out.rot[o + x] += _tmp.rot[o + x] * w;
  }
  if (c.hips) {
    out.hipsX += _tmp.hipsX * w;
    out.hipsY += _tmp.hipsY * w;
    out.hipsZ += _tmp.hipsZ * w;
  }
}

let _tmp: Pose;
/** animator.ts hands over a scratch pose (keys.ts can't make one: it would import animator.ts back). */
export function setScratch(p: Pose): void {
  _tmp = p;
}
