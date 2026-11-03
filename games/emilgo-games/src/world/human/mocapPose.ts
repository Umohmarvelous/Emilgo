// Mocap poses (v4 rework R3): the CC0 Universal Animation Library's clips
// (op.ts) as the body's base, in place of the procedural gait, for operators
// and zombies. The layers over it (emotes, lobby poses, melee actions, hits,
// the gun hold's IK, the face) stay as animator.ts has them.
//
//   locomotion  idle → walk → jog → sprint by speed, each loop at the phase its
//               left heel lands, so blends never cross feet; the legs' swing
//               stretched a little at the game's run and sprint speeds (the
//               clips are a jog and a short sprint) so the feet slide less
//   crouch      crouch idle / crouch walk, blended by stance
//   air         the jump loop in the air; the landing's settle after
//   slide       the slide loop; in a car: the driving loop
//   undead      the zombie idle and walk (a lunge walks it faster)
//   weapon      the upper body: a pistol's low ready (idle) or its aim (up,
//               level or down by the aim's pitch), the shot's kick, the
//               reload; a long gun takes the same torso and hold.ts puts the
//               arms on it; a torch: the torch idle
//   strafe      aiming while moving, the hips turn toward the way you go
//               (backwards plays the walk in reverse) and the chest turns back

import { Euler, Quaternion, Vector3 } from "three";

import type { AnimState, Pose } from "./animator";
import { CLIPS, carried, operatorsReady, sampleClip, type MocapClip } from "./op";
import { BONES, BONE_INDEX, type BoneName } from "./skeleton";

const NB = BONES.length;
const QB = new Float32Array(NB * 4);
const QU = new Float32Array(NB * 4);
const QX = new Float32Array(NB * 4);
const HB = new Vector3();
const HU = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _y = new Quaternion();
const _e = new Euler(0, 0, 0, "ZYX");
const UP = new Vector3(0, 1, 0);

const UPPER_NAMES: BoneName[] = [
  "spine", "chest", "neck", "head", "clavL", "clavR", "upperArmL", "upperArmR", "foreArmL", "foreArmR", "handL", "handR",
  "thumb1L", "thumb2L", "thumb3L", "index1L", "index2L", "index3L", "middle1L", "middle2L", "middle3L", "ring1L", "ring2L", "ring3L", "pinky1L", "pinky2L", "pinky3L",
  "thumb1R", "thumb2R", "thumb3R", "index1R", "index2R", "index3R", "middle1R", "middle2R", "middle3R", "ring1R", "ring2R", "ring3R", "pinky1R", "pinky2R", "pinky3R",
];
const UPPER = new Uint8Array(NB);
for (const b of UPPER_NAMES) UPPER[BONE_INDEX[b]] = 1;
const LEGS = ["thighL", "thighR", "shinL", "shinR", "footL", "footR", "toeL", "toeR"].map((b) => BONE_INDEX[b as BoneName]);

/** Speeds (m/s) each loop stands for, and how far its playback may speed up. */
const KNOTS: [clip: string, speed: number][] = [
  ["idle", 0],
  ["walk", 1.8],
  ["jog", 5.2],
  ["sprint", 8.4],
];
const CROUCH_KNOTS: [string, number][] = [
  ["crouch", 0],
  ["crouchWalk", 1.5],
];
const ZOMBIE_KNOTS: [string, number][] = [
  ["zIdle", 0],
  ["zWalk", 1.2],
];
const MAX_RATE = 1.55;

/** Weights of the knots for a speed (piecewise linear). */
function knotWeights(knots: [string, number][], speed: number, out: number[]): void {
  out.fill(0);
  if (speed <= knots[0][1]) {
    out[0] = 1;
    return;
  }
  for (let k = 1; k < knots.length; k++) {
    if (speed <= knots[k][1]) {
      const u = (speed - knots[k - 1][1]) / (knots[k][1] - knots[k - 1][1]);
      out[k - 1] = 1 - u;
      out[k] = u;
      return;
    }
  }
  out[knots.length - 1] = 1;
}

/** A loop's own speed (m/s) when played at 1×. */
const clipSpeed = (c: MocapClip) => (c.stride > 0.05 ? c.stride / c.dur : 0);

const _w = [0, 0, 0, 0];

/** How many loops a second at this speed, and how much to stretch the legs' swing. */
function rateFor(knots: [string, number][], speed: number): { rate: number; stretch: number } {
  knotWeights(knots, speed, _w);
  let rate = 0;
  let stretch = 0;
  let moving = 0;
  for (let k = 0; k < knots.length; k++) {
    const c = CLIPS[knots[k][0]];
    if (!c || _w[k] <= 0) continue;
    const cs = clipSpeed(c);
    if (cs <= 0) continue;
    const want = Math.max(speed, 0.4) / cs;
    const r = Math.min(MAX_RATE, Math.max(0.75, want));
    rate += (_w[k] * r) / c.dur;
    // What the playback rate can't cover, the stride takes (up to +35%).
    stretch += _w[k] * Math.min(1.35, Math.max(1, want / r));
    moving += _w[k];
  }
  return { rate, stretch: moving > 0 ? stretch / moving : 1 };
}

/** Advance the mocap clocks (animator.ts stepGait calls this for mocap bodies). */
export function stepMocap(a: AnimState, speed: number, dt: number): void {
  const knots = a.undead ? ZOMBIE_KNOTS : a.stance > 0.5 ? CROUCH_KNOTS : KNOTS;
  const { rate } = rateFor(knots, speed);
  a.mSpeed += (speed - a.mSpeed) * (1 - Math.exp(-dt * 10));
  const back = Math.abs(a.moveYaw) > 1.95 && a.aimW > 0.3;
  a.mPhase += rate * dt * (back ? -1 : 1);
  a.mPhase -= Math.floor(a.mPhase);
  // Air and landing.
  if (a.air > 0.5 && !a.mAir) {
    a.mAir = true;
    a.mAirT = 0;
  } else if (a.air < 0.3 && a.mAir) {
    a.mAir = false;
    a.mLandT = 0;
  }
  a.mAirT += dt;
  a.mLandT += dt;
  a.aimW += (a.aimWant - a.aimW) * (1 - Math.exp(-dt * 14));
  a.shotT += dt;
  if (a.reloadT >= 0) {
    a.reloadT += dt;
    if (a.reloadT > a.reloadLen) a.reloadT = -1;
  }
}

function loop(name: string, phase: number, w: number, q: Float32Array, h: Vector3 | null, mask: Uint8Array | null = null): void {
  const c = CLIPS[name];
  if (!c || w <= 0) return;
  const p = c.phase0 + phase;
  sampleClip(c, (p - Math.floor(p)) * c.dur, w, q, h, mask);
}

function once(name: string, time: number, w: number, q: Float32Array, h: Vector3 | null, mask: Uint8Array | null = null): void {
  const c = CLIPS[name];
  if (!c || w <= 0) return;
  sampleClip(c, time, w, q, h, mask);
}

/** Normalise every quaternion in q (after a weighted sum); identity where nothing was added. */
function normalise(q: Float32Array): void {
  for (let i = 0; i < NB; i++) {
    const o = i * 4;
    const l = Math.hypot(q[o], q[o + 1], q[o + 2], q[o + 3]);
    if (l < 1e-6) {
      q[o] = q[o + 1] = q[o + 2] = 0;
      q[o + 3] = 1;
    } else for (let k = 0; k < 4; k++) q[o + k] /= l;
  }
}

/** a ← nlerp(a, b, w) for the bones in mask. */
function mix(a: Float32Array, b: Float32Array, w: number, mask: Uint8Array | null): void {
  if (w <= 0) return;
  for (let i = 0; i < NB; i++) {
    if (mask && !mask[i]) continue;
    const o = i * 4;
    const d = a[o] * b[o] + a[o + 1] * b[o + 1] + a[o + 2] * b[o + 2] + a[o + 3] * b[o + 3];
    const s = d < 0 ? -1 : 1;
    for (let k = 0; k < 4; k++) a[o + k] += (b[o + k] * s - a[o + k]) * w;
    const l = Math.hypot(a[o], a[o + 1], a[o + 2], a[o + 3]) || 1;
    for (let k = 0; k < 4; k++) a[o + k] /= l;
  }
}

/** Stretch a bone's rotation away from rest by k (k > 1 swings a leg further). */
function stretchBone(q: Float32Array, i: number, k: number): void {
  const o = i * 4;
  _q.set(q[o], q[o + 1], q[o + 2], q[o + 3]);
  const w = Math.max(-1, Math.min(1, _q.w));
  const ang = 2 * Math.acos(Math.abs(w));
  if (ang < 1e-4) return;
  const s = Math.sin(ang / 2) || 1;
  const sg = w < 0 ? -1 : 1;
  const ax = (_q.x * sg) / s;
  const ay = (_q.y * sg) / s;
  const az = (_q.z * sg) / s;
  const na = ang * k;
  const ns = Math.sin(na / 2);
  q[o] = ax * ns;
  q[o + 1] = ay * ns;
  q[o + 2] = az * ns;
  q[o + 3] = Math.cos(na / 2);
}

/** Turn a bone about the vertical (its parent's frame) by yaw. */
function yawBone(q: Float32Array, i: number, yaw: number): void {
  const o = i * 4;
  _y.setFromAxisAngle(UP, yaw);
  _q.set(q[o], q[o + 1], q[o + 2], q[o + 3]);
  _q2.multiplyQuaternions(_y, _q);
  q[o] = _q2.x;
  q[o + 1] = _q2.y;
  q[o + 2] = _q2.z;
  q[o + 3] = _q2.w;
}

const _kw = [0, 0, 0, 0];

/**
 * The body's base pose from the clips, into `out` (Euler, as the rest of the
 * animator works). Returns false when it can't (no clips yet, or lying prone:
 * the procedural crawl does that).
 */
export function mocapPose(a: AnimState, out: Pose): boolean {
  if (!operatorsReady() || a.stance > 1.05) return false;
  QB.fill(0);
  HB.set(0, 0, 0);
  const speed = a.mSpeed;
  const ph = a.mPhase;
  const crouch = Math.min(1, a.stance);
  const stand = 1 - crouch;
  // Feet: standing set and crouching set by stance.
  const sets: [[string, number][], number][] = a.undead ? [[ZOMBIE_KNOTS, 1]] : [[KNOTS, stand], [CROUCH_KNOTS, crouch]];
  let stretch = 1;
  for (const [knots, sw] of sets) {
    if (sw <= 0) continue;
    knotWeights(knots, speed, _kw);
    for (let k = 0; k < knots.length; k++) loop(knots[k][0], ph, _kw[k] * sw, QB, HB);
    stretch += (rateFor(knots, speed).stretch - 1) * sw;
  }
  normalise(QB);
  if (stretch > 1.001) for (const i of LEGS) stretchBone(QB, i, i === LEGS[4] || i === LEGS[5] ? 1 + (stretch - 1) * 0.5 : stretch);

  // In the air, then the landing's settle (less of it on the move).
  const air = a.mAir ? Math.min(1, a.mAirT / 0.12) : 0;
  if (air > 0) {
    QX.fill(0);
    loop("jumpLoop", a.mAirT / (CLIPS.jumpLoop?.dur ?? 1), 1, QX, null);
    normalise(QX);
    mix(QB, QX, air, null);
  } else if (a.mLandT < 0.5 && !a.undead) {
    QX.fill(0);
    once("jumpLand", 0.08 + a.mLandT * 0.9, 1, QX, null);
    normalise(QX);
    mix(QB, QX, (1 - a.mLandT / 0.5) * (1 - Math.min(1, speed / 4) * 0.7), null);
  }
  if (a.slide > 0.01) {
    QX.fill(0);
    loop("slide", a.time * 0.4, 1, QX, null);
    normalise(QX);
    mix(QB, QX, a.slide, null);
  }
  if (a.sit > 0.01) {
    QX.fill(0);
    loop("drive", a.time / (CLIPS.drive?.dur ?? 1), 1, QX, null);
    normalise(QX);
    mix(QB, QX, a.sit, null);
  }

  // The upper body with a weapon (or a torch).
  if (a.weapon && a.sit < 0.5 && a.slide < 0.5) {
    QU.fill(0);
    HU.set(0, 0, 0);
    const pitch = Math.max(-1, Math.min(1, a.aimPitch / 0.75));
    if (a.weapon === 3) loop("torch", a.time / (CLIPS.torch?.dur ?? 1), 1, QU, null, UPPER);
    else {
      loop("pistolIdle", a.time / (CLIPS.pistolIdle?.dur ?? 1), 1 - a.aimW, QU, null, UPPER);
      const up = Math.max(0, -pitch);
      const down = Math.max(0, pitch);
      once("pistolAim", 0, a.aimW * (1 - up - down), QU, null, UPPER);
      once("pistolAimUp", 0, a.aimW * up, QU, null, UPPER);
      once("pistolAimDown", 0, a.aimW * down, QU, null, UPPER);
    }
    normalise(QU);
    // The shot's kick: the pistol's shoot clip from just before its peak, fading.
    if (a.weapon !== 3 && a.shotT < 0.35) {
      QX.fill(0);
      once("pistolShoot", 0.04 + a.shotT * 0.8, 1, QX, null, UPPER);
      normalise(QX);
      mix(QU, QX, (1 - a.shotT / 0.35) * 0.85, UPPER);
    }
    if (a.reloadT >= 0) {
      QX.fill(0);
      const rc = CLIPS.pistolReload;
      once("pistolReload", rc ? (a.reloadT / a.reloadLen) * rc.dur : 0, 1, QX, null, UPPER);
      normalise(QX);
      const r = a.reloadT / a.reloadLen;
      mix(QU, QX, Math.min(1, r * 6, (1 - r) * 6), UPPER);
    }
    // At a sprint the arms run (hold.ts carries the gun across the chest); otherwise the weapon's torso.
    const runArms = a.aimW < 0.5 ? Math.max(0, Math.min(1, (speed - 6.5) / 1.5)) : 0;
    mix(QB, QU, (1 - runArms) * (1 - air * 0.5), UPPER);
  }

  // Strafing while aiming: the hips toward the way you go, the chest back to the aim.
  if (a.aimW > 0.05 && speed > 0.4) {
    let rel = a.moveYaw;
    if (Math.abs(rel) > 1.95) rel = rel > 0 ? rel - Math.PI : rel + Math.PI;
    const yaw = Math.max(-1.1, Math.min(1.1, rel)) * a.aimW * Math.min(1, speed / 1.2);
    yawBone(QB, BONE_INDEX.hips, yaw);
    yawBone(QB, BONE_INDEX.spine, -yaw * 0.45);
    yawBone(QB, BONE_INDEX.chest, -yaw * 0.55);
  }

  // Into the pose, as Euler angles.
  for (let i = 1; i < NB; i++) {
    if (!carried(i)) continue;
    const o = i * 4;
    _q.set(QB[o], QB[o + 1], QB[o + 2], QB[o + 3]);
    _e.setFromQuaternion(_q, "ZYX");
    out.rot[i * 3] = _e.x;
    out.rot[i * 3 + 1] = _e.y;
    out.rot[i * 3 + 2] = _e.z;
  }
  // The clips' hips height is the body's own; the ground solver keeps the feet down.
  out.hipsX = HB.x;
  out.hipsY = HB.y;
  out.hipsZ = HB.z;
  // Looking about (the head over the clip).
  out.rot[BONE_INDEX.head * 3] += a.lookPitch;
  out.rot[BONE_INDEX.head * 3 + 1] += a.lookYaw;
  out.fingers = true;
  return true;
}
