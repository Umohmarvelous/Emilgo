// Fist, slap, push — and the sprint shove (SPEC-V2 §2.4, §4.4). Pure helpers
// for the referee; the client uses `knock` too, to predict its own slide.
//
//   An attack lands on the nearest player in play within ATTACK.range. It
//   knocks them back, stuns them (they can't steer) and knocks loose any ball
//   they hold. The slide is the hit's fault, not theirs: the doll forgives it.
//   The swing is the attacker's own movement: while she watches, the attacker
//   is shot (the owner's rule, 17 Oct 2026).

import { ATTACK, MOVE, type AttackKind } from "../config";
import type { Contestant } from "./rules";

/** Slide `dist` metres along (dx, dz) — unit vector — stunned for at least `stun`. */
export function knock(t: Contestant, dx: number, dz: number, dist: number, stun: number): void {
  const v0 = Math.sqrt(2 * MOVE.decel * dist);
  t.vx = dx * v0;
  t.vz = dz * v0;
  t.sprinting = false;
  t.stun = Math.max(t.stun, stun, v0 / MOVE.decel);
  t.forgive = Math.max(t.forgive, t.stun + ATTACK.forgive);
}

/** Who an attack from `c` would land on: the nearest player still in play within reach, or null. */
export function attackTarget(c: Contestant, list: readonly Contestant[], reach: number = ATTACK.range): Contestant | null {
  let best: Contestant | null = null;
  let bestD = reach;
  for (const o of list) {
    if (o === c || o.status !== "alive") continue;
    const d = Math.hypot(o.x - c.x, o.z - c.z);
    if (d <= bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

/** Can `c` attack right now (ignoring range)? */
export function canAttack(c: Contestant): boolean {
  return c.status === "alive" && c.stun <= 0 && c.cool <= 0 && c.y <= 0 && c.stance !== 2;
}

/** Wire code for what someone is doing: 0 nothing, 1 fist, 2 slap, 3 push, 4 grab. */
export const ACT_CODES = ["", "fist", "slap", "push", "grab"] as const;
export type ActKind = AttackKind | "grab" | "";
export function actCode(k: ActKind): number {
  return Math.max(0, ACT_CODES.indexOf(k));
}
