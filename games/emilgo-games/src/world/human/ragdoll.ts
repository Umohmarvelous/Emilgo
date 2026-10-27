// The fall (SPEC-V2 §2.6 step 4): a COD-style death on the body's own bones.
//
// No physics engine: every frame is a function of the seconds since the shot
// (AnimState.dead), so a fall plays the same at any frame rate, in slow
// motion (the caller just slows that body's clock), and again in a replay
// (the kill cam rewinds the clock). Three falls, picked by the person's seed:
//
//   thrown   the shot snaps the chest back, the knees give, they go over
//            backwards, arms trailing, and land flat with a small bounce
//   spin     the same hit, but the body rolls a quarter turn as it drops and
//            lands on its side
//   crumple  the legs fold first (down onto the knees), then they topple
//            over sideways
//
// Every fall lands, settles (a damped wobble, the limbs slapping down) and
// then lies still for the rest of the match: the bodies stay (step 10). The
// Human's ground solver keeps the lowest point on the ground all the way.
// Conventions as animator.ts: −X swings a limb forward, +Z swings a left limb
// out (−Z a right one), +X leans the spine and head forward.

import type { AnimState, Pose } from "./animator";
import { clip, mirror, play, type Clip } from "./keys";

/** Seconds from the shot until the body is down. */
export const FALL_TIME = 0.95;

export type FallKind = "thrown" | "spin" | "crumple";

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Which fall a person does: half are thrown back, the rest spin or crumple. */
export function fallKind(seed: number): FallKind {
  const u = (((seed * 7.13 + 0.37) % 1) + 1) % 1;
  return u < 0.5 ? "thrown" : u < 0.8 ? "spin" : "crumple";
}

/** Fall progress 0…1 (blob shadows read it): gravity-like, after the hit's beat. */
export function fallProgress(dead: number, kind: FallKind): number {
  const start = kind === "crumple" ? 0.32 : 0.1;
  const t = clamp01((dead - start) / (FALL_TIME - start));
  return t * t;
}

// The falls as keys (seconds from the shot), mirrored for the other side.
// Every one collapses like a person, not a plank: the knees give and the
// hips drop first, the body goes over with the arms thrown out and the
// head tucking, lands, and the limbs slap down and settle.

/** Thrown back: snapped back by the shot, sits down into the fall, lands on the back, arms spread. */
const BACK = clip(1.6, false, [
  { t: 0, b: {} },
  {
    t: 0.06,
    curl: [0.1, 0.12],
    b: {
      spine: [-0.25, 0, 0],
      chest: [-0.42, 0, 0],
      neck: [-0.2, 0, 0],
      head: [-0.55, 0, 0],
      clavL: [0, 0, 0.12],
      clavR: [0, 0, -0.12],
      upperArmL: [-1.4, 0, 0.35],
      upperArmR: [-1.3, 0, -0.35],
      foreArmL: [-0.7, 0, 0],
      foreArmR: [-0.6, 0, 0],
      shinL: [0.15, 0, 0],
      shinR: [0.12, 0, 0],
    },
  },
  {
    t: 0.22,
    hips: [0, -0.12, 0],
    curl: [0.1, 0.12],
    b: {
      spine: [-0.1, 0, 0],
      chest: [-0.2, 0, 0],
      head: [-0.25, 0, 0],
      thighL: [-0.55, 0, 0.1],
      thighR: [-0.5, 0, -0.1],
      shinL: [0.85, 0, 0],
      shinR: [0.8, 0, 0],
      footL: [-0.2, 0, 0],
      footR: [-0.2, 0, 0],
      clavL: [0, 0, 0.1],
      clavR: [0, 0, -0.1],
      upperArmL: [-1.9, 0, 0.6],
      upperArmR: [-1.8, 0, -0.6],
      foreArmL: [-0.5, 0, 0],
      foreArmR: [-0.45, 0, 0],
    },
  },
  {
    t: 0.5,
    hips: [0, -0.05, 0],
    curl: [0.15, 0.15],
    b: {
      spine: [0.12, 0, 0],
      chest: [0.08, 0, 0],
      neck: [0.15, 0, 0],
      head: [0.3, 0, 0],
      thighL: [-0.7, 0, 0.12],
      thighR: [-0.65, 0, -0.12],
      shinL: [0.9, 0, 0],
      shinR: [0.85, 0, 0],
      footL: [0.1, 0, 0],
      footR: [0.1, 0, 0],
      upperArmL: [-1.2, 0, 1.0],
      upperArmR: [-1.1, 0, -1.1],
      foreArmL: [-0.4, 0, 0],
      foreArmR: [-0.5, 0, 0],
    },
  },
  {
    t: 0.95,
    curl: [0.3, 0.3],
    b: {
      spine: [0.02, 0, 0],
      chest: [-0.05, 0, 0],
      neck: [-0.1, 0, 0],
      head: [-0.25, 0, 0],
      thighL: [-0.35, 0, 0.12],
      thighR: [-0.2, 0, -0.1],
      shinL: [0.6, 0, 0],
      shinR: [0.35, 0, 0],
      footL: [0.35, 0, 0],
      footR: [0.35, 0, 0],
      upperArmL: [-0.15, 0, 1.25],
      upperArmR: [-0.1, 0, -1.35],
      foreArmL: [-0.2, 0, 0],
      foreArmR: [-0.3, 0, 0],
      handL: [0, 0, 0.2],
      handR: [0, 0, -0.25],
    },
  },
  {
    t: 1.6,
    curl: [0.35, 0.3],
    b: {
      head: [-0.15, 0.55, 0.12],
      thighL: [-0.3, 0, 0.14],
      thighR: [-0.05, 0, -0.08],
      shinL: [0.65, 0, 0],
      shinR: [0.12, 0, 0],
      footL: [0.4, 0, 0],
      footR: [0.35, 0, 0],
      upperArmL: [-0.12, 0, 1.15],
      upperArmR: [-0.08, 0, -1.3],
      foreArmL: [-0.25, 0, 0],
      foreArmR: [-0.35, 0, 0],
      handL: [0, 0, 0.2],
      handR: [0, 0, -0.25],
    },
  },
]);

/** Thrown forward (shot from behind): whiplash, the knees go, arms reach out to break the fall, face down, head turned. */
const FRONT = clip(1.6, false, [
  { t: 0, b: {} },
  {
    t: 0.06,
    curl: [0.1, 0.1],
    b: {
      spine: [0.15, 0, 0],
      chest: [0.2, 0, 0],
      head: [-0.35, 0, 0],
      upperArmL: [0.6, 0, 0.4],
      upperArmR: [0.55, 0, -0.4],
      foreArmL: [-0.3, 0, 0],
      foreArmR: [-0.3, 0, 0],
      shinL: [0.15, 0, 0],
      shinR: [0.15, 0, 0],
    },
  },
  {
    t: 0.22,
    hips: [0, -0.1, 0],
    curl: [0.1, 0.1],
    b: {
      spine: [0.35, 0, 0],
      chest: [0.25, 0, 0],
      head: [0.1, 0, 0],
      thighL: [-0.45, 0, 0.06],
      thighR: [-0.4, 0, -0.06],
      shinL: [0.9, 0, 0],
      shinR: [0.85, 0, 0],
      footL: [0.1, 0, 0],
      footR: [0.1, 0, 0],
      upperArmL: [-0.9, 0, 0.3],
      upperArmR: [-1.0, 0, -0.3],
      foreArmL: [-0.6, 0, 0],
      foreArmR: [-0.6, 0, 0],
    },
  },
  {
    t: 0.5,
    curl: [0.05, 0.05],
    b: {
      spine: [0.2, 0, 0],
      chest: [0.15, 0, 0],
      head: [-0.3, 0, 0],
      thighL: [-0.3, 0, 0.08],
      thighR: [-0.25, 0, -0.08],
      shinL: [0.7, 0, 0],
      shinR: [0.6, 0, 0],
      footL: [0.3, 0, 0],
      footR: [0.3, 0, 0],
      upperArmL: [-1.7, 0, 0.45],
      upperArmR: [-1.7, 0, -0.45],
      foreArmL: [-0.3, 0, 0],
      foreArmR: [-0.3, 0, 0],
    },
  },
  {
    t: 0.95,
    curl: [0.05, 0.05],
    b: {
      spine: [-0.05, 0, 0],
      chest: [-0.1, 0, 0],
      head: [-0.45, 0.6, 0],
      thighL: [0.05, 0, 0.1],
      thighR: [0.05, 0, -0.1],
      shinL: [0.3, 0, 0],
      shinR: [0.15, 0, 0],
      footL: [0.5, 0, 0],
      footR: [0.5, 0, 0],
      upperArmL: [-2.2, 0, 0.75],
      upperArmR: [-1.0, 0, -0.9],
      foreArmL: [-1.2, 0, 0],
      foreArmR: [-1.4, 0, 0],
    },
  },
  {
    t: 1.6,
    curl: [0.05, 0.05],
    b: {
      spine: [-0.05, 0, 0],
      chest: [-0.08, 0, 0],
      head: [-0.35, 0.8, 0.1],
      thighL: [-0.25, 0, 0.35],
      thighR: [0.05, 0, -0.1],
      shinL: [0.9, 0, 0],
      shinR: [0.12, 0, 0],
      footL: [0.5, 0, 0],
      footR: [0.5, 0, 0],
      upperArmL: [-2.1, 0, 0.8],
      upperArmR: [-0.9, 0, -0.95],
      foreArmL: [-1.3, 0, 0],
      foreArmR: [-1.4, 0, 0],
    },
  },
]);

/** Spin: the shot twists them round, the legs cross and buckle, they drop on their side, arms in front. */
const SPIN = clip(1.6, false, [
  { t: 0, b: {} },
  {
    t: 0.06,
    curl: [0.1, 0.2],
    b: {
      hips: [0, 0.2, 0],
      chest: [-0.3, 0.5, 0],
      head: [-0.4, 0.4, 0],
      upperArmL: [-0.6, 0, 1.0],
      upperArmR: [-1.2, 0, -0.3],
      foreArmL: [-0.3, 0, 0],
      foreArmR: [-1.2, 0, 0],
      shinL: [0.15, 0, 0],
      shinR: [0.15, 0, 0],
    },
  },
  {
    t: 0.3,
    hips: [0, -0.1, 0],
    curl: [0.15, 0.25],
    b: {
      hips: [0, 0.7, 0],
      spine: [0.05, 0.3, 0.1],
      chest: [0.1, 0.35, 0.12],
      head: [0.1, 0.3, 0.2],
      thighL: [-0.3, 0, -0.2],
      shinL: [0.6, 0, 0],
      thighR: [-0.5, 0, -0.05],
      shinR: [0.9, 0, 0],
      upperArmL: [-1.5, 0, 1.2],
      upperArmR: [-0.6, 0, -0.9],
      foreArmL: [-0.3, 0, 0],
      foreArmR: [-0.9, 0, 0],
    },
  },
  {
    t: 0.6,
    hips: [0, -0.06, 0],
    curl: [0.2, 0.25],
    b: {
      hips: [0, 1.15, 0],
      spine: [0.1, 0.2, 0.2],
      chest: [0.1, 0.15, 0.15],
      head: [0.15, 0.2, 0.2],
      thighL: [-0.6, 0, 0],
      shinL: [0.8, 0, 0],
      thighR: [-0.4, 0, -0.05],
      shinR: [0.6, 0, 0],
      upperArmL: [-1.0, 0, 0.3],
      upperArmR: [-1.2, 0, -0.2],
      foreArmL: [-0.5, 0, 0],
      foreArmR: [-0.7, 0, 0],
    },
  },
  {
    t: 0.95,
    curl: [0.35, 0.3],
    b: {
      hips: [0, 1.35, 0],
      spine: [0.15, 0, 0.06],
      chest: [0.1, 0, 0.08],
      head: [0.15, 0.2, 0.15],
      thighL: [-0.75, 0, 0.05],
      shinL: [1.1, 0, 0],
      thighR: [-0.45, 0, -0.05],
      shinR: [0.6, 0, 0],
      footL: [0.3, 0, 0],
      footR: [0.3, 0, 0],
      upperArmL: [-1.1, 0, 0.22],
      upperArmR: [-1.3, 0, 0.15],
      foreArmL: [-0.55, 0, 0],
      foreArmR: [-0.75, 0, 0],
    },
  },
  {
    t: 1.6,
    curl: [0.35, 0.3],
    b: {
      hips: [0, 1.35, 0],
      spine: [0.12, 0, 0.05],
      chest: [0.08, 0, 0.06],
      head: [0.12, 0.35, 0.18],
      thighL: [-0.8, 0, 0.05],
      shinL: [1.15, 0, 0],
      thighR: [-0.4, 0, -0.05],
      shinR: [0.55, 0, 0],
      footL: [0.3, 0, 0],
      footR: [0.3, 0, 0],
      upperArmL: [-1.05, 0, 0.2],
      upperArmR: [-1.3, 0, 0.12],
      foreArmL: [-0.6, 0, 0],
      foreArmR: [-0.8, 0, 0],
    },
  },
]);

/** Crumple: the legs go first — down onto the knees, slumped — then they topple over sideways, limp. */
const CRUMPLE = clip(1.6, false, [
  { t: 0, b: {} },
  {
    t: 0.08,
    hips: [0, -0.05, 0],
    curl: [0.3, 0.3],
    b: {
      chest: [0.2, 0, 0],
      head: [0.3, 0, 0],
      upperArmL: [-0.3, 0, -0.05],
      upperArmR: [-0.35, 0, 0.05],
      foreArmL: [-0.8, 0, 0],
      foreArmR: [-0.8, 0, 0],
      shinL: [0.3, 0, 0],
      shinR: [0.3, 0, 0],
      thighL: [-0.12, 0, 0],
      thighR: [-0.12, 0, 0],
    },
  },
  {
    t: 0.34,
    hips: [0, -0.44, 0],
    curl: [0.3, 0.3],
    b: {
      spine: [0.3, 0, 0],
      chest: [0.3, 0, 0],
      neck: [0.2, 0, 0],
      head: [0.45, 0, 0],
      thighL: [-0.15, 0, 0.08],
      thighR: [-0.1, 0, -0.08],
      shinL: [2.0, 0, 0],
      shinR: [1.95, 0, 0],
      footL: [0.75, 0, 0],
      footR: [0.7, 0, 0],
      upperArmL: [0.05, 0, 0.15],
      upperArmR: [0.05, 0, -0.15],
      foreArmL: [-0.3, 0, 0],
      foreArmR: [-0.3, 0, 0],
    },
  },
  {
    t: 0.5,
    hips: [0, -0.45, 0],
    curl: [0.3, 0.3],
    b: {
      spine: [0.35, 0, 0.08],
      chest: [0.35, 0, 0.1],
      neck: [0.2, 0, 0],
      head: [0.5, 0.2, 0.2],
      thighL: [-0.15, 0, 0.08],
      thighR: [-0.1, 0, -0.08],
      shinL: [2.0, 0, 0],
      shinR: [1.95, 0, 0],
      footL: [0.75, 0, 0],
      footR: [0.7, 0, 0],
      upperArmL: [0.1, 0, 0.2],
      upperArmR: [0.0, 0, -0.1],
      foreArmL: [-0.25, 0, 0],
      foreArmR: [-0.35, 0, 0],
    },
  },
  {
    t: 0.95,
    hips: [0, -0.1, 0],
    curl: [0.3, 0.3],
    b: {
      spine: [0.2, 0, 0],
      chest: [0.15, 0, 0],
      head: [0.2, 0.5, 0.2],
      thighL: [-0.5, 0, 0.1],
      thighR: [-0.5, 0, -0.06],
      shinL: [1.2, 0, 0],
      shinR: [1.0, 0, 0],
      footL: [0.5, 0, 0],
      footR: [0.5, 0, 0],
      upperArmL: [-0.9, 0, 0.25],
      upperArmR: [-1.1, 0, 0.1],
      foreArmL: [-0.5, 0, 0],
      foreArmR: [-0.7, 0, 0],
    },
  },
  {
    t: 1.6,
    hips: [0, -0.08, 0],
    curl: [0.32, 0.3],
    b: {
      spine: [0.18, 0, 0],
      chest: [0.12, 0, 0],
      head: [0.18, 0.6, 0.22],
      thighL: [-0.55, 0, 0.12],
      thighR: [-0.45, 0, -0.06],
      shinL: [1.25, 0, 0],
      shinR: [0.95, 0, 0],
      footL: [0.5, 0, 0],
      footR: [0.5, 0, 0],
      upperArmL: [-0.85, 0, 0.25],
      upperArmR: [-1.15, 0, 0.1],
      foreArmL: [-0.5, 0, 0],
      foreArmR: [-0.75, 0, 0],
    },
  },
]);

const FALLS: Record<"back" | "front" | "spin" | "crumple", [Clip, Clip]> = {
  back: [BACK, mirror(BACK)],
  front: [FRONT, mirror(FRONT)],
  spin: [SPIN, mirror(SPIN)],
  crumple: [CRUMPLE, mirror(CRUMPLE)],
};

export function ragdollPose(a: AnimState, out: Pose): void {
  const d = a.dead;
  const kind = fallKind(a.seed);
  // Which side things go to, and small per-person differences in the resting pose.
  const side = ((a.seed * 13.7) % 2) < 1 ? 1 : -1;
  const vary = ((a.seed * 3.1) % 1) - 0.5;
  const f = fallProgress(d, kind);
  a.fall = f;
  // Down: a bounce off the ground, then the wobble dies away.
  const since = d - FALL_TIME;
  const bounce = since > 0 ? Math.sin(since * 15) * Math.exp(-since * 5.5) : 0;

  // ── Whole body: how far over, which way ──
  let tilt = (Math.PI / 2) * f;
  let tiltYaw = a.fallDir;
  if (kind === "spin") tiltYaw += side * 0.5 * f;
  // Crumple goes over to one side, not straight back.
  else if (kind === "crumple") tiltYaw += side * 1.2;
  tilt += bounce * 0.05;
  out.tilt = tilt;
  out.tiltYaw = tiltYaw;
  out.rootY = 0.11 * f;

  // ── The body's own fall (keys), this person's side ──
  const faceDown = kind === "thrown" && Math.cos(a.fallDir) > 0;
  const which = kind === "thrown" ? (faceDown ? "front" : "back") : kind;
  play(FALLS[which][side > 0 ? 0 : 1], d, out);

  // Life on top: the arms flail on the way down; on landing the limbs and head slap and settle.
  const flail = Math.sin(d * 11) * 0.18 * (1 - f) * smooth(0.06, 0.12, d);
  out.add("upperArmL", flail - bounce * 0.15);
  out.add("upperArmR", -flail - bounce * 0.15);
  out.add("head", bounce * 0.12, vary * 0.2 * f);
  out.add("chest", -bounce * 0.05);
  out.add("shinL", bounce * 0.05);
  out.add("shinR", -bounce * 0.05);
}
