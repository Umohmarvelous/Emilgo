// Ball Haunting's balls and baskets (SPEC-V3 §1.1, Phase 11), on the match
// core beside the doll (doll.ts): fewer balls than players, grabbed by a tap,
// knocked loose by a swing, and banked in the nearest basket over the line
// (safe for good). The pieces themselves (where the balls start, the baskets)
// are game/balls.ts; the pens' walls, game/pens.ts.

import { BALLS, ballCount } from "../../config";
import { inPlay, nearestBasket, placeBalls, placeBaskets, type Ball, type Basket } from "../balls";
import type { Contestant } from "../core/body";
import type { Match } from "../core/match";
import type { RuleModule } from "../core/module";
import { clearOfWalls } from "../pens";
import { courseOf } from "./doll";

export class BallsModule implements RuleModule {
  readonly id = "balls" as const;
  balls: Ball[] = [];
  baskets: Basket[] = [];

  constructor(_cfg: Record<string, unknown>) {}

  /** The balls come from their own stream, so the spawns are the same whatever the mode. */
  init(m: Match): void {
    const course = courseOf(m);
    this.balls = placeBalls(course, ballCount(m.contestants.length), m.rng("balls"));
    this.baskets = placeBaskets(course);
  }

  /** Grabs, before anyone moves: on your feet, standing or crouched, hands empty. */
  pre(m: Match): void {
    for (const c of m.contestants) {
      if (c.inGrab === c.grabSeen) continue;
      c.grabSeen = c.inGrab;
      if (c.status === "alive" && c.ball < 0 && c.stun <= 0 && c.y <= 0 && c.stance !== 2) this.grab(m, c);
    }
  }

  anyInPlay(): boolean {
    return this.balls.some(inPlay);
  }

  /** Held balls go where their holders go. */
  carry(m: Match): void {
    for (const b of this.balls) {
      if (b.holder < 0 || b.basket >= 0) continue;
      const h = m.contestants[b.holder];
      b.x = h.x;
      b.z = h.z;
    }
  }

  /** A ball in the hands of the fallen rolls free where they fall. */
  release(m: Match, c: Contestant): void {
    if (c.ball >= 0) this.loose(m, c, 0, 0, -1);
  }

  /** Knock `c`'s ball loose, a little along (dx, dz). `by` may not take it for a while. */
  loose(m: Match, c: Contestant, dx: number, dz: number, by: number): number {
    const course = courseOf(m);
    const b = this.balls[c.ball];
    c.ball = -1;
    b.holder = -1;
    const lim = course.halfWidth - 0.5;
    b.x = Math.max(-lim, Math.min(lim, c.x + dx * 0.9));
    b.z = Math.max(course.finishZ + 0.5, Math.min(course.backLimitZ, c.z + dz * 0.9));
    // Never inside a pen's wall, where nobody could reach it.
    if (course.walls.length) clearOfWalls(b, course.walls, 0.3);
    b.noGrab = by;
    b.waitUntil = by >= 0 ? m.elapsed + BALLS.attackerWait : 0;
    m.emit({ type: "ball", ball: b.index, x: b.x, z: b.z });
    return b.index;
  }

  /** Across the line with a ball: it goes in the nearest basket, out of play for good. */
  bank(m: Match, c: Contestant): void {
    const b = this.balls[c.ball];
    const k = nearestBasket(this.baskets, c.x);
    const basket = this.baskets[k];
    b.basket = k;
    b.holder = -1;
    b.x = basket.x + ((basket.count % 3) - 1) * 0.12;
    b.z = basket.z + (Math.floor(basket.count / 3) % 2) * 0.12;
    basket.count++;
    c.ball = -1;
    m.emit({ type: "bank", id: c.id, ball: b.index, basket: k });
  }

  private grab(m: Match, c: Contestant): void {
    let best: Ball | null = null;
    let bestD: number = BALLS.reach;
    for (const b of this.balls) {
      if (b.holder >= 0 || b.basket >= 0) continue;
      if (b.noGrab === c.index && m.elapsed < b.waitUntil) continue;
      const d = Math.hypot(b.x - c.x, b.z - c.z);
      if (d <= bestD) {
        bestD = d;
        best = b;
      }
    }
    if (!best) return;
    best.holder = c.index;
    best.noGrab = -1;
    c.ball = best.index;
    c.act = BALLS.grabTime * c.bst.grab;
    c.actKind = "grab";
    m.emit({ type: "grab", id: c.id, ball: best.index });
  }
}
