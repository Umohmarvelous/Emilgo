// Procedural animation: every pose is a function of time and state, no clips.
//
//   locomotion  walk → run → sprint, driven by distance actually travelled (the
//               feet never skate), with a stride that holds a moment after a
//               sudden stop: the statue look Red Light is all about
//   stance      stand → crouch → prone, blended continuously
//   air         a tuck while jumping
//   fall        caught: a COD-style death away from Mama (ragdoll.ts)
//   cheer       arms up at the finish
//   emotes      upper-body poses blended over whatever the legs are doing
//   actions     fist, slap, push, picking a ball up; carrying it; staggering
//               after a hit (SPEC-V2 §2.4)
//   poses       lobby stances from the reference photos (hand on hip, hand in
//               hair, hero stance, relaxed)
//
// Conventions (skeleton.ts): rotations about X swing limbs forward (−) and
// back (+); about Z swing them out (left side +, right side −); spine/head +X
// leans forward. Everything here is presentation; the referee never reads it.

import { EMOTE_SECONDS, type EmoteId } from "../../social/emotes";
import { fallKind, fallProgress, ragdollPose } from "./ragdoll";
import { BONES, BONE_INDEX, type BoneName } from "./skeleton";

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
    hitT: 0,
    hitSide: 0,
    slide: 0,
    pose: null,
    lookYaw: 0,
    lookPitch: 0,
    narrow: false,
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
  a.carryW += ((a.carry ? 1 : 0) - a.carryW) * (1 - Math.exp(-dt * 10));
  const walkRef = a.stance > 0.5 ? 1.2 : WALK;
  const want = Math.min(1, speed / walkRef);
  // Rise fast, settle slowly: a sudden stop holds the stride for a moment.
  a.amp += (want - a.amp) * (1 - Math.exp(-dt * (want > a.amp ? 9 : 1.4)));
  const wantRun = Math.max(0, Math.min(1, (speed - WALK) / (RUN - WALK)));
  a.run += (wantRun - a.run) * (1 - Math.exp(-dt * 6));
  const wantSprint = Math.max(0, Math.min(1, (speed - RUN) / (SPRINT - RUN)));
  a.sprint += (wantSprint - a.sprint) * (1 - Math.exp(-dt * 6));
  const stride = (a.stance > 0.5 ? 0.9 : 1.25 + 0.75 * a.run + 0.7 * a.sprint) * (a.narrow ? 0.75 : 1);
  a.phase += (speed / stride) * Math.PI * 2 * dt;
}

const _emote = new Pose();
const _base = new Pose();

/** The full pose for this frame. */
export function computePose(a: AnimState, out: Pose): void {
  out.clear();
  const t = a.time;

  if (a.dead >= 0) {
    ragdollPose(a, out);
    curl(out, "L", out.curlL);
    curl(out, "R", out.curlR);
    return;
  }

  // ── Legs and body: locomotion with stance ──
  const s = Math.sin(a.phase);
  const c = Math.cos(a.phase);
  const amp = a.amp * (1 - a.air);
  const run = a.run;
  const spr = a.sprint;
  const crouch = Math.min(1, a.stance);
  const prone = Math.max(0, a.stance - 1);
  const narrow = a.narrow ? 0.6 : 1;

  const swing = (0.42 + 0.32 * run + 0.22 * spr) * amp * narrow * (1 - crouch * 0.4);
  let thighL = -s * swing;
  let thighR = s * swing;
  const lift = 0.7 + 0.5 * run + 0.45 * spr;
  let kneeL = amp * (0.1 + lift * Math.max(0, -Math.sin(a.phase + 0.6)));
  let kneeR = amp * (0.1 + lift * Math.max(0, Math.sin(a.phase + 0.6)));
  let footL = amp * 0.35 * Math.max(0, Math.sin(a.phase - 0.4)) - amp * 0.15 * Math.max(0, -Math.sin(a.phase + 0.3));
  let footR = amp * 0.35 * Math.max(0, -Math.sin(a.phase - 0.4)) - amp * 0.15 * Math.max(0, Math.sin(a.phase + 0.3));

  // Idle: standing still, breathing (SPEC-V2 §5.4: no sway, no weight shift).
  const breathe = Math.sin(t * 1.6 + a.seed) * 0.01;

  // Crouch: drop the hips and fold the legs so the feet stay put.
  const legLen = 0.84;
  const drop = crouch * 0.36 * (1 - prone);
  const fold = Math.acos(Math.max(0.2, Math.min(1, (legLen - drop) / legLen)));
  out.hipsY = -drop + Math.abs(c) * 0.045 * amp * (0.6 + run + spr) * (1 - crouch);
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

  out.set("thighL", thighL, 0, 0.02);
  out.set("thighR", thighR, 0, -0.02);
  out.set("shinL", kneeL);
  out.set("shinR", kneeR);
  out.set("footL", footL);
  out.set("footR", footR);

  const lean = 0.04 + 0.14 * run * amp + 0.16 * spr * amp + crouch * 0.32 * (1 - prone);
  out.add("hips", 0, s * 0.09 * amp, 0);
  out.add("hips", 0, 0, s * 0.04 * amp * (1 - run));
  out.set("spine", lean * 0.5 + breathe * 0.3, -s * 0.07 * amp, 0);
  out.set("chest", lean * 0.5 - breathe, -s * 0.06 * amp, 0);
  out.set("neck", -lean * 0.35, s * 0.03 * amp);
  out.set("head", -lean * 0.3 + breathe * 0.4 + a.lookPitch, a.lookYaw, 0);

  // Arms swing against the legs; elbows bend more the faster you go.
  const armSwing = swing * 0.9 + 0.25 * spr * amp;
  const elbow = -0.2 - 0.9 * run * amp - 0.45 * spr * amp - crouch * 0.6;
  out.set("upperArmL", s * armSwing - crouch * 0.4 - a.air * 0.6, 0, 0.06 + 0.05 * run + a.air * 0.3);
  out.set("upperArmR", -s * armSwing - crouch * 0.4 - a.air * 0.6, 0, -0.06 - 0.05 * run - a.air * 0.3);
  out.set("foreArmL", elbow + Math.max(0, s) * -0.25 * amp);
  out.set("foreArmR", elbow + Math.max(0, -s) * -0.25 * amp);
  out.set("clavL", 0, 0, breathe * 0.4);
  out.set("clavR", 0, 0, -breathe * 0.4);
  out.curlL = out.curlR = 0.2 + run * 0.5 * amp + spr * 0.3;

  // Prone: lie forward on the belly, crawl on forearms.
  if (prone > 0) {
    out.tilt = (Math.PI / 2) * prone;
    out.tiltYaw = 0;
    out.rootY = 0.11 * prone;
    out.hipsY *= 1 - prone;
    const cr = Math.sin(a.phase) * amp;
    for (const [b, v] of [
      ["thighL", -0.05 + cr * 0.25],
      ["thighR", -0.05 - cr * 0.25],
      ["shinL", 0.2 + Math.max(0, cr) * 0.6],
      ["shinR", 0.2 + Math.max(0, -cr) * 0.6],
      ["footL", 0.5],
      ["footR", 0.5],
      ["spine", -0.05],
      ["chest", -0.1],
      ["neck", -0.5],
      ["head", -0.45],
    ] as [BoneName, number][]) {
      out.set(b, out.get(b, 0) + (v - out.get(b, 0)) * prone, out.get(b, 1) * (1 - prone), out.get(b, 2) * (1 - prone));
    }
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

  // ── Emote over everything (upper body; the feet never move) ──
  if (a.emote) {
    const e = a.emoteT;
    const w = Math.min(1, e / 0.15, (EMOTE_SECONDS - e) / 0.25);
    _emote.clear();
    for (let i = 0; i < out.rot.length; i++) _emote.rot[i] = out.rot[i];
    _emote.curlL = out.curlL;
    _emote.curlR = out.curlR;
    emotePose(a.emote, e, _emote);
    out.blendUpper(_emote, Math.max(0, w));
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
    out.set("spine", lerp(out.get("spine", 0), -0.35, w));
    out.set("chest", lerp(out.get("chest", 0), -0.15, w));
    out.set("head", lerp(out.get("head", 0), 0.3, w));
    out.set("upperArmL", lerp(out.get("upperArmL", 0), 0.6, w), 0, lerp(out.get("upperArmL", 2), 0.5, w));
    out.set("upperArmR", lerp(out.get("upperArmR", 0), -0.9, w), 0, lerp(out.get("upperArmR", 2), -0.2, w));
    out.set("foreArmL", lerp(out.get("foreArmL", 0), -0.3, w));
    out.set("foreArmR", lerp(out.get("foreArmR", 0), -0.8, w));
  }

  // ── Carrying a ball: both hands round it, in front of the chest ──
  if (a.carryW > 0.01) {
    const w = a.carryW;
    out.set("upperArmL", lerp(out.get("upperArmL", 0), -0.55, w), 0, lerp(out.get("upperArmL", 2), -0.08, w));
    out.set("upperArmR", lerp(out.get("upperArmR", 0), -0.55, w), 0, lerp(out.get("upperArmR", 2), 0.08, w));
    out.set("foreArmL", lerp(out.get("foreArmL", 0), -1.35, w), lerp(out.get("foreArmL", 1), 0.35, w));
    out.set("foreArmR", lerp(out.get("foreArmR", 0), -1.35, w), lerp(out.get("foreArmR", 1), -0.35, w));
    out.curlL = lerp(out.curlL, 0.55, w);
    out.curlR = lerp(out.curlR, 0.55, w);
  }

  // ── A one-off action over everything ──
  if (a.action) actionPose(a.action, a.actionT, out);

  // ── Hit: knocked back, arms out, head snapped back ──
  if (a.hitT > 0) {
    const k = a.hitT / HIT_SECONDS;
    const w = Math.sin(Math.min(1, k * 1.4) * Math.PI * 0.5) * Math.min(1, (1 - k) * 6 + 0.2);
    out.add("spine", -0.22 * w, a.hitSide * 0.2 * w);
    out.add("chest", -0.28 * w, a.hitSide * 0.25 * w);
    out.add("head", -0.35 * w, a.hitSide * 0.3 * w);
    out.add("upperArmL", -0.5 * w, 0, 0.6 * w);
    out.add("upperArmR", -0.5 * w, 0, -0.6 * w);
    out.add("foreArmL", -0.4 * w);
    out.add("foreArmR", -0.4 * w);
    out.curlL = out.curlR = lerp(out.curlL, 0.05, w);
  }

  // Fingers follow the curl.
  curl(out, "L", out.curlL);
  curl(out, "R", out.curlR);
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

function curl(out: Pose, L: "L" | "R", k: number): void {
  const s = L === "L" ? -1 : 1;
  const base = 0.25 + k * 1.15;
  for (const [n, f] of [
    ["index", 0.92 + k * 0.08],
    ["middle", 1],
    ["ring", 1.05],
    ["pinky", 1.1],
  ] as const) {
    out.set(`${n}1${L}` as BoneName, 0, 0, s * base * f * 0.85);
    out.set(`${n}2${L}` as BoneName, 0, 0, s * base * f * 0.9);
  }
  out.set(`thumb1${L}` as BoneName, -0.2 - k * 0.3, 0, s * 0.2 * k);
  out.set(`thumb2${L}` as BoneName, -0.1 - k * 0.4, 0, s * 0.3 * k);
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

/** Upper-body emote poses as functions of time. */
function emotePose(id: EmoteId, t: number, out: Pose): void {
  const set = (b: BoneName, x: number, y = 0, z = 0) => out.set(b, x, y, z);
  switch (id) {
    case "wave":
      set("upperArmL", -2.6, 0, 0.35);
      set("foreArmL", -0.5 + Math.sin(t * 12) * 0.45, 0, 0);
      set("head", -0.05, 0.1);
      out.curlL = 0.05;
      return;
    case "dance": {
      const k = Math.sin(t * 9);
      set("upperArmL", -1.2 + k * 0.9, 0, 0.3);
      set("upperArmR", -1.2 - k * 0.9, 0, -0.3);
      set("foreArmL", -1.2);
      set("foreArmR", -1.2);
      set("chest", 0.1, k * 0.35);
      set("head", 0, -k * 0.2);
      return;
    }
    case "laugh":
      set("upperArmL", -0.35, 0, 0.15);
      set("upperArmR", -0.35, 0, -0.15);
      set("foreArmL", -1.6);
      set("foreArmR", -1.6);
      set("spine", -0.12 + Math.sin(t * 16) * 0.04);
      set("chest", -0.1);
      set("head", -0.35);
      return;
    case "cry":
      set("upperArmL", -2.05, 0, -0.05);
      set("upperArmR", -2.05, 0, 0.05);
      set("foreArmL", -2.3);
      set("foreArmR", -2.3);
      set("chest", 0.18);
      set("head", 0.35 + Math.sin(t * 14) * 0.04);
      return;
    case "taunt":
      set("upperArmL", -1.55, 0, 0.1);
      set("foreArmL", -0.05);
      set("upperArmR", -0.4, 0, -0.1);
      set("foreArmR", -1.7);
      set("chest", -0.08, Math.sin(t * 7) * 0.12);
      set("head", -0.1);
      out.curlL = 0.05;
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
    case "zanku": {
      const k = Math.sin(t * 11);
      set("upperArmL", -0.9 + k * 0.5, 0, 0.5);
      set("upperArmR", -0.9 - k * 0.5, 0, -0.5);
      set("foreArmL", -1.9);
      set("foreArmR", -1.9);
      set("chest", 0.2 + Math.abs(k) * 0.12);
      set("head", k * 0.12);
      return;
    }
    case "shaku": {
      const k = Math.sin(t * 13);
      set("upperArmL", -1.4 + k * 0.6, 0, -0.2);
      set("upperArmR", -1.4 - k * 0.6, 0, 0.2);
      set("foreArmL", -0.8);
      set("foreArmR", -0.8);
      set("chest", 0, Math.sin(t * 6.5) * 0.4);
      return;
    }
    case "odogwu":
      set("upperArmL", -0.6, 0, 0.12);
      set("foreArmL", -2.4);
      set("upperArmR", -2.9, 0, -0.12);
      set("foreArmR", -0.1);
      set("chest", -0.15);
      set("head", -0.25);
      out.curlR = 0.95;
      return;
    case "slay":
      // IMG_7770: hand in the hair, hand on the hip, a hip pop.
      set("upperArmL", -2.4, 0.2, 0.55);
      set("foreArmL", -2.0, 0.3);
      set("upperArmR", 0.35, 0.6, -0.75);
      set("foreArmR", -1.75, 0.4);
      set("chest", -0.02, 0.06 + Math.sin(t * 4) * 0.03, 0.06);
      set("head", -0.06, 0.12, -0.14);
      return;
    case "flex":
      set("upperArmL", -1.5, 0, 1.2);
      set("upperArmR", -1.5, 0, -1.2);
      set("foreArmL", -1.9 + Math.sin(t * 6) * 0.15);
      set("foreArmR", -1.9 - Math.sin(t * 6) * 0.15);
      set("chest", -0.12);
      out.curlL = out.curlR = 1;
      return;
  }
}
