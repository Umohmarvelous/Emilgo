// Rooftop zip-lines (SPEC-V3 §10.21; Phase 6), in Free For All on the whole
// city. Two lines (MatchWorld.zips), each from a roof down to the street, one
// way only. Tap interact by the anchor on the roof and you ride down, hands
// on the line, nothing else; you drop off at the bottom with some of the
// speed.
//
// Never a way out of the zone: a line is shut to anyone outside the zone, and
// while its foot is outside the next circle.
//
// The server starts each ride (a "zip" event with when it started); from then
// the ride is the same sum everywhere, so a phone places its own rider exactly.

import { ZIPS } from "../../config";
import type { Contestant } from "../core/body";
import type { Match, Zip } from "../core/match";
import type { MatchEvent, RuleModule } from "../core/module";
import type { ZoneModule } from "./zone";

export class ZipsModule implements RuleModule {
  readonly id = "zips" as const;
  /** Per body: the line they're on (−1: none), since when (seconds of play). */
  ride: Int8Array = new Int8Array(0);
  rideAt: Float64Array = new Float64Array(0);

  init(m: Match): void {
    this.ride = new Int8Array(m.contestants.length).fill(-1);
    this.rideAt = new Float64Array(m.contestants.length);
  }

  /** Open to c: c is inside the zone and the line's foot is inside the next circle. */
  open(m: Match, c: Contestant, z: Zip): boolean {
    const zone = m.module<ZoneModule>("zone");
    if (!zone) return true;
    const safe = zone.safe();
    return zone.inside(c.x, c.z) && Math.hypot(z.x1 - safe.x, z.z1 - safe.z) <= safe.r;
  }

  /** Riding: the line, or null. */
  riding(m: Match, c: Contestant): Zip | null {
    const k = this.ride[c.index] ?? -1;
    return k >= 0 ? (m.world.zips?.[k] ?? null) : null;
  }

  reachFor(m: Match, c: Contestant): { d: number; take: () => void } | null {
    const zips = m.world.zips ?? [];
    if (this.ride[c.index] >= 0 || c.status !== "alive" || c.y > 0.05) return null;
    let best: { d: number; take: () => void } | null = null;
    zips.forEach((z, k) => {
      const d = Math.hypot(c.x - z.x0, c.z - z.z0);
      if (d > ZIPS.reach || Math.abs(c.h - z.roof) > 0.6 || !this.open(m, c, z)) return;
      if (!best || d < best.d) best = { d, take: () => this.start(m, c, k) };
    });
    return best;
  }

  private start(m: Match, c: Contestant, k: number): void {
    this.ride[c.index] = k;
    this.rideAt[c.index] = m.elapsed;
    m.emit({ type: "zip", id: c.id, zip: k, how: "on", at: m.elapsed });
  }

  /** Where the rider is on their line now; true when they've reached the bottom (and dropped off). */
  place(m: Match, c: Contestant): boolean {
    const k = this.ride[c.index];
    const z = m.world.zips?.[k];
    if (!z) return true;
    const len = Math.hypot(z.x1 - z.x0, z.z1 - z.z0);
    const u = Math.min(1, ((m.elapsed - this.rideAt[c.index]) * ZIPS.speed) / len);
    const dx = (z.x1 - z.x0) / len;
    const dz = (z.z1 - z.z0) / len;
    c.x = z.x0 + (z.x1 - z.x0) * u;
    c.z = z.z0 + (z.z1 - z.z0) * u;
    c.h = z.h0 + (z.h1 - z.h0) * u - ZIPS.hang;
    c.y = c.vy = 0;
    c.heading = Math.atan2(dx, dz);
    c.inX = c.inZ = 0;
    if (u < 1) {
      c.vx = dx * ZIPS.speed;
      c.vz = dz * ZIPS.speed;
      return false;
    }
    // Off at the bottom, running on.
    c.h = m.world.space.floorAt(c.x, c.z, c.h + 0.3).h;
    c.vx = dx * ZIPS.speed * 0.4;
    c.vz = dz * ZIPS.speed * 0.4;
    return true;
  }

  step(m: Match): void {
    for (const c of m.contestants) {
      const k = this.ride[c.index];
      if (k < 0) continue;
      if (c.status !== "alive") {
        this.ride[c.index] = -1;
        continue;
      }
      if (this.place(m, c)) {
        this.ride[c.index] = -1;
        m.emit({ type: "zip", id: c.id, zip: k, how: "off", at: m.elapsed });
      }
    }
  }

  // ── The online client's copy ──

  apply(m: Match, e: MatchEvent): void {
    if (e.type === "zip") {
      const c = m.get(e.id);
      if (!c) return;
      this.ride[c.index] = e.how === "on" ? e.zip : -1;
      this.rideAt[c.index] = e.at;
    } else if (e.type === "eliminated") {
      const c = m.get(e.id);
      if (c) this.ride[c.index] = -1;
    }
  }
}
