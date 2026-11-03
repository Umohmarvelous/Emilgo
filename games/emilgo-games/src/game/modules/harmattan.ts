// The Harmattan sandstorm (SPEC-V3 §10.4; Phase 6), in Free For All on the
// whole city (not on part of it: not the staked duel, not Compound Wars).
// A siren 3 s before; then for its length you see 25 m, the wind pushes
// everyone on foot downwind, footprints are wiped, car headlights come on.
//
// Pure and seeded: when the storms come and which way the wind blows are the
// public seed's, so a phone's copy knows without being told, and its own
// predicted body drifts exactly as the server's does.

import { HARMATTAN, MOVE } from "../../config";
import type { Contestant } from "../core/body";
import type { Match } from "../core/match";
import type { RuleModule } from "../core/module";

export interface Storm {
  at: number;
  until: number;
  /** The wind's direction (unit), x and z. */
  wx: number;
  wz: number;
}

export class HarmattanModule implements RuleModule {
  readonly id = "harmattan" as const;
  readonly storms: Storm[] = [];

  init(m: Match): void {
    if (m.world.arena) return;
    const time = m.settings.time;
    const span = time - 2 * HARMATTAN.margin - HARMATTAN.long;
    if (span <= 0) return;
    const rng = m.rng("harmattan");
    const n = time >= 420 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      // Each in its own share of the match, so two never overlap.
      const share = span / n;
      const at = HARMATTAN.margin + share * k + rng.range(0, Math.max(0, share - HARMATTAN.long));
      const a = rng.range(0, Math.PI * 2);
      this.storms.push({ at, until: at + HARMATTAN.long, wx: Math.cos(a), wz: Math.sin(a) });
    }
  }

  /** The storm blowing now, if any. */
  now(m: Match): Storm | null {
    const t = m.elapsed;
    for (const s of this.storms) if (t >= s.at && t < s.until) return s;
    return null;
  }

  /** Seconds until the next storm (its siren comes HARMATTAN.siren before), or −1. */
  next(m: Match): number {
    const t = m.elapsed;
    for (const s of this.storms) if (s.at > t) return s.at - t;
    return -1;
  }

  /** The wind on a body on foot this step (the server's and the phone's prediction alike). */
  drift(m: Match, c: Contestant, dt: number): void {
    if (HARMATTAN.wind <= 0) return;
    const s = this.now(m);
    if (!s || c.status !== "alive" || m.seated(c)) return;
    c.x += s.wx * HARMATTAN.wind * dt;
    c.z += s.wz * HARMATTAN.wind * dt;
    m.world.space.resolve(c, MOVE.radius);
  }

  step(m: Match, dt: number): void {
    if (!this.now(m)) return;
    for (const c of m.contestants) this.drift(m, c, dt);
  }
}
