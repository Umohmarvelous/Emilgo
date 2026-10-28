// The body every mode shares (SPEC-V3 §1.1): a person's movement state and
// the one movement kernel that moves them for a fixed step — walk, run,
// sprint and stamina, jump, crouch, prone, the slide, stun, solid walls. The
// referees (server and Solo) and the online client's prediction all call
// moveContestant, so a body moves identically everywhere. Judging, finishing
// and collisions between people stay with each mode's referee.
//
// Moved out of rules.ts unchanged (Phase 1); rules.ts re-exports all of it.

import { DEFAULT_COURSE, FIELD, MOVE, RULES, type Course, type Stance } from "../../config";
import { modsOf, NO_BOOST, type BoostMods } from "../../shop/boosts";
import type { ActKind } from "../combat";
import { collideWalls } from "../pens";
import type { Space } from "./space";

export type Status = "alive" | "finished" | "eliminated";
/** moved: caught by the doll; time: the clock ran out; noball: every ball was banked without yours. */
export type Cause = "moved" | "time" | "noball";

export interface Contestant {
  readonly id: string;
  readonly name: string;
  readonly bot: boolean;
  readonly index: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing angle: the body faces (sin h, cos h) in x/z. */
  heading: number;
  status: Status;
  /** Seconds of play when they crossed, or -1. */
  finishTime: number;
  place: number;
  /** Seconds of play when they were caught, or -1. */
  eliminatedAt: number;
  cause: Cause | null;
  /** Requested movement in WORLD space, length 0..1 (1 = full run). */
  inX: number;
  inZ: number;
  /** Height above the floor under you (a jump, a fall) and vertical speed. */
  y: number;
  vy: number;
  /**
   * The floor's own height under you (SPEC-V3 open worlds: a roof, the
   * stairs, a gutter). Always 0 on the flat Red Light, Green Light field.
   */
  h: number;
  /** Current stance (0 stand, 1 crouch, 2 prone) and the one asked for. */
  stance: Stance;
  inStance: Stance;
  /** Seconds left of a stance change in progress (counts as moving). */
  stanceT: number;
  /** Sprint held, and whether actually sprinting now. */
  inSprint: boolean;
  sprinting: boolean;
  /** 0..1. Sprinting spends it; it refills after a short rest. */
  stamina: number;
  /** Seconds since the last sprint (refill delay). */
  rested: number;
  /** Jump requests: a counter, so a repeated or lost message can't double or drop one. */
  inJump: number;
  jumpSeen: number;
  /** Attack requests: (counter << 2) | kind (1 fist, 2 slap, 3 push). Grab requests: a counter. */
  inAttack: number;
  attackSeen: number;
  inGrab: number;
  grabSeen: number;
  /** The ball held (index), or −1. */
  ball: number;
  /** Seconds left: stunned (can't steer), forgiven by the doll, mid-action, before attacking again. */
  stun: number;
  forgive: number;
  act: number;
  cool: number;
  /** What the current action is (animation). */
  actKind: ActKind;
  /** Seconds left of a slide (sprint, then crouch). */
  slide: number;
  /** Furthest distance past the start line, metres. */
  progress: number;
  /**
   * Extra seconds before movement counts against THIS contestant once she is
   * watching. Online, the server sets it to the player's measured round trip
   * (capped): they saw her turn late and their "stop" arrived late, so they get
   * exactly that time back. Always 0 offline.
   */
  graceBonus: number;
  /** CP boosts this round (shop/boosts.ts): NO_BOOST in staked matches and for CPUs. */
  bst: Readonly<BoostMods>;
  /** Iron Grip: hits left this round that won't knock the ball loose. */
  grip: number;
}

/** A fresh contestant's movement state (shared by the referee and the online client). */
type Motion = "bst" | "grip" | "y" | "vy" | "h" | "stance" | "inStance" | "stanceT" | "inSprint" | "sprinting" | "stamina" | "rested" | "inJump" | "jumpSeen" | "inAttack" | "attackSeen" | "inGrab" | "grabSeen" | "ball" | "stun" | "forgive" | "act" | "cool" | "actKind" | "slide";

export function freshMotion(): Pick<Contestant, Motion> {
  return {
    bst: NO_BOOST, grip: 0, y: 0, vy: 0, h: 0, stance: 0, inStance: 0, stanceT: 0, inSprint: false, sprinting: false, stamina: 1, rested: 9, inJump: 0, jumpSeen: 0,
    inAttack: 0, attackSeen: 0, inGrab: 0, grabSeen: 0, ball: -1, stun: 0, forgive: 0, act: 0, cool: 0, actKind: "", slide: 0,
  };
}

/** A contestant's CP boosts for the round (the referee's, the online client's, the replay's copy alike). */
export function setBoosts(c: Contestant, ids: readonly string[] | undefined): void {
  c.bst = modsOf(ids);
  c.grip = c.bst.grip;
}

/** Moving, as Mama sees it: on the move, in the air, changing stance, swinging or picking up. */
export function isMoving(c: Contestant): boolean {
  return Math.hypot(c.vx, c.vz) > RULES.tolerance || c.y > 0.02 || c.stanceT > 0 || c.act > 0;
}

/**
 * One contestant's movement for one fixed step: stick and buttons → speed →
 * velocity → position, clamped to the street, facing where they go. Shared by
 * the referee and by the online client's prediction, so both move a runner
 * identically. Finishing, collisions and judging are NOT here — only the
 * referee does those.
 */
export function moveContestant(c: Contestant, dt: number, course: Course = DEFAULT_COURSE, space: Space | null = null): void {
  if (c.status === "eliminated") return;

  if (c.stun > 0) c.stun = Math.max(0, c.stun - dt);
  if (c.forgive > 0) c.forgive = Math.max(0, c.forgive - dt);
  if (c.act > 0) {
    c.act = Math.max(0, c.act - dt);
    if (c.act === 0) c.actKind = "";
  }
  if (c.cool > 0) c.cool = Math.max(0, c.cool - dt);

  let ix = c.inX;
  let iz = c.inZ;
  let wantStance = c.inStance;
  let wantSprint = c.inSprint;
  if (c.status === "finished") {
    // Walk on into the safe zone, then stand still. Input is ignored.
    ix = 0;
    iz = c.z > course.safeZ ? -0.5 : 0;
    wantStance = 0;
    wantSprint = false;
    c.jumpSeen = c.inJump;
  } else if (c.stun > 0) {
    // Hit or shoved: sliding, not steering. Requests made now are dropped.
    ix = iz = 0;
    wantStance = c.stance;
    wantSprint = false;
    c.jumpSeen = c.inJump;
  }
  const grounded = c.y <= 0 && c.vy <= 0;

  // ── Slide: crouching out of a sprint carries you on, low, for a moment ──
  if (c.slide > 0) {
    c.slide = Math.max(0, c.slide - dt);
    const sp = Math.hypot(c.vx, c.vz);
    // Slowing evenly from where it started to a crouch's pace; no steering.
    const want = MOVE.crouch + (MOVE.sprint - MOVE.crouch) * (c.slide / MOVE.slideTime);
    if (sp > 1e-3) {
      c.vx *= want / sp;
      c.vz *= want / sp;
    }
    c.x += c.vx * dt;
    c.z += c.vz * dt;
    bound(c, course, space);
    c.progress = Math.max(c.progress, FIELD.startZ - c.z);
    if (c.stanceT > 0) c.stanceT = Math.max(0, c.stanceT - dt);
    return;
  }
  if (c.status === "alive" && c.sprinting && grounded && c.stance === 0 && wantStance > 0 && c.stanceT === 0 && Math.hypot(c.vx, c.vz) > MOVE.run) {
    c.slide = MOVE.slideTime;
    c.sprinting = false;
    c.stance = 1;
    c.stanceT = MOVE.stanceTime;
    return;
  }

  // ── Stance: one step at a time (prone ↔ crouch ↔ stand), never in the air ──
  if (c.stanceT > 0) c.stanceT = Math.max(0, c.stanceT - dt);
  if (c.stanceT === 0 && grounded && wantStance !== c.stance) {
    c.stance = (c.stance + (wantStance > c.stance ? 1 : -1)) as Stance;
    c.stanceT = MOVE.stanceTime;
  }

  // ── Jump: standing, on the ground, once per request ──
  if (c.inJump !== c.jumpSeen) {
    c.jumpSeen = c.inJump;
    if (grounded && c.stance === 0 && c.stanceT === 0) c.vy = Math.sqrt(2 * MOVE.gravity * MOVE.jumpHeight);
  }
  if (c.y > 0 || c.vy > 0) {
    // Exact for constant gravity, so the peak is the same at any step size.
    c.y += c.vy * dt - 0.5 * MOVE.gravity * dt * dt;
    c.vy -= MOVE.gravity * dt;
    if (c.y <= 0) {
      c.y = 0;
      c.vy = 0;
    }
  }

  // ── Speed from the stick, the stance and the sprint ──
  const m = Math.hypot(ix, iz);
  const bst = c.bst;
  let top: number = c.stance === 2 ? MOVE.prone * bst.crouch : c.stance === 1 ? MOVE.crouch * bst.crouch : (m < MOVE.runAt ? MOVE.walk * (m / MOVE.runAt) : MOVE.run) * bst.speed;
  if (c.stance === 0 && m >= MOVE.runAt) {
    const can = c.sprinting ? c.stamina > 0 : c.stamina >= MOVE.sprintMin;
    c.sprinting = wantSprint && can;
    if (c.sprinting) top = MOVE.sprint * bst.sprint;
  } else {
    c.sprinting = false;
  }
  if (c.stance > 0 && m > 1e-3) top *= Math.min(1, m / MOVE.runAt + 0.3);
  if (c.sprinting) {
    c.stamina = Math.max(0, c.stamina - dt / (MOVE.sprintFor * bst.stamina));
    c.rested = 0;
  } else {
    c.rested += dt;
    if (c.rested >= MOVE.refillDelay) c.stamina = Math.min(1, c.stamina + (dt * bst.refill) / MOVE.refillIn);
  }
  const speed = m < 1e-3 ? 0 : top;
  const tx = m < 1e-3 ? 0 : (ix / m) * speed;
  const tz = m < 1e-3 ? 0 : (iz / m) * speed;

  let dvx = tx - c.vx;
  let dvz = tz - c.vz;
  const dv = Math.hypot(dvx, dvz);
  const current = Math.hypot(c.vx, c.vz);
  const rate = (c.y > 0 ? MOVE.airAccel : speed >= current ? MOVE.accel : MOVE.decel) * dt;
  if (dv > rate) {
    dvx *= rate / dv;
    dvz *= rate / dv;
  }
  c.vx += dvx;
  c.vz += dvz;
  if (Math.hypot(c.vx, c.vz) < 1e-3) {
    c.vx = 0;
    c.vz = 0;
  }

  c.x += c.vx * dt;
  c.z += c.vz * dt;
  bound(c, course, space);

  // Face where you are going; keep the last facing when standing still (or knocked back).
  const sp = Math.hypot(c.vx, c.vz);
  if (sp > 0.3 && c.stun <= 0) {
    const want = Math.atan2(c.vx, c.vz);
    let d = want - c.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const maxTurn = MOVE.turnRate * dt;
    c.heading += Math.max(-maxTurn, Math.min(maxTurn, d));
  }

  c.progress = Math.max(c.progress, FIELD.startZ - c.z);
}

/**
 * Keep a body where it may be: on the Red Light, Green Light field, its
 * corridor and the pens' walls; in an open world, its Space (walls, floors,
 * stairs, ledges, water, the edge of the world).
 */
function bound(c: Contestant, course: Course, space: Space | null): void {
  if (space) {
    space.resolve(c, MOVE.radius);
    return;
  }
  clampToField(c, course);
  if (course.walls.length) collideWalls(c, course.walls, MOVE.radius);
}

export function clampToField(c: Contestant, course: Course = DEFAULT_COURSE): void {
  const lim = course.halfWidth - MOVE.radius;
  if (c.x > lim) { c.x = lim; c.vx = Math.min(0, c.vx); }
  if (c.x < -lim) { c.x = -lim; c.vx = Math.max(0, c.vx); }
  if (c.z > course.backLimitZ) { c.z = course.backLimitZ; c.vz = Math.min(0, c.vz); }
  if (c.z < course.safeZ - 2) { c.z = course.safeZ - 2; c.vz = Math.max(0, c.vz); }
}
