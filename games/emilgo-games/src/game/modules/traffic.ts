// The danfo traffic hazard (SPEC-V3 §10.14; Phase 6), in Free For All on the
// whole city where there are cars. An empty bus, nobody driving, sweeps the
// longest road end to end on a schedule (a horn first), and shoves anyone in
// its way aside with a wobble, the way a car does. Never hurts.
//
// Pure and seeded: the schedule is the public seed's, so a phone's copy knows
// where the bus is without being told. Only who it shoved comes from the
// server (a "danfo" event), like a car's bump.

import { MOVE, TRAFFIC } from "../../config";
import { knock } from "../combat";
import type { Match } from "../core/match";
import type { RuleModule } from "../core/module";
import type { MeleeModule } from "./melee";

export interface Run {
  /** When it sets off and arrives (seconds of play). */
  at: number;
  until: number;
  /** Which end it starts from: false x0,z0 → x1,z1; true the other way. */
  back: boolean;
}

export interface BusAt {
  x: number;
  z: number;
  h: number;
  /** Its heading (rad, 0 = +z). */
  hd: number;
}

export class TrafficModule implements RuleModule {
  readonly id = "traffic" as const;
  readonly runs: Run[] = [];
  /** The road it sweeps, offset to the left-hand lane of each run. */
  road: { x0: number; z0: number; x1: number; z1: number; w: number } | null = null;
  private len = 0;
  private hit = new Float64Array(0);

  init(m: Match): void {
    const roads = m.world.roads ?? [];
    if (m.world.arena || !roads.length) return;
    let best = roads[0];
    for (const r of roads) if (Math.hypot(r.x1 - r.x0, r.z1 - r.z0) > Math.hypot(best.x1 - best.x0, best.z1 - best.z0)) best = r;
    this.road = best;
    this.len = Math.hypot(best.x1 - best.x0, best.z1 - best.z0);
    this.hit = new Float64Array(m.contestants.length).fill(-99);
    const rng = m.rng("traffic");
    const take = this.len / TRAFFIC.speed;
    for (let k = 0; ; k++) {
      const at = TRAFFIC.first + k * TRAFFIC.every + rng.range(0, TRAFFIC.jitter);
      if (at + take > m.settings.time - 5) break;
      this.runs.push({ at, until: at + take, back: k % 2 === 1 });
    }
  }

  /** The run under way now, if any. */
  now(m: Match): Run | null {
    const t = m.elapsed;
    for (const r of this.runs) if (t >= r.at && t < r.until) return r;
    return null;
  }

  /** Seconds until the next run sets off (its horn comes TRAFFIC.horn before), or −1. */
  next(m: Match): number {
    for (const r of this.runs) if (r.at > m.elapsed) return r.at - m.elapsed;
    return -1;
  }

  /** Where the bus is now, or null (not running). */
  bus(m: Match): BusAt | null {
    const r = this.now(m);
    const o = this.road;
    if (!r || !o) return null;
    const f = (m.elapsed - r.at) / (r.until - r.at);
    const ux = (o.x1 - o.x0) / this.len;
    const uz = (o.z1 - o.z0) / this.len;
    const [sx, sz, dx, dz] = r.back ? [o.x1, o.z1, -ux, -uz] : [o.x0, o.z0, ux, uz];
    // Drive on the right: a quarter of the road's width to the right of the middle.
    const lane = o.w * 0.25;
    const x = sx + dx * this.len * f + dz * lane;
    const z = sz + dz * this.len * f - dx * lane;
    return { x, z, h: m.world.space.floorAt(x, z, 0).h, hd: Math.atan2(dx, dz) };
  }

  step(m: Match): void {
    const b = this.bus(m);
    if (!b) return;
    const s = Math.sin(b.hd);
    const co = Math.cos(b.hd);
    const ex = TRAFFIC.wid / 2 + MOVE.radius;
    const ez = TRAFFIC.len / 2 + MOVE.radius;
    const melee = m.module<MeleeModule>("melee");
    for (const c of m.contestants) {
      if (c.status !== "alive" || m.seated(c) || Math.abs(c.h + c.y - b.h) > 1.6) continue;
      const dx = c.x - b.x;
      const dz = c.z - b.z;
      // In the bus's frame: x to its right, z to its nose.
      const lx = dx * co - dz * s;
      const lz = dx * s + dz * co;
      if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) continue;
      // Out to the side it's nearer, and on along its path a little.
      const sx = lx >= 0 ? 1 : -1;
      c.x += co * sx * (ex - Math.abs(lx));
      c.z -= s * sx * (ex - Math.abs(lx));
      m.world.space.resolve(c, MOVE.radius);
      if (m.elapsed - this.hit[c.index] < TRAFFIC.again) continue;
      this.hit[c.index] = m.elapsed;
      let bx = co * sx + s * 0.6;
      let bz = -s * sx + co * 0.6;
      const bl = Math.hypot(bx, bz);
      bx /= bl;
      bz /= bl;
      if (melee) melee.shove(m, c, bx, bz, TRAFFIC.knock, TRAFFIC.stun, TRAFFIC.wobble);
      else knock(c, bx, bz, TRAFFIC.knock, TRAFFIC.stun);
      m.emit({ type: "danfo", tg: c.id, kx: c.vx, kz: c.vz, w: melee ? melee.wobble[c.index] : 0 });
    }
  }
}
