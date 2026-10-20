// Ball Haunting's balls and baskets (SPEC-V2 §2.1, §2.3). Pure data and
// helpers for the referee (rules.ts) — the server runs them too.
//
//   A ball is free (on the ground), held (it moves with its holder) or banked
//   (in a basket past the safe line, out of play for good).
//   Knocked loose by an attack, a ball lands a little beyond its holder, and
//   the attacker may not take it for BALLS.attackerWait seconds.

import { BALLS, type Course } from "../config";
import type { Rng } from "../core/rng";
import { PEN, inPenArea } from "./pens";

export interface Ball {
  readonly index: number;
  x: number;
  z: number;
  /** Contestant index holding it, or −1. */
  holder: number;
  /** Basket it was banked in, or −1 (in play). */
  basket: number;
  /** This contestant may not grab it until `waitUntil` (seconds of play). */
  noGrab: number;
  waitUntil: number;
}

export interface Basket {
  readonly x: number;
  readonly z: number;
  /** Balls in it. */
  count: number;
}

/**
 * Scatter `n` balls: some inside the pens (one a pen, somewhere in it), the
 * rest across the whole width of the field, never in a pen's walls and never
 * too close together.
 */
export function placeBalls(course: Course, n: number, rng: Rng): Ball[] {
  const out: Ball[] = [];
  const pens = rng.shuffle(course.pens.slice());
  const penned = n >= 2 ? Math.min(pens.length, Math.floor(n * BALLS.inPens)) : 0;
  const lim = course.halfWidth - 1.5;
  const z0 = course.finishZ * BALLS.from;
  const z1 = course.finishZ * BALLS.to;
  const inner = PEN.size / 2 - 0.6;
  for (let i = 0; i < n; i++) {
    let x = 0;
    let z = 0;
    if (i < penned) {
      const p = pens[i];
      x = p.x + rng.range(-inner, inner);
      z = p.z + rng.range(-inner, inner);
    } else {
      for (let tries = 0; tries < 40; tries++) {
        x = rng.range(-lim, lim);
        z = rng.range(z1, z0);
        if (!inPenArea(course.pens, x, z, 0.8) && out.every((b) => Math.hypot(b.x - x, b.z - z) > 3)) break;
      }
    }
    out.push({ index: i, x, z, holder: -1, basket: -1, noGrab: -1, waitUntil: 0 });
  }
  return out;
}

/** Baskets in a row just past the safe line. */
export function placeBaskets(course: Course): Basket[] {
  const n: number = BALLS.baskets;
  const span = Math.min(course.halfWidth - 1.5, 7);
  return Array.from({ length: n }, (_, i) => ({ x: n === 1 ? 0 : -span + (2 * span * i) / (n - 1), z: course.finishZ - BALLS.basketBeyond, count: 0 }));
}

/** The basket nearest to x. */
export function nearestBasket(baskets: Basket[], x: number): number {
  let best = 0;
  for (let i = 1; i < baskets.length; i++) if (Math.abs(baskets[i].x - x) < Math.abs(baskets[best].x - x)) best = i;
  return best;
}

/** In play: on the ground or in someone's hands. */
export function inPlay(b: Ball): boolean {
  return b.basket < 0;
}

/** Wire form, per ball: x, z (cm), and h = holder + 1, or −(basket + 1) once banked, or 0 if free. */
export function ballState(b: Ball): number {
  return b.basket >= 0 ? -(b.basket + 1) : b.holder + 1;
}
