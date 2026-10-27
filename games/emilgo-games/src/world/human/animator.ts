// Animation: every pose is a function of time and state (no baked clips, so
// any frame rate, slow motion and replays play the same).
//
//   locomotion  walk → run → sprint on human gait curves (GAIT: hip, knee and
//               ankle through the stride), driven by distance actually
//               travelled, the arms swinging against the opposite leg; the
//               stride holds a moment after a sudden stop: the statue look
//               Red Light is all about
//   stance      stand (the COD lobby stance) → crouch → prone, blended
//   air         a tuck while jumping
//   fall        caught: a human collapse, keyed (ragdoll.ts)
//   cheer       arms up at the finish
//   emotes      the dances and the full-body emotes are keyed loops (keys.ts):
//               standing still they move the hips and legs, on the move only
//               the upper body; the rest are upper-body poses
//   actions     fist, slap, push, picking a ball up; carrying it (both hands,
//               or tucked under the arm on the move); a stagger after a hit
//               (SPEC-V2 §2.4)
//   poses       lobby stances from the reference photos (hand on hip, hand in
//               hair, hero stance, relaxed)
//   face        the scanned people's eyes look about and blink, the jaw talks,
//               laughs and shouts (faceRig)
//
// Conventions (skeleton.ts): rotations about X swing limbs forward (−) and
// back (+); about Z swing them out (left side +, right side −); spine/head +X
// leans forward. Everything here is presentation; the referee never reads it.

import { EMOTE_SECONDS, type EmoteId } from "../../social/emotes";
import { FALL_TIME, fallKind, fallProgress, ragdollPose } from "./ragdoll";
import { clip, mirror, mirrorKey, play, playAdd, setScratch, type Clip, type Key, type V3 } from "./keys";
import { BONES, BONE_INDEX, LID_CLOSE, type BoneName } from "./skeleton";

export type { EmoteId } from "../../social/emotes";
export type PoseId = "relaxed" | "hip" | "hair" | "hero" | "arms";
export type ActionId = "fist" | "slap" | "push" | "grab";
/** How long each action takes to play, seconds. */
export const ACTION_SECONDS: Record<ActionId, number> = { fist: 0.45, slap: 0.4, push: 0.5, grab: 0.55 };
const HIT_SECONDS = 0.6;
export const POSES: { id: PoseId; label: string }[] = [
  { id: "relaxed", label: "Relaxed" },
  { id: "hip", label: "Hand on hip" },
  { id: "hair", label: "Slay" },
  { id: "hero", label: "Hero" },
  { id: "arms", label: "Arms folded" },
];

const NB = BONES.length;

/** Per-bone Euler angles (ZYX), plus the hips' offset and the root's tilt. */
export class Pose {
  readonly rot = new Float32Array(NB * 3);
  hipsY = 0;
  hipsZ = 0;
  hipsX = 0;
  /** Root: lift, and a tilt about a horizontal axis at `tiltYaw` (falls, prone). */
  rootY = 0;
  /**
   * A deliberate hop off the ground (the cheer), metres. Everything else is
   * pinned to the ground by the Human's ground solver; this is added after.
   */
  lift = 0;
  tilt = 0;
  tiltYaw = 0;
  /** Finger curl per hand, 0 open … 1 fist. */
  curlL = 0.25;
  curlR = 0.25;

  clear(): void {
    this.rot.fill(0);
    this.hipsY = this.hipsZ = this.hipsX = 0;
    this.rootY = this.lift = this.tilt = this.tiltYaw = 0;
    this.curlL = this.curlR = 0.25;
  }
  set(b: BoneName, x: number, y = 0, z = 0): void {
    const i = BONE_INDEX[b] * 3;
    this.rot[i] = x;
    this.rot[i + 1] = y;
    this.rot[i + 2] = z;
  }
  add(b: BoneName, x: number, y = 0, z = 0): void {
    const i = BONE_INDEX[b] * 3;
    this.rot[i] += x;
    this.rot[i + 1] += y;
    this.rot[i + 2] += z;
  }
  get(b: BoneName, axis: 0 | 1 | 2): number {
    return this.rot[BONE_INDEX[b] * 3 + axis];
  }
  /** Blend another pose's UPPER body (spine up) over this one by w. */
  blendUpper(o: Pose, w: number): void {
    for (const b of UPPER) {
      const i = BONE_INDEX[b] * 3;
      for (let k = 0; k < 3; k++) this.rot[i + k] += (o.rot[i + k] - this.rot[i + k]) * w;
    }
    this.curlL += (o.curlL - this.curlL) * w;
    this.curlR += (o.curlR - this.curlR) * w;
  }
  /** Blend another pose's LOWER body (hips and legs, and the hips' offset) over this one by w. */
  blendLower(o: Pose, w: number): void {
    for (const b of LOWER) {
      const i = BONE_INDEX[b] * 3;
      for (let k = 0; k < 3; k++) this.rot[i + k] += (o.rot[i + k] - this.rot[i + k]) * w;
    }
    this.hipsX += (o.hipsX - this.hipsX) * w;
    this.hipsY += (o.hipsY - this.hipsY) * w;
    this.hipsZ += (o.hipsZ - this.hipsZ) * w;
  }
  /** Blend everything by w. */
  blend(o: Pose, w: number): void {
    for (let i = 0; i < this.rot.length; i++) this.rot[i] += (o.rot[i] - this.rot[i]) * w;
    this.hipsY += (o.hipsY - this.hipsY) * w;
    this.hipsZ += (o.hipsZ - this.hipsZ) * w;
    this.hipsX += (o.hipsX - this.hipsX) * w;
    this.rootY += (o.rootY - this.rootY) * w;
    this.lift += (o.lift - this.lift) * w;
    this.curlL += (o.curlL - this.curlL) * w;
    this.curlR += (o.curlR - this.curlR) * w;
  }
}

const UPPER: BoneName[] = ["spine", "chest", "neck", "head", "clavL", "clavR", "upperArmL", "upperArmR", "foreArmL", "foreArmR", "handL", "handR"];
const LOWER: BoneName[] = ["hips", "thighL", "thighR", "shinL", "shinR", "footL", "footR"];

export interface AnimState {
  time: number;
  /** Gait phase (radians) and blends. */
  phase: number;
  amp: number;
  run: number;
  sprint: number;
  /** 0 stand … 1 crouch … 2 prone (continuous). */
  stance: number;
  /** 0 grounded … 1 airborne. */
  air: number;
  /** Seconds since caught (−1: not), fall progress, direction relative to heading. */
  dead: number;
  fall: number;
  fallDir: number;
  /** Seconds since finishing (−1: not). */
  done: number;
  emote: EmoteId | null;
  emoteT: number;
  /** A one-off action and its time; carrying a ball (target and blend); a stagger's time left and side. */
  action: ActionId | null;
  actionT: number;
  carry: boolean;
  carryW: number;
  /** 0 … 1: how far the ball has gone from both hands (standing) to tucked under the arm (on the move). */
  carryTuck: number;
  hitT: number;
  hitSide: number;
  /** 0 … 1: sliding (sprint, then crouch). */
  slide: number;
  pose: PoseId | null;
  /** Where to look, relative to the body (radians). */
  lookYaw: number;
  lookPitch: number;
  /** Shorter steps (pencil skirts). */
  narrow: boolean;
  /** Curl already in the hand's rest shape (scanned hands hang relaxed): taken off every curl. */
  curlBias: number;
  /** Seconds of talking left (the mouth moves). */
  talk: number;
  /** Fixed expression (dev sheets): lids 0 open … 1 shut, jaw open (radians), where the eyes look. */
  face: { lids?: number; jaw?: number; yaw?: number; pitch?: number } | null;
  seed: number;
}

export function newAnimState(seed: number): AnimState {
  return {
    time: seed * 3.7,
    phase: seed * 1.7,
    amp: 0,
    run: 0,
    sprint: 0,
    stance: 0,
    air: 0,
    dead: -1,
    fall: 0,
    fallDir: 0,
    done: -1,
    emote: null,
    emoteT: 0,
    action: null,
    actionT: 0,
    carry: false,
    carryW: 0,
    carryTuck: 0,
    hitT: 0,
    hitSide: 0,
    slide: 0,
    pose: null,
    lookYaw: 0,
    lookPitch: 0,
    narrow: false,
    curlBias: 0,
    talk: 0,
    face: null,
    seed,
  };
}

export const WALK = 2;
export const RUN = 6;
export const SPRINT = 9;

/** Advance the gait from how fast the body is actually moving. */
export function stepGait(a: AnimState, speed: number, dt: number): void {
  a.time += dt;
  if (a.dead >= 0) {
    a.dead += dt;
    a.fall = fallProgress(a.dead, fallKind(a.seed));
    return;
  }
  if (a.done >= 0) a.done += dt;
  if (a.emote) {
    a.emoteT += dt;
    if (a.emoteT >= EMOTE_SECONDS) a.emote = null;
  }
  if (a.action) {
    a.actionT += dt;
    if (a.actionT >= ACTION_SECONDS[a.action]) a.action = null;
  }
  if (a.hitT > 0) a.hitT = Math.max(0, a.hitT - dt);
  if (a.talk > 0) a.talk = Math.max(0, a.talk - dt);
  a.carryW += ((a.carry ? 1 : 0) - a.carryW) * (1 - Math.exp(-dt * 10));
  const tuck = a.carry ? Math.max(0, Math.min(1, (speed - 1.2) / 2.3)) : 0;
  a.carryTuck += (tuck - a.carryTuck) * (1 - Math.exp(-dt * 6));
  const walkRef = a.stance > 0.5 ? 1.2 : WALK;
  const want = Math.min(1, speed / walkRef);
  // Rise fast, settle slowly: a sudden stop holds the stride for a moment.
  a.amp += (want - a.amp) * (1 - Math.exp(-dt * (want > a.amp ? 9 : 1.4)));
  const wantRun = Math.max(0, Math.min(1, (speed - WALK) / (RUN - WALK)));
  a.run += (wantRun - a.run) * (1 - Math.exp(-dt * 6));
  const wantSprint = Math.max(0, Math.min(1, (speed - RUN) / (SPRINT - RUN)));
  a.sprint += (wantSprint - a.sprint) * (1 - Math.exp(-dt * 6));
  // Metres per stride (both steps): a brisk walk, a 180-a-minute run, a 200-a-minute sprint.
  const stride = (a.stance > 0.5 ? 0.9 : 1.4 + 0.6 * a.run + 0.7 * a.sprint) * (a.narrow ? 0.75 : 1);
  a.phase += (speed / stride) * Math.PI * 2 * dt;
}

const _emote = new Pose();
const _base = new Pose();
setScratch(new Pose());

/** The full pose for this frame. */
export function computePose(a: AnimState, out: Pose): void {
  out.clear();
  const t = a.time;

  if (a.dead >= 0) {
    ragdollPose(a, out);
    curl(out, "L", out.curlL, a.curlBias);
    curl(out, "R", out.curlR, a.curlBias);
    faceRig(a, out);
    return;
  }

  // ── Legs and body: locomotion with stance ──
  const amp = a.amp * (1 - a.air);
  const run = a.run;
  const spr = a.sprint;
  const crouch = Math.min(1, a.stance);
  const prone = Math.max(0, a.stance - 1);
  const narrow = a.narrow ? 0.6 : 1;

  // Each leg follows human gait curves (GAIT: hip, knee and ankle through
  // the stride — heel strike, loading, push-off, swing), walk, run and
  // sprint blended by speed. The arms swing against the opposite leg, the
  // pelvis turns with the leading leg and the chest against it; the head
  // stays level and looking ahead.
  const gL = a.phase / TAU - Math.floor(a.phase / TAU);
  const gR = gL + 0.5 - Math.floor(gL + 0.5);
  const wWalk = 1 - run;
  const wRun = run * (1 - spr);
  const wSpr = run * spr;
  const curve = (k: "hip" | "knee" | "ankle", g: number) => (wWalk * cyc(GAIT.walk[k], g) + wRun * cyc(GAIT.run[k], g) + wSpr * cyc(GAIT.sprint[k], g)) * DEG;
  const reach = amp * narrow * (1 - crouch * 0.45);
  const hipL = curve("hip", gL);
  const hipR = curve("hip", gR);
  let thighL = -hipL * reach;
  let thighR = -hipR * reach;
  let kneeL = curve("knee", gL) * amp;
  let kneeR = curve("knee", gR) * amp;
  let footL = curve("ankle", gL) * amp;
  let footR = curve("ankle", gR) * amp;
  // How far forward each leg is, −1 … 1 (the arms and the pelvis follow it).
  const mid = (wWalk * 8 + wRun * 17 + wSpr * 24) * DEG;
  const half = (wWalk * 19 + wRun * 29 + wSpr * 42) * DEG;
  const fwdL = Math.max(-1, Math.min(1, (hipL - mid) / half)) * amp;
  const fwdR = Math.max(-1, Math.min(1, (hipR - mid) / half)) * amp;

  // Idle: standing still, breathing.
  const breathe = Math.sin(t * 1.6 + a.seed) * 0.01;
  // The COD lobby stance, full when standing still: feet apart and turned
  // out, the weight on the right leg (the left knee eased), chest up, arms
  // hanging a little away from the body.
  const still = (1 - Math.min(1, a.amp * 2.5)) * (1 - crouch) * (1 - a.air) * (1 - a.slide);
  kneeL += still * 0.13;
  thighL -= still * 0.07;
  footL -= still * 0.06;
  thighR += still * 0.02;

  // Crouch: drop the hips and fold the legs so the feet stay put (deep, like COD's).
  const legLen = 0.84;
  const drop = crouch * 0.42 * (1 - prone);
  const fold = Math.acos(Math.max(0.2, Math.min(1, (legLen - drop) / legLen)));
  out.hipsY = -drop;
  thighL -= fold;
  thighR -= fold;
  kneeL += fold * 2;
  kneeR += fold * 2;
  footL -= fold * 0.95;
  footR -= fold * 0.95;

  // In the air: knees tucked.
  thighL -= a.air * 0.55;
  thighR -= a.air * 0.25;
  kneeL += a.air * 1.0;
  kneeR += a.air * 0.6;

  const spread = 0.02 + 0.06 * still + 0.05 * crouch * (1 - prone);
  const turnOut = 0.14 * still + 0.12 * crouch * (1 - prone);
  out.set("thighL", thighL, turnOut, spread);
  out.set("thighR", thighR, -turnOut, -spread);
  out.set("shinL", kneeL);
  out.set("shinR", kneeR);
  out.set("footL", footL, 0, -spread * 0.9);
  out.set("footR", footR, 0, spread * 0.9);

  // Lean into the pace from the hips; the pelvis turns with the leading leg
  // (and dips on the swinging side when walking), the chest turns back
  // against it, the neck and head undo the rest.
  const lean = 0.03 + (0.04 * wWalk + 0.16 * wRun + 0.27 * wSpr) * amp + crouch * 0.26 * (1 - prone);
  const turn = 0.07 * wWalk + 0.1 * wRun + 0.12 * wSpr;
  out.add("hips", 0, -turn * fwdL, -0.03 * still + 0.035 * wWalk * amp * Math.sin(TAU * (gL - 0.05)));
  out.set("spine", lean * 0.5 + breathe * 0.3, turn * 0.5 * fwdL, 0.015 * still);
  out.set("chest", lean * 0.5 - breathe - 0.05 * still, turn * 1.1 * fwdL, 0.02 * still);
  out.set("neck", -lean * 0.4, -turn * 0.3 * fwdL);
  out.set("head", -lean * 0.45 + breathe * 0.4 + a.lookPitch - 0.02 * still, a.lookYaw - turn * 0.3 * fwdL, -0.02 * still);

  // Arms: a loose swing walking; jogging, elbows near 90° driving forward
  // and up, the hands coming in towards the middle; sprinting, a big drive
  // with flat hands. Each arm goes forward as the opposite leg does.
  const runW = wRun + wSpr;
  const armF = 0.32 * wWalk + 0.75 * wRun + 1.05 * wSpr;
  const armB = 0.28 * wWalk + 0.5 * wRun + 0.75 * wSpr;
  const swingOf = (fwd: number) => -(fwd > 0 ? fwd * armF : fwd * armB);
  const elbowOf = (fwd: number) =>
    -(
      wWalk * (0.22 + 0.12 * Math.max(0, fwd)) +
      wRun * (1.45 + 0.2 * Math.max(0, fwd) - 0.2 * Math.max(0, -fwd)) +
      wSpr * (1.3 + 0.35 * Math.max(0, fwd) - 0.35 * Math.max(0, -fwd))
    );
  const outOf = (fwd: number) => 0.07 + 0.04 * runW - 0.1 * Math.max(0, fwd) * runW + 0.06 * still + a.air * 0.3 + crouch * 0.06;
  out.set("upperArmL", swingOf(fwdR) - crouch * 0.45 - a.air * 0.6 + 0.04 * still, -0.25 * runW * amp, outOf(fwdR));
  out.set("upperArmR", swingOf(fwdL) - crouch * 0.45 - a.air * 0.6 + 0.04 * still, 0.25 * runW * amp, -outOf(fwdL));
  out.set("foreArmL", elbowOf(fwdR) - crouch * 0.55 - 0.08 * still);
  out.set("foreArmR", elbowOf(fwdL) - crouch * 0.55 - 0.08 * still);
  out.set("clavL", 0, 0, breathe * 0.4 - 0.03 * still);
  out.set("clavR", 0, 0, -breathe * 0.4 + 0.03 * still);
  // Fists jogging, flat "blade" hands sprinting, relaxed at rest.
  out.curlL = out.curlR = 0.38 + 0.4 * run * amp * (1 - spr) + 0.05 * spr;

  // Prone: lie forward on the belly, crawl on forearms.
  if (prone > 0) {
    out.tilt = (Math.PI / 2) * prone;
    out.tiltYaw = 0;
    out.rootY = 0.11 * prone;
    out.hipsY *= 1 - prone;
    const cr = Math.sin(a.phase) * amp;
    for (const [b, v] of [
      ["thighL", -0.05 - Math.max(0, cr) * 0.55],
      ["thighR", -0.05 - Math.max(0, -cr) * 0.55],
      ["shinL", 0.25 + Math.max(0, cr) * 1.1],
      ["shinR", 0.25 + Math.max(0, -cr) * 1.1],
      ["footL", 0.5],
      ["footR", 0.5],
      ["spine", -0.05],
      ["chest", -0.1],
      ["neck", -0.5],
      ["head", -0.45],
    ] as [BoneName, number][]) {
      out.set(b, out.get(b, 0) + (v - out.get(b, 0)) * prone, out.get(b, 1) * (1 - prone), out.get(b, 2) * (1 - prone));
    }
    // Army crawl: the knee draws up to the side as the opposite elbow reaches.
    out.set("thighL", out.get("thighL", 0), 0, lerp(out.get("thighL", 2), 0.1 + Math.max(0, cr) * 0.5, prone));
    out.set("thighR", out.get("thighR", 0), 0, lerp(out.get("thighR", 2), -0.1 - Math.max(0, -cr) * 0.5, prone));
    out.set("upperArmL", lerp(out.get("upperArmL", 0), -2.5 + cr * 0.35, prone), 0, lerp(out.get("upperArmL", 2), 0.35, prone));
    out.set("upperArmR", lerp(out.get("upperArmR", 0), -2.5 - cr * 0.35, prone), 0, lerp(out.get("upperArmR", 2), -0.35, prone));
    out.set("foreArmL", lerp(out.get("foreArmL", 0), -1.2, prone));
    out.set("foreArmR", lerp(out.get("foreArmR", 0), -1.2, prone));
  }

  // ── Finished: arms up, a little bounce ──
  if (a.done >= 0) {
    const ch = Math.min(1, a.done * 3);
    out.set("upperArmL", lerp(out.get("upperArmL", 0), -2.75 + Math.sin(a.done * 9) * 0.22, ch), 0, lerp(out.get("upperArmL", 2), 0.4, ch));
    out.set("upperArmR", lerp(out.get("upperArmR", 0), -2.75 + Math.sin(a.done * 9 + 1) * 0.22, ch), 0, lerp(out.get("upperArmR", 2), -0.4, ch));
    out.set("foreArmL", lerp(out.get("foreArmL", 0), -0.25, ch));
    out.set("foreArmR", lerp(out.get("foreArmR", 0), -0.25, ch));
    out.curlL = out.curlR = lerp(out.curlL, 0.9, ch);
    out.lift = a.done < 3 ? Math.abs(Math.sin(a.done * 7)) * 0.1 : 0;
  }

  // ── Lobby pose over idle ──
  if (a.pose && a.amp < 0.3) {
    _base.clear();
    posePose(a.pose, t, a.seed, _base);
    const w = 1 - a.amp / 0.3;
    out.blendUpper(_base, w);
    // Poses with a cocked hip move the legs too.
    if (a.pose === "hip" || a.pose === "hair") {
      out.hipsZ = lerp(out.hipsZ, 0.035, w);
      out.add("hips", 0, 0, -0.06 * w);
      out.set("shinR", lerp(out.get("shinR", 0), 0.28, w));
      out.set("thighR", lerp(out.get("thighR", 0), -0.12, w), 0, lerp(out.get("thighR", 2), 0.05, w));
      out.set("footR", lerp(out.get("footR", 0), 0.1, w));
    }
    if (a.pose === "hero") {
      out.set("thighL", lerp(out.get("thighL", 0), 0, w), 0, lerp(out.get("thighL", 2), 0.12, w));
      out.set("thighR", lerp(out.get("thighR", 0), 0, w), 0, lerp(out.get("thighR", 2), -0.12, w));
    }
  }

  // ── Emote over everything: the upper body always; standing still, the
  // dances move the hips and legs too (on the move the legs keep running) ──
  if (a.emote) {
    const e = a.emoteT;
    const w = Math.max(0, Math.min(1, e / 0.15, (EMOTE_SECONDS - e) / 0.25));
    _emote.clear();
    for (let i = 0; i < out.rot.length; i++) _emote.rot[i] = out.rot[i];
    _emote.curlL = out.curlL;
    _emote.curlR = out.curlR;
    _emote.hipsX = out.hipsX;
    _emote.hipsY = out.hipsY;
    _emote.hipsZ = out.hipsZ;
    emotePose(a.emote, e, _emote, a.seed);
    out.blendUpper(_emote, w);
    out.blendLower(_emote, w * (1 - Math.min(1, a.amp * 3)) * (1 - crouch) * (1 - a.air));
  }

  // ── Sliding: low, leaning back, the front leg out, the back one folded ──
  if (a.slide > 0.01) {
    const w = a.slide;
    out.hipsY = lerp(out.hipsY, -0.42, w);
    out.set("thighL", lerp(out.get("thighL", 0), -1.25, w), 0, out.get("thighL", 2));
    out.set("shinL", lerp(out.get("shinL", 0), 0.15, w));
    out.set("footL", lerp(out.get("footL", 0), -0.2, w));
    out.set("thighR", lerp(out.get("thighR", 0), -0.35, w), 0, out.get("thighR", 2));
    out.set("shinR", lerp(out.get("shinR", 0), 1.9, w));
    out.set("footR", lerp(out.get("footR", 0), 0.4, w));
    out.set("spine", lerp(out.get("spine", 0), -0.42, w), 0, lerp(out.get("spine", 2), 0.12, w));
    out.set("chest", lerp(out.get("chest", 0), -0.18, w));
    out.set("head", lerp(out.get("head", 0), 0.45, w));
    // COD slide: the left hand trails on the ground, the right arm forward for balance.
    out.set("upperArmL", lerp(out.get("upperArmL", 0), 0.35, w), 0, lerp(out.get("upperArmL", 2), 0.85, w));
    out.set("upperArmR", lerp(out.get("upperArmR", 0), -1.05, w), 0, lerp(out.get("upperArmR", 2), -0.25, w));
    out.set("foreArmL", lerp(out.get("foreArmL", 0), -0.15, w));
    out.set("foreArmR", lerp(out.get("foreArmR", 0), -0.75, w));
    out.curlL = lerp(out.curlL, 0.1, w);
  }

  // ── Carrying a ball ──
  // Standing or strolling: both hands round it, low in front of the belly.
  // On the move: tucked under the right arm against the ribs (the forearm
  // round its front, the hand spread on it) while the left arm keeps pumping.
  // Human.carryPoint() puts the ball where these hands are.
  if (a.carryW > 0.01) {
    const hold = a.carryW * (1 - a.carryTuck);
    const tuck = a.carryW * a.carryTuck;
    for (const [b, v] of HOLD) towards(out, b, v, hold);
    for (const [b, v] of TUCK) towards(out, b, v, tuck);
    out.curlL = lerp(out.curlL, 0.35, hold);
    out.curlR = lerp(out.curlR, lerp(0.35, 0.5, a.carryTuck), a.carryW);
  }

  // ── A one-off action over everything ──
  if (a.action) actionPose(a.action, a.actionT, out);

  // ── Hit: a stagger. The blow snaps the chest and head back and twists
  // them; a leg steps back to catch the weight, the arms go out for
  // balance, then they recover (keys: HIT, over whatever the body is doing) ──
  if (a.hitT > 0) {
    const k = HIT_SECONDS - a.hitT;
    playAdd(a.hitSide >= 0 ? HIT : HIT_M, k, out, 0.55 + 0.45 * Math.abs(a.hitSide));
    const open = Math.sin(Math.min(1, k / 0.12) * Math.PI * 0.5) * Math.min(1, a.hitT / 0.2);
    out.curlL = out.curlR = lerp(out.curlL, 0.08, open);
  }

  // Fingers follow the curl.
  curl(out, "L", out.curlL, a.curlBias);
  curl(out, "R", out.curlR, a.curlBias);
  faceRig(a, out);
}

// ── The face: eyes that look about and blink, a jaw that talks and shouts ────

/** 0 … 1 from an integer slot and the person's seed. */
function hash1(n: number, seed: number): number {
  const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** One blink, d seconds after it starts: shut in 70 ms, open in 110 ms. */
function blinkShape(d: number): number {
  if (d < 0 || d > 0.18) return 0;
  return d < 0.07 ? ease(d / 0.07) : 1 - ease((d - 0.07) / 0.11);
}

/** Blinks at irregular times (one somewhere in each 2.6 s slot), now and then a double one. */
function blinkAt(t: number, seed: number): number {
  const SLOT = 2.6;
  const k = Math.floor(t / SLOT);
  let b = 0;
  for (const n of [k - 1, k]) {
    const t0 = n * SLOT + hash1(n, seed) * SLOT * 0.8;
    b = Math.max(b, blinkShape(t - t0));
    if (hash1(n + 0.5, seed) < 0.2) b = Math.max(b, blinkShape(t - t0 - 0.26));
  }
  return b;
}

/** Where the eyes rest: a new spot every second or two (often straight ahead), reached in 50 ms. */
function gaze(t: number, seed: number, range: number): [number, number] {
  const SLOT = 1.7;
  const tt = t + seed * 5.3;
  const k = Math.floor(tt / SLOT);
  const at = (n: number): [number, number] => {
    const near = hash1(n, seed + 3) < 0.45 ? 0.25 : 1;
    return [(hash1(n, seed + 1) - 0.5) * 2 * range * near, (hash1(n, seed + 2) - 0.5) * range * 0.6 * near];
  };
  const a = at(k - 1);
  const b = at(k);
  const s = ease((tt - k * SLOT) / 0.05);
  return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
}

/** Talking: syllables at an uneven rhythm. */
function talkJaw(t: number): number {
  return 0.03 + 0.1 * Math.max(0, Math.sin(t * 15 + Math.sin(t * 3.7) * 2.2)) * (0.6 + 0.4 * Math.sin(t * 2.3));
}

/** An emote's face: [lids part-shut, jaw, eyes down]. */
function emoteFace(id: EmoteId, t: number): [number, number, number] {
  switch (id) {
    case "wave":
    case "handshake":
      return [0.1, t < 1.4 ? talkJaw(t) : 0.02, 0];
    case "taunt":
      return [0.3, talkJaw(t), 0];
    case "laugh":
      return [0.6, 0.16 + 0.1 * Math.abs(Math.sin(t * 14)), -0.05];
    case "cry":
      return [0.65, 0.07 + 0.04 * Math.sin(t * 13), 0.2];
    case "respect":
      return [0.5, 0, 0.3];
    case "odogwu":
      return [0.3, t < 0.9 ? 0.28 * Math.sin(Math.min(1, t / 0.9) * Math.PI) : 0.04, -0.05];
    case "flex":
      return [0.4, 0.02, 0];
    case "slay":
      return [0.3, 0.03, 0];
    default:
      // The dances: lips parted, enjoying it.
      return [0.15, 0.05 + 0.02 * Math.sin(t * 9), 0];
  }
}

function faceRig(a: AnimState, out: Pose): void {
  const t = a.time;
  const moving = a.amp;
  let lids = 0;
  let jaw = (0.05 * a.run + 0.08 * a.sprint) * moving * (0.8 + 0.2 * Math.sin(t * 7));
  let range = 0.22 * (1 - 0.6 * a.run * moving);
  let pitch = 0.06 * a.run * moving;
  let blink = blinkAt(t, a.seed);
  if (a.talk > 0) jaw = Math.max(jaw, talkJaw(t) * Math.min(1, a.talk * 4));
  if (a.hitT > 0) {
    const k = Math.sin((1 - a.hitT / HIT_SECONDS) * Math.PI);
    lids = Math.max(lids, 0.7 * k);
    jaw = Math.max(jaw, 0.12 * k);
  }
  // The cheer: a shout.
  if (a.done >= 0) {
    jaw = Math.max(jaw, 0.3 * Math.min(1, a.done * 4) * (0.85 + 0.15 * Math.sin(a.done * 9)));
    lids = Math.max(lids, 0.35);
  }
  if (a.pose === "hair") lids = Math.max(lids, 0.25);
  if (a.emote) {
    const e = a.emoteT;
    const w = Math.max(0, Math.min(1, e / 0.15, (EMOTE_SECONDS - e) / 0.25));
    const [l, j, p] = emoteFace(a.emote, e);
    lids += (l - lids) * w;
    jaw += (j - jaw) * w;
    pitch += p * w;
  }
  let yaw = 0;
  if (a.dead >= 0) {
    // Half-shut on the hit, shut once down; the mouth falls open, then slack.
    const d = a.dead;
    lids = d < 0.15 ? 0.6 * (d / 0.15) : 0.6 + 0.4 * ease((d - 0.3) / (FALL_TIME - 0.3));
    jaw = 0.18 * ease(d / 0.2) - 0.08 * ease((d - 1) / 1);
    blink = 0;
    range = 0;
  }
  const [gy, gp] = gaze(t, a.seed, range);
  yaw += gy;
  pitch += gp;
  // The eyes lead: they hold against part of the head's own turn.
  yaw -= out.get("head", 1) * 0.4;
  let shut = Math.min(1, Math.max(blink, lids));
  const f = a.face;
  if (f) {
    if (f.lids !== undefined) shut = f.lids;
    if (f.jaw !== undefined) jaw = f.jaw;
    if (f.yaw !== undefined) yaw = f.yaw;
    if (f.pitch !== undefined) pitch = f.pitch;
  }
  // Looking down lowers the lids a little, looking up raises them.
  const lid = shut * LID_CLOSE + pitch * 0.5 * (1 - shut);
  out.set("eyeL", pitch, yaw);
  out.set("eyeR", pitch, yaw);
  out.set("lidL", lid);
  out.set("lidR", lid);
  out.set("jaw", Math.max(0, jaw));
}

/** Smooth 0 → 1 → 0 over [a, b] … [c, d] of an action's time. */
function bell(t: number, a: number, b: number, c: number, d: number): number {
  if (t <= a || t >= d) return 0;
  if (t < b) return (t - a) / (b - a);
  if (t <= c) return 1;
  return 1 - (t - c) / (d - c);
}

function actionPose(id: ActionId, t: number, out: Pose): void {
  switch (id) {
    case "fist": {
      // Wind up, then a straight right.
      const wind = bell(t, 0, 0.1, 0.12, 0.18);
      const hit = bell(t, 0.1, 0.18, 0.26, 0.45);
      out.set("upperArmR", lerp(lerp(out.get("upperArmR", 0), 0.35, wind), -1.5, hit), 0, lerp(out.get("upperArmR", 2), 0.12, hit));
      out.set("foreArmR", lerp(lerp(out.get("foreArmR", 0), -1.9, wind), -0.08, hit));
      out.set("upperArmL", lerp(out.get("upperArmL", 0), -0.6, Math.max(wind, hit)), 0, lerp(out.get("upperArmL", 2), 0.1, hit));
      out.set("foreArmL", lerp(out.get("foreArmL", 0), -1.8, Math.max(wind, hit)));
      out.add("chest", 0.08 * hit, 0.25 * wind - 0.4 * hit);
      out.add("spine", 0.06 * hit, 0.1 * wind - 0.2 * hit);
      out.curlR = lerp(out.curlR, 1, Math.max(wind, hit));
      out.curlL = lerp(out.curlL, 1, Math.max(wind, hit));
      break;
    }
    case "slap": {
      // Open hand from out wide, swept across.
      const up = bell(t, 0, 0.1, 0.12, 0.2);
      const sweep = bell(t, 0.1, 0.18, 0.24, 0.4);
      out.set("upperArmR", lerp(lerp(out.get("upperArmR", 0), -0.9, up), -1.25, sweep), lerp(0, 0.9, sweep), lerp(lerp(out.get("upperArmR", 2), -1.0, up), 0.1, sweep));
      out.set("foreArmR", lerp(out.get("foreArmR", 0), -0.45, Math.max(up, sweep)));
      out.add("chest", 0, 0.2 * up - 0.35 * sweep);
      out.curlR = lerp(out.curlR, 0.05, Math.max(up, sweep));
      break;
    }
    case "push": {
      // Both hands up to the chest, then out hard.
      const load = bell(t, 0, 0.12, 0.14, 0.22);
      const shove = bell(t, 0.12, 0.22, 0.3, 0.5);
      for (const [b, s] of [["L", 1], ["R", -1]] as const) {
        out.set(`upperArm${b}`, lerp(lerp(out.get(`upperArm${b}`, 0), -0.6, load), -1.45, shove), 0, lerp(out.get(`upperArm${b}`, 2), -0.12 * s, Math.max(load, shove)));
        out.set(`foreArm${b}`, lerp(lerp(out.get(`foreArm${b}`, 0), -1.9, load), -0.1, shove), lerp(0, 0.4 * s, load));
      }
      out.add("spine", 0.12 * shove - 0.05 * load);
      out.add("chest", 0.12 * shove);
      out.curlL = out.curlR = lerp(out.curlL, 0.1, Math.max(load, shove));
      break;
    }
    case "grab": {
      // Bend down and scoop.
      const w = bell(t, 0, 0.18, 0.3, 0.55);
      out.add("spine", 0.55 * w);
      out.add("chest", 0.35 * w);
      out.add("head", -0.3 * w);
      out.set("upperArmL", lerp(out.get("upperArmL", 0), -0.9, w), 0, lerp(out.get("upperArmL", 2), -0.05, w));
      out.set("upperArmR", lerp(out.get("upperArmR", 0), -0.9, w), 0, lerp(out.get("upperArmR", 2), 0.05, w));
      out.set("foreArmL", lerp(out.get("foreArmL", 0), -0.3, w));
      out.set("foreArmR", lerp(out.get("foreArmR", 0), -0.3, w));
      out.add("thighL", -0.7 * w);
      out.add("thighR", -0.7 * w);
      out.add("shinL", 1.1 * w);
      out.add("shinR", 1.1 * w);
      out.add("footL", -0.4 * w);
      out.add("footR", -0.4 * w);
      out.hipsY -= 0.22 * w;
      out.curlL = out.curlR = lerp(out.curlL, 0.6, w);
      break;
    }
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Move a bone's rotation part way towards v. */
function towards(out: Pose, b: BoneName, v: V3, w: number): void {
  if (w <= 0) return;
  const i = BONE_INDEX[b] * 3;
  for (let k = 0; k < 3; k++) out.rot[i + k] += (v[k] - out.rot[i + k]) * w;
}

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** Ten evenly spaced samples round a cycle, read smoothly at g (0 … 1). */
function cyc(v: readonly number[], g: number): number {
  const n = v.length;
  const x = g * n;
  const i = Math.floor(x);
  const u = x - i;
  const p0 = v[(i - 1 + n) % n];
  const p1 = v[i % n];
  const p2 = v[(i + 1) % n];
  const p3 = v[(i + 2) % n];
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
}

/**
 * Joint angles through one stride (degrees, 10 samples from the foot
 * landing): hip flexion (+ forward), knee flexion, ankle (+ toes down). From
 * human gait studies: walking lands on the heel with the knee nearly
 * straight and pushes off the toes; running lands under the body with a
 * soft knee, drives off hard and folds the heel up behind; sprinting drives
 * the knee high and kicks the heel right up.
 */
const GAIT = {
  walk: {
    hip: [26, 21, 13, 4, -4, -11, -6, 10, 22, 27],
    knee: [4, 16, 12, 6, 6, 18, 42, 58, 32, 8],
    ankle: [0, 6, -3, -7, -10, -2, 16, 6, -3, -1],
  },
  run: {
    hip: [30, 20, 6, -7, -12, -4, 16, 36, 46, 40],
    knee: [20, 38, 30, 18, 28, 72, 105, 92, 52, 26],
    ankle: [-4, -16, -10, 10, 26, 14, 4, -4, -8, -6],
  },
  sprint: {
    hip: [36, 22, 2, -14, -18, -4, 26, 56, 66, 52],
    knee: [24, 40, 28, 18, 42, 104, 132, 112, 60, 32],
    ankle: [0, -14, -6, 16, 32, 20, 6, -10, -12, -6],
  },
} as const;

/** Carry, both hands: forearms in round the ball, palms on its sides. */
const HOLD: [BoneName, V3][] = [
  ["upperArmL", [-0.22, 0.05, -0.12]],
  ["upperArmR", [-0.22, -0.05, 0.12]],
  ["foreArmL", [-1.5, -0.5, 0]],
  ["foreArmR", [-1.5, 0.5, 0]],
  ["handL", [0, 0.5, -0.25]],
  ["handR", [0, -0.5, 0.25]],
];
/** Carry, tucked: the right upper arm out round the ball, the forearm across its front. */
const TUCK: [BoneName, V3][] = [
  ["upperArmR", [0.1, 0, -0.42]],
  ["foreArmR", [-1.5, 0.75, 0]],
  ["handR", [0, -0.2, 0.3]],
];

/** The stagger (added over the body): impact, a step back on the right, balance, recovery. */
const HIT = clip(HIT_SECONDS, false, [
  { t: 0, b: {} },
  {
    t: 0.07,
    hips: [0, -0.02, -0.02],
    b: {
      spine: [-0.26, 0.24, 0.04],
      chest: [-0.3, 0.3, 0.06],
      head: [-0.42, 0.32, 0.16],
      upperArmL: [-0.65, 0, 0.75],
      upperArmR: [-0.55, 0, -0.8],
      foreArmL: [-0.5, 0, 0],
      foreArmR: [-0.45, 0, 0],
      shinL: [0.15, 0, 0],
      shinR: [0.18, 0, 0],
    },
  },
  {
    t: 0.24,
    hips: [0, -0.06, -0.05],
    b: {
      spine: [-0.1, 0.14, 0.02],
      chest: [-0.12, 0.18, 0.06],
      head: [-0.15, 0.2, 0.08],
      thighR: [0.42, 0, -0.06],
      shinR: [0.5, 0, 0],
      footR: [0.2, 0, 0],
      thighL: [-0.28, 0, 0.05],
      shinL: [0.45, 0, 0],
      footL: [-0.12, 0, 0],
      upperArmL: [-0.45, 0, 1.05],
      upperArmR: [-0.3, 0, -1.15],
      foreArmL: [-0.75, 0, 0],
      foreArmR: [-0.6, 0, 0],
    },
  },
  {
    t: 0.44,
    hips: [0, -0.025, -0.02],
    b: {
      spine: [0.04, 0.04, 0],
      chest: [0.02, 0.05, 0],
      head: [0, 0.05, 0],
      thighR: [0.16, 0, 0],
      shinR: [0.22, 0, 0],
      footR: [0.06, 0, 0],
      thighL: [-0.12, 0, 0],
      shinL: [0.22, 0, 0],
      upperArmL: [-0.2, 0, 0.45],
      upperArmR: [-0.15, 0, -0.5],
      foreArmL: [-0.35, 0, 0],
      foreArmR: [-0.3, 0, 0],
    },
  },
  { t: HIT_SECONDS, b: {} },
]);
const HIT_M = mirror(HIT);

function curl(out: Pose, L: "L" | "R", k: number, bias = 0): void {
  const s = L === "L" ? -1 : 1;
  const base = Math.max(-0.1, 0.25 + k * 1.15 - bias);
  for (const [n, f] of [
    ["index", 0.92 + k * 0.08],
    ["middle", 1],
    ["ring", 1.05],
    ["pinky", 1.1],
  ] as const) {
    out.set(`${n}1${L}` as BoneName, 0, 0, s * base * f * 0.85);
    out.set(`${n}2${L}` as BoneName, 0, 0, s * base * f * 0.9);
  }
  out.set(`thumb1${L}` as BoneName, (-0.2 - k * 0.3) * (1 - bias), 0, s * 0.2 * k);
  out.set(`thumb2${L}` as BoneName, (-0.1 - k * 0.4) * (1 - bias * 0.5), 0, s * 0.3 * k);
}

/** Lobby stances. */
function posePose(id: PoseId, t: number, seed: number, out: Pose): void {
  const b = Math.sin(t * 2 + seed) * 0.02;
  switch (id) {
    case "relaxed":
      out.set("upperArmL", 0.05, 0, 0.1);
      out.set("upperArmR", 0.05, 0, -0.1);
      out.set("foreArmL", -0.2);
      out.set("foreArmR", -0.2);
      out.set("head", 0.02 + b, Math.sin(t * 0.3) * 0.25);
      out.curlL = out.curlR = 0.3;
      return;
    case "hip":
      // IMG_7770 (right): one hand on the hip, the other relaxed.
      out.set("upperArmR", 0.35, 0.6, -0.75);
      out.set("foreArmR", -1.75, 0.4);
      out.set("handR", 0, 0, -0.4);
      out.set("upperArmL", 0.05, 0, 0.12);
      out.set("foreArmL", -0.25);
      out.set("chest", 0, 0, 0.05);
      out.set("head", 0, -0.15, 0.08 + b);
      out.curlR = 0.6;
      out.curlL = 0.3;
      return;
    case "hair":
      // IMG_7770 (centre): hand in the hair, the other on the hip.
      out.set("upperArmL", -2.4, 0.2, 0.55);
      out.set("foreArmL", -2.0, 0.3);
      out.set("handL", 0, 0, 0.4);
      out.set("upperArmR", 0.35, 0.6, -0.75);
      out.set("foreArmR", -1.75, 0.4);
      out.set("handR", 0, 0, -0.4);
      out.set("chest", -0.02, 0.06, 0.06);
      out.set("head", -0.06, 0.12, -0.14 + b);
      out.curlL = 0.45;
      out.curlR = 0.6;
      return;
    case "hero":
      // The welcome art: chest out, fists low, chin up.
      out.set("chest", -0.12 + b);
      out.set("spine", -0.04);
      out.set("clavL", 0, 0, -0.06);
      out.set("clavR", 0, 0, 0.06);
      out.set("upperArmL", 0.06, 0.15, 0.17);
      out.set("upperArmR", 0.06, -0.15, -0.17);
      out.set("foreArmL", -0.32, 0.25);
      out.set("foreArmR", -0.32, -0.25);
      out.set("head", -0.12, Math.sin(t * 0.25) * 0.12);
      out.curlL = out.curlR = 1;
      return;
    case "arms":
      // Arms folded.
      out.set("upperArmL", -0.55, 0.9, 0.18);
      out.set("upperArmR", -0.5, -0.9, -0.18);
      out.set("foreArmL", -1.9, -0.6);
      out.set("foreArmR", -1.95, 0.6);
      out.set("head", -0.04 + b, Math.sin(t * 0.3) * 0.2);
      out.curlL = out.curlR = 0.7;
      return;
  }
}

// ── Dances and full-body emotes (keys.ts) ────────────────────────────────────
// Each is a loop of a few keys; the second half of a dance is the first,
// mirrored. The legs and hips only play standing still (computePose).

/** Afrobeats groove: a knee bounce on every beat, the weight rocking side to side with a hip pop, the free heel up, loose arms rolling, a nod. */
const DANCE_A: Key = {
  t: 0,
  hips: [0.035, -0.05, 0],
  curl: [0.55, 0.55],
  b: {
    hips: [0, 0.1, 0.07],
    spine: [0.08, -0.04, -0.03],
    chest: [0.06, 0.12, -0.05],
    head: [0.14, -0.1, 0.06],
    thighL: [-0.12, 0.1, 0.06],
    shinL: [0.32, 0, 0],
    footL: [-0.18, 0, -0.05],
    thighR: [-0.32, -0.08, -0.08],
    shinR: [0.62, 0, 0],
    footR: [0.32, 0, 0.05],
    clavL: [0, 0, 0.06],
    clavR: [0, 0, -0.02],
    upperArmL: [-0.15, -0.2, 0.32],
    foreArmL: [-1.35, 0, 0],
    handL: [0, 0, 0.15],
    upperArmR: [-0.75, 0.25, -0.2],
    foreArmR: [-1.55, 0, 0],
    handR: [0, 0, -0.2],
  },
};
const DANCE_UP: Key = {
  t: 0.275,
  hips: [0, -0.01, 0],
  curl: [0.5, 0.5],
  b: {
    spine: [0.03, 0, 0],
    head: [-0.05, 0, 0],
    thighL: [-0.08, 0.06, 0.05],
    shinL: [0.14, 0, 0],
    footL: [-0.05, 0, 0],
    thighR: [-0.08, -0.06, -0.05],
    shinR: [0.14, 0, 0],
    footR: [-0.05, 0, 0],
    upperArmL: [-0.45, -0.1, 0.28],
    foreArmL: [-1.45, 0, 0],
    upperArmR: [-0.45, 0.1, -0.28],
    foreArmR: [-1.45, 0, 0],
  },
};
const DANCE = clip(1.1, true, [DANCE_A, DANCE_UP, mirrorKey(DANCE_A, 0.55), { ...DANCE_UP, t: 0.825 }]);

/** Zanku (legwork): a knee lifts high and swings out, stamps down wide; the arms swing across against the legs, leaning in. */
const ZANKU_A: Key = {
  t: 0,
  hips: [-0.02, -0.03, 0],
  curl: [0.7, 0.7],
  b: {
    hips: [0.05, -0.12, -0.08],
    spine: [0.18, -0.1, 0.04],
    chest: [0.12, -0.18, 0.05],
    head: [0.22, 0.1, 0],
    thighL: [-1.05, 0.3, 0.4],
    shinL: [1.35, 0, 0],
    footL: [0.45, 0, 0],
    thighR: [-0.14, 0, -0.04],
    shinR: [0.3, 0, 0],
    footR: [-0.12, 0, 0],
    upperArmR: [-1.1, 0.2, -0.45],
    foreArmR: [-1.1, 0, 0],
    handR: [0.3, 0, -0.3],
    upperArmL: [0.45, 0, 0.35],
    foreArmL: [-0.7, 0, 0],
    handL: [0.2, 0, 0.2],
  },
};
const ZANKU_B: Key = {
  t: 0.25,
  hips: [0.03, -0.08, 0],
  curl: [0.7, 0.7],
  b: {
    hips: [0.08, 0, 0],
    spine: [0.22, 0, 0],
    chest: [0.1, 0, 0],
    head: [0.25, 0, 0],
    thighL: [-0.35, 0.25, 0.32],
    shinL: [0.6, 0, 0],
    footL: [-0.15, 0, -0.1],
    thighR: [-0.3, -0.1, -0.1],
    shinR: [0.6, 0, 0],
    footR: [-0.2, 0, 0],
    upperArmL: [-0.6, -0.4, 0.15],
    foreArmL: [-1.5, 0, 0],
    upperArmR: [-0.6, 0.4, -0.15],
    foreArmR: [-1.5, 0, 0],
  },
};
const ZANKU = clip(1.0, true, [ZANKU_A, ZANKU_B, mirrorKey(ZANKU_A, 0.5), mirrorKey(ZANKU_B, 0.75)]);

/** Shaku Shaku: hunched and loose-kneed, a staggering cross-step, wrists crossed in fists swaying with the body, head down. */
const SHAKU_A: Key = {
  t: 0,
  hips: [-0.04, -0.07, 0],
  curl: [0.95, 0.95],
  b: {
    hips: [0.1, 0.15, -0.06],
    spine: [0.22, 0.1, 0.1],
    chest: [0.18, 0.2, 0.08],
    neck: [0.1, 0, 0],
    head: [0.25, -0.1, -0.12],
    thighR: [-0.3, 0, -0.05],
    shinR: [0.6, 0, 0],
    footR: [-0.25, 0, 0],
    thighL: [-0.45, -0.1, -0.18],
    shinL: [0.75, 0, 0],
    footL: [0.3, 0, 0],
    upperArmL: [-1.1, -0.5, 0],
    foreArmL: [-1.3, 0, 0],
    upperArmR: [-1.1, 0.5, 0],
    foreArmR: [-1.3, 0, 0],
  },
};
const SHAKU_MID: Key = {
  t: 0.3,
  hips: [0, -0.09, 0],
  curl: [0.95, 0.95],
  b: {
    hips: [0.12, 0, 0],
    spine: [0.25, 0, 0],
    chest: [0.18, 0, 0],
    neck: [0.1, 0, 0],
    head: [0.3, 0, 0],
    thighL: [-0.32, 0.05, 0.05],
    shinL: [0.65, 0, 0],
    footL: [-0.2, 0, 0],
    thighR: [-0.32, -0.05, -0.05],
    shinR: [0.65, 0, 0],
    footR: [-0.2, 0, 0],
    upperArmL: [-1.0, -0.5, 0],
    foreArmL: [-1.35, 0, 0],
    upperArmR: [-1.0, 0.5, 0],
    foreArmR: [-1.35, 0, 0],
  },
};
const SHAKU = clip(1.2, true, [SHAKU_A, SHAKU_MID, mirrorKey(SHAKU_A, 0.6), { ...SHAKU_MID, t: 0.9 }]);

/** Odogwu: chest out and chin up, a slow swagger bounce, a fist up to the sky, the other hand on the heart. */
const ODOGWU_UP: Key = {
  t: 0,
  curl: [0.4, 1],
  b: {
    chest: [-0.15, 0.1, 0],
    spine: [-0.05, 0, 0],
    head: [-0.22, 0.15, 0],
    thighL: [-0.05, 0.1, 0.1],
    shinL: [0.12, 0, 0],
    thighR: [-0.05, -0.1, -0.1],
    shinR: [0.12, 0, 0],
    upperArmR: [-2.85, 0, -0.18],
    foreArmR: [-0.2, 0, 0],
    upperArmL: [-0.35, 0.7, 0.15],
    foreArmL: [-2.1, 0, 0],
  },
};
const ODOGWU_DOWN: Key = {
  t: 0.35,
  hips: [0, -0.05, 0],
  curl: [0.4, 1],
  b: {
    chest: [-0.05, 0.05, 0.04],
    spine: [0, 0, 0],
    head: [-0.1, 0.1, 0],
    thighL: [-0.2, 0.1, 0.1],
    shinL: [0.38, 0, 0],
    footL: [-0.18, 0, 0],
    thighR: [-0.2, -0.1, -0.1],
    shinR: [0.38, 0, 0],
    footR: [-0.18, 0, 0],
    clavR: [0, 0, -0.1],
    upperArmR: [-2.55, 0, -0.25],
    foreArmR: [-0.6, 0, 0],
    upperArmL: [-0.35, 0.7, 0.15],
    foreArmL: [-2.1, 0, 0],
  },
};
const ODOGWU = clip(1.4, true, [
  ODOGWU_UP,
  ODOGWU_DOWN,
  { ...ODOGWU_UP, t: 0.7, b: { ...ODOGWU_UP.b, chest: [-0.15, -0.1, 0], head: [-0.22, -0.15, 0] } },
  { ...ODOGWU_DOWN, t: 1.05 },
]);

/** Slay: weight on one leg, the other knee in on its toes, hand on the hip; the free hand flicks the hair back with a head toss, the hip pops across and back. */
const SLAY_POSE: Partial<Record<BoneName, V3>> = {
  hips: [0, -0.1, 0.07],
  spine: [0, 0, -0.04],
  chest: [-0.04, 0.08, 0.06],
  head: [-0.05, 0.15, -0.14],
  thighR: [-0.02, 0, -0.02],
  shinR: [0.06, 0, 0],
  thighL: [-0.28, 0.15, -0.05],
  shinL: [0.55, 0, 0],
  footL: [0.4, 0, 0],
  upperArmL: [-2.4, 0.2, 0.55],
  foreArmL: [-2.0, 0.3, 0],
  handL: [0, 0, 0.4],
  upperArmR: [0.35, 0.6, -0.75],
  foreArmR: [-1.75, 0.4, 0],
  handR: [0, 0, -0.4],
};
const SLAY = clip(1.6, true, [
  { t: 0, hips: [0.04, -0.01, 0], curl: [0.45, 0.6], b: SLAY_POSE },
  {
    t: 0.45,
    hips: [0.05, -0.02, 0],
    curl: [0.2, 0.6],
    b: { ...SLAY_POSE, chest: [-0.12, 0.15, 0.08], head: [-0.3, 0.3, 0.2], upperArmL: [-2.85, 0.5, 0.95], foreArmL: [-1.1, 0.4, 0], handL: [0.3, 0, 0.3] },
  },
  {
    t: 0.85,
    hips: [-0.04, -0.01, 0],
    curl: [0.4, 0.6],
    b: {
      ...SLAY_POSE,
      hips: [0, 0.1, -0.07],
      chest: [-0.04, -0.06, -0.05],
      head: [-0.05, -0.1, 0.1],
      thighL: [-0.02, 0, 0.02],
      shinL: [0.06, 0, 0],
      footL: [0, 0, 0],
      thighR: [-0.28, -0.15, 0.05],
      shinR: [0.55, 0, 0],
      footR: [0.4, 0, 0],
      upperArmL: [-0.2, 0.3, 0.2],
      foreArmL: [-1.2, 0, 0],
      handL: [0, 0, 0],
    },
  },
  { t: 1.25, hips: [0.03, -0.01, 0], curl: [0.45, 0.6], b: { ...SLAY_POSE, upperArmL: [-1.6, 0.2, 0.4], foreArmL: [-1.8, 0.2, 0] } },
]);

/** Flex: a wide, sunk stance, both arms up in a double biceps, pumping. */
const FLEX_A: Key = {
  t: 0,
  hips: [0, -0.06, 0],
  curl: [1, 1],
  b: {
    thighL: [-0.2, 0.15, 0.2],
    shinL: [0.4, 0, 0],
    footL: [-0.2, 0, -0.2],
    thighR: [-0.2, -0.15, -0.2],
    shinR: [0.4, 0, 0],
    footR: [-0.2, 0, 0.2],
    upperArmL: [-1.5, 0, 1.2],
    foreArmL: [-2.0, 0, 0],
    upperArmR: [-1.5, 0, -1.2],
    foreArmR: [-2.0, 0, 0],
    chest: [-0.15, 0, 0],
    head: [-0.1, 0, 0],
  },
};
const FLEX = clip(1.0, true, [
  FLEX_A,
  { ...FLEX_A, t: 0.5, hips: [0, -0.03, 0], b: { ...FLEX_A.b, shinL: [0.25, 0, 0], shinR: [0.25, 0, 0], foreArmL: [-1.7, 0, 0], foreArmR: [-1.7, 0, 0], chest: [-0.22, 0, 0], head: [-0.16, 0, 0] } },
]);

/** Taunt: "come on" — bouncing on the toes, one hand out palm up beckoning, chin up. */
const TAUNT_A: Key = {
  t: 0,
  curl: [0.05, 0.4],
  b: {
    upperArmL: [-1.35, -0.2, 0.15],
    foreArmL: [-0.25, 0, 0],
    upperArmR: [-0.3, 0, -0.15],
    foreArmR: [-1.7, 0, 0],
    chest: [-0.08, 0.15, 0],
    head: [-0.12, 0.1, 0],
    thighL: [-0.1, 0, 0.04],
    shinL: [0.2, 0, 0],
    footL: [0.2, 0, 0],
    thighR: [-0.1, 0, -0.04],
    shinR: [0.2, 0, 0],
    footR: [0.2, 0, 0],
  },
};
const TAUNT = clip(0.9, true, [
  TAUNT_A,
  { ...TAUNT_A, t: 0.45, hips: [0, -0.035, 0], curl: [0.8, 0.4], b: { ...TAUNT_A.b, foreArmL: [-1.35, 0, 0], shinL: [0.38, 0, 0], shinR: [0.38, 0, 0], footL: [-0.05, 0, 0], footR: [-0.05, 0, 0] } },
]);

/** Laugh: bent over it, a hand on the belly, the other slapping the thigh, shoulders shaking. */
const LAUGH_A: Key = {
  t: 0,
  hips: [0, -0.02, 0],
  curl: [0.4, 0.2],
  b: {
    spine: [0.25, 0, 0],
    chest: [0.15, 0, 0],
    head: [-0.15, 0, 0.05],
    upperArmL: [-0.5, 0.4, 0.1],
    foreArmL: [-1.6, 0, 0],
    upperArmR: [-0.1, 0, -0.15],
    foreArmR: [-0.6, 0, 0],
    thighL: [-0.08, 0, 0.03],
    shinL: [0.15, 0, 0],
    thighR: [-0.08, 0, -0.03],
    shinR: [0.15, 0, 0],
  },
};
const LAUGH = clip(0.8, true, [
  LAUGH_A,
  { ...LAUGH_A, t: 0.4, hips: [0, -0.04, 0], b: { ...LAUGH_A.b, spine: [0.36, 0, 0], chest: [0.2, 0, 0], head: [-0.05, 0, -0.05], upperArmR: [-0.35, 0, -0.1], foreArmR: [-0.9, 0, 0], shinL: [0.25, 0, 0], shinR: [0.25, 0, 0] } },
]);

const CLIPS: Partial<Record<EmoteId, Clip>> = { dance: DANCE, zanku: ZANKU, shaku: SHAKU, odogwu: ODOGWU, slay: SLAY, flex: FLEX, taunt: TAUNT, laugh: LAUGH };

/** Emote poses as functions of time: the keyed ones (CLIPS), the rest upper body. */
function emotePose(id: EmoteId, t: number, out: Pose, seed: number): void {
  const c = CLIPS[id];
  if (c) {
    // Everyone starts a dance at their own point in it.
    play(c, t + (seed % 1) * c.period, out);
    return;
  }
  const set = (b: BoneName, x: number, y = 0, z = 0) => out.set(b, x, y, z);
  switch (id) {
    case "wave":
      set("upperArmL", -2.6, 0, 0.35);
      set("foreArmL", -0.5 + Math.sin(t * 12) * 0.45, 0, 0);
      set("head", -0.05, 0.1);
      out.curlL = 0.05;
      return;
    case "cry":
      set("upperArmL", -2.05, 0, -0.05);
      set("upperArmR", -2.05, 0, 0.05);
      set("foreArmL", -2.3);
      set("foreArmR", -2.3);
      set("chest", 0.18);
      set("head", 0.35 + Math.sin(t * 14) * 0.04);
      return;
    case "respect":
      set("upperArmL", 0.05, 0, 0.05);
      set("upperArmR", 0.05, 0, -0.05);
      set("foreArmL", -0.1);
      set("foreArmR", -0.1);
      set("spine", 0.45);
      set("chest", 0.3);
      set("head", 0.35);
      out.curlL = out.curlR = 0.1;
      return;
    case "handshake":
      set("upperArmR", -1.05, 0, -0.1);
      set("foreArmR", -0.45 + Math.sin(t * 10) * 0.12);
      out.curlR = 0.55;
      return;
  }
}
