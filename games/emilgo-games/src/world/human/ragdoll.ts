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

/** Seconds from the shot until the body is down. */
export const FALL_TIME = 0.95;
/** …and until it lies still. */
const SETTLE = 0.9;

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

export function ragdollPose(a: AnimState, out: Pose): void {
  const d = a.dead;
  const kind = fallKind(a.seed);
  // Which side things go to, and small per-person differences in the resting pose.
  const side = ((a.seed * 13.7) % 2) < 1 ? 1 : -1;
  const vary = ((a.seed * 3.1) % 1) - 0.5;
  const f = fallProgress(d, kind);
  a.fall = f;

  // The hit: a jolt that peaks in 60 ms and fades.
  const jolt = d < 0.06 ? d / 0.06 : Math.exp(-(d - 0.06) / 0.12);
  // Down: a bounce off the ground, then the wobble dies away.
  const since = d - FALL_TIME;
  const bounce = since > 0 ? Math.sin(since * 15) * Math.exp(-since * 5.5) : 0;
  const still = smooth(0, SETTLE, since);
  // Arms trail the fall (they lag the body, up and out), then slap down.
  const trail = since < 0 ? Math.sin(f * Math.PI) : 0;

  // ── Whole body: how far over, which way, and the roll ──
  let tilt = (Math.PI / 2) * f;
  let tiltYaw = a.fallDir;
  let roll = 0;
  if (kind === "spin") {
    roll = side * 1.35 * smooth(0.05, FALL_TIME, d);
    tiltYaw += side * 0.5 * f;
  } else if (kind === "crumple") {
    // Over to one side, not straight back.
    tiltYaw += side * 1.2;
  }
  tilt += bounce * 0.05;
  out.tilt = tilt;
  out.tiltYaw = tiltYaw;
  out.rootY = 0.11 * f;
  if (roll) out.set("hips", 0, roll, 0);

  // ── Legs ──
  // Knees give under the hit; crumple folds right down onto them first.
  const buckle = kind === "crumple" ? smooth(0, 0.34, d) * (1 - 0.65 * smooth(0.45, FALL_TIME + 0.3, d)) : smooth(0.02, 0.4, d) * (1 - 0.7 * f);
  const kneel = kind === "crumple" ? 1.4 : 0.55;
  // Lying: one leg bent, the other out straight (which one is the person's own).
  const restBendL = side > 0 ? 0.55 + vary * 0.3 : 0.12;
  const restBendR = side > 0 ? 0.1 : 0.5 - vary * 0.3;
  const lie = f * (1 - buckle);
  out.set("thighL", -kneel * buckle * 0.75 - restBendL * 0.45 * lie, 0, 0.1 * f + 0.06);
  out.set("thighR", -kneel * buckle * 0.7 - restBendR * 0.45 * lie, 0, -0.1 * f - 0.06);
  out.set("shinL", kneel * buckle * 1.5 + restBendL * lie + bounce * 0.05);
  out.set("shinR", kneel * buckle * 1.45 + restBendR * lie - bounce * 0.05);
  out.set("footL", 0.35 * f);
  out.set("footR", 0.3 * f);

  // ── Spine and head: snapped back by the shot, loose as they land ──
  const back = kind === "crumple" ? 0.25 : 0.42;
  out.set("spine", -back * jolt * 0.6 + 0.04 * f + bounce * 0.04, 0, side * 0.05 * f);
  out.set("chest", -back * jolt + 0.02 * f - bounce * 0.05, 0, side * 0.06 * f);
  out.set("neck", -0.2 * jolt);
  // The head rolls to one side once down.
  out.set("head", -0.55 * jolt - 0.15 * f + bounce * 0.12, side * 0.55 * still + vary * 0.2, side * 0.12 * f);

  // ── Arms: flung up by the hit, trailing the fall, then down on the ground ──
  // On the back they lie spread out to the sides; on the side (spin, crumple)
  // both lie in front of the chest — spread, the top one would point at the sky.
  // Thrown forwards (shot from behind) they land face down: arms spread, a
  // little up off the ground, hands flat — never pushed into it.
  const flat = kind === "thrown";
  const faceDown = flat && Math.cos(a.fallDir) > 0;
  const fwdL = flat ? (faceDown ? -0.12 : 0.12) : 1.05 + vary * 0.3;
  const fwdR = flat ? (faceDown ? -0.08 : 0.05) : 1.25 - vary * 0.3;
  const outL = flat ? 1.15 + vary * 0.35 : 0.22;
  const outR = flat ? 1.3 - vary * 0.35 : 0.15;
  const bendL = flat ? (faceDown ? 0.04 : 0.15 + vary * 0.2) : 0.55;
  const bendR = flat ? (faceDown ? 0.06 : 0.25 - vary * 0.2) : 0.75;
  const up = jolt * 0.9 + trail * 0.8;
  const flail = Math.sin(d * 11) * 0.22 * (1 - f) * (d > 0.08 ? 1 : 0);
  const rest = f * (1 - 0.3 * up);
  out.set("clavL", 0, 0, 0.12 * up);
  out.set("clavR", 0, 0, -0.12 * up);
  out.set("upperArmL", -1.5 * up - fwdL * rest + flail - bounce * 0.15, 0, 0.35 * up + outL * rest);
  out.set("upperArmR", -1.4 * up - fwdR * rest - flail - bounce * 0.15, 0, -0.35 * up - outR * rest);
  out.set("foreArmL", -0.7 * up - bendL * f);
  out.set("foreArmR", -0.6 * up - bendR * f);
  out.set("handL", 0, 0, 0.2 * f);
  out.set("handR", 0, 0, -0.25 * f);
  // Hands: open on the hit, loose once down (flat, face down).
  out.curlL = 0.1 + (faceDown ? 0.02 : 0.25) * f;
  out.curlR = 0.12 + (faceDown ? 0.02 : 0.2) * f;
}
