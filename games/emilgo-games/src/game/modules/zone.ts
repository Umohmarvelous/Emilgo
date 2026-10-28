// The zone (SPEC-V3 §7, §9): a safe circle that closes in phase by phase.
// Outside it your exposure meter fills, faster each phase; full, the sky laser
// comes down on you. Back inside, the meter drains.
//
// A mode's phases are [start s, radius m, close over s, rate]. Each circle
// lies inside the one before, its centre on ground you can walk to, all from
// the match's "zone" stream. The next circle is announced ZONE.warn seconds
// before it starts closing. Ranked's `zone.scale` shrinks every circle.
//
// Once the meter is full the laser is certain: it takes ZONE.laser seconds to
// come down (everyone sees it coming, it follows you), then hits. The meter
// itself is the warning you can act on.

import { ZONE } from "../../config";
import { ITEM_DEFS } from "../../content/items";
import type { Match } from "../core/match";
import type { MatchEvent, RuleModule } from "../core/module";

export interface Circle {
  x: number;
  z: number;
  r: number;
}

interface ZonePhase {
  start: number;
  r: number;
  over: number;
  rate: number;
}

export class ZoneModule implements RuleModule {
  readonly id = "zone" as const;
  readonly phases: readonly ZonePhase[];
  /** circles[0] is the whole world; circles[k + 1] is phase k's circle. */
  readonly circles: Circle[] = [];
  /** The circle now: it moves and shrinks while a phase closes. */
  readonly now: Circle = { x: 0, z: 0, r: 1e9 };
  /** The exposure rate now (before ZONE.fill). */
  rate = 0;
  /** Phases announced so far. */
  shown = 0;
  private exposure = new Float64Array(0);
  private doom = new Float64Array(0);

  constructor(params: Record<string, unknown>) {
    const scale = typeof params.scale === "number" ? params.scale : 1;
    const list = Array.isArray(params.phases) ? (params.phases as number[][]) : [];
    this.phases = list.map(([start, r, over, rate]) => ({ start, r: r * scale, over, rate })).sort((a, b) => a.start - b.start);
  }

  init(m: Match): void {
    const n = m.contestants.length;
    this.exposure = new Float64Array(n);
    this.doom = new Float64Array(n).fill(-1);
    const b = m.world.space.bounds;
    const half = Math.max(b.x1 - b.x0, b.z1 - b.z0) / 2;
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    this.circles.push({ x: cx, z: cz, r: half * Math.SQRT2 + 1 });
    const rng = m.rng("zone");
    const reach = m.reach;
    for (const p of this.phases) {
      const prev = this.circles[this.circles.length - 1];
      const room = Math.max(0, prev.r - p.r);
      // Mostly inside the world: a circle hanging off the edge would be a smaller one.
      const lim = half - Math.min(p.r * 0.35, half * 0.5);
      let best: Circle = { x: prev.x, z: prev.z, r: p.r };
      for (let t = 0; t < 60; t++) {
        const a = rng.range(0, Math.PI * 2);
        const d = Math.sqrt(rng.next()) * room;
        const x = prev.x + Math.cos(a) * d;
        const z = prev.z + Math.sin(a) * d;
        if (Math.abs(x - cx) > lim || Math.abs(z - cz) > lim || !reach.at(x, z)) continue;
        best = { x, z, r: p.r };
        break;
      }
      this.circles.push(best);
    }
    Object.assign(this.now, this.circles[0]);
  }

  step(m: Match, dt: number): void {
    const t = m.elapsed;
    // The next circle, ZONE.warn seconds before it closes.
    while (this.shown < this.phases.length && t >= this.phases[this.shown].start - ZONE.warn) {
      const p = this.phases[this.shown];
      const c = this.circles[this.shown + 1];
      m.emit({ type: "zone", phase: this.shown, x: c.x, z: c.z, r: c.r, at: p.start, over: p.over });
      this.shown++;
    }
    this.at(t, this.now);

    for (const c of m.contestants) {
      const i = c.index;
      if (c.status !== "alive") continue;
      if (this.doom[i] >= 0) {
        if (t >= this.doom[i]) {
          this.doom[i] = -1;
          m.eliminate(c, "zone");
        }
        continue;
      }
      const dx = c.x - this.now.x;
      const dz = c.z - this.now.z;
      const out = dx * dx + dz * dz > this.now.r * this.now.r;
      if (out) {
        // A Zone Shield: the sky can't see you (no exposure), but it doesn't heal you either.
        if (m.effect(c, "shield") <= 0) this.exposure[i] = Math.min(1, this.exposure[i] + this.rate * ZONE.fill * dt);
      } else this.exposure[i] = Math.max(0, this.exposure[i] - ZONE.drain * dt);
      if (this.exposure[i] >= 1) {
        this.doom[i] = t + ZONE.laser;
        m.emit({ type: "laser", id: c.id, hitAt: this.doom[i] });
      }
    }
  }

  onEvent(m: Match, e: MatchEvent): void {
    if (e.type === "respawn" || e.type === "eliminated") {
      const c = m.get(e.id);
      if (!c) return;
      this.doom[c.index] = -1;
      if (e.type === "respawn") this.exposure[c.index] = 0;
    } else if (e.type === "use") {
      const fx = ITEM_DEFS[e.kind].effect;
      const c = m.get(e.id);
      if (c && fx?.kind === "exposure") this.exposure[c.index] = Math.max(0, this.exposure[c.index] - fx.take);
    }
  }

  /** The circle at `t` seconds of play (and the exposure rate then). */
  at(t: number, out: Circle): Circle {
    let k = -1;
    for (let i = 0; i < this.phases.length; i++) if (t >= this.phases[i].start) k = i;
    if (k < 0) {
      this.rate = 0;
      return Object.assign(out, this.circles[0]);
    }
    const p = this.phases[k];
    const a = this.circles[k];
    const b = this.circles[k + 1];
    const u = Math.min(1, (t - p.start) / Math.max(1e-6, p.over));
    this.rate = p.rate;
    out.x = a.x + (b.x - a.x) * u;
    out.z = a.z + (b.z - a.z) * u;
    out.r = a.r + (b.r - a.r) * u;
    return out;
  }

  /** Where it's going to be safe: the latest circle announced (or the whole world before any). */
  safe(): Circle {
    return this.circles[this.shown] ?? this.circles[0];
  }

  /** The next circle once it's announced and not yet closed, with when it closes; else null. */
  next(t: number): { c: Circle; at: number; over: number } | null {
    for (let k = 0; k < this.shown; k++) {
      const p = this.phases[k];
      if (t < p.start + p.over) return { c: this.circles[k + 1], at: p.start, over: p.over };
    }
    return null;
  }

  inside(x: number, z: number): boolean {
    return Math.hypot(x - this.now.x, z - this.now.z) <= this.now.r;
  }

  /** 0 … 1: how full c's exposure meter is. */
  exposureOf(i: number): number {
    return this.exposure[i] ?? 0;
  }

  /** The laser is coming down on body i. */
  doomed(i: number): boolean {
    return (this.doom[i] ?? -1) >= 0;
  }
}
