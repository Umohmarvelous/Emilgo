// The zone (SPEC-V3 §7, §9; v5): a safe circle that closes in phase by phase.
// In the open world you may stay outside for ZONE.grace seconds (the meter
// fills over that time); then, COD-style (v6), the gas takes health every
// second, more each circle, and at 0 you're out (a mode without health: the
// sky laser after ZONE.bleed). Back inside, the meter empties. A mode on part of a world (the
// Flag Duel's market) keeps a hard edge: the meter fills by the phase's rate
// and the laser comes as soon as it's full.
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
import type { Contestant } from "../core/body";
import type { Match } from "../core/match";
import type { MatchEvent, RuleModule } from "../core/module";
import type { GunsModule } from "./guns";
import type { TreasureModule } from "./treasure";
import type { VehiclesModule } from "./vehicles";

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
  /** Seconds since the grace ran out, for the slow loss. */
  private over = new Float64Array(0);
  private tickAt = new Float64Array(0);
  /** A mode played on part of a world (the Flag Duel's market): its first circle. */
  private arena: Circle | null = null;

  constructor(params: Record<string, unknown>) {
    const scale = typeof params.scale === "number" ? params.scale : 1;
    const list = Array.isArray(params.phases) ? (params.phases as number[][]) : [];
    this.phases = list.map(([start, r, over, rate]) => ({ start, r: r * scale, over, rate })).sort((a, b) => a.start - b.start);
  }

  init(m: Match): void {
    const n = m.contestants.length;
    this.exposure = new Float64Array(n);
    this.doom = new Float64Array(n).fill(-1);
    this.over = new Float64Array(n);
    this.tickAt = new Float64Array(n);
    const b = m.world.space.bounds;
    const half = Math.max(b.x1 - b.x0, b.z1 - b.z0) / 2;
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    const ar = m.world.arena;
    this.arena = ar ? { x: ar.x, z: ar.z, r: ar.r } : null;
    this.circles.push(this.arena ?? { x: cx, z: cz, r: half * Math.SQRT2 + 1 });
    // The circles to come are hidden (the secret stream); the copy learns each when it's announced.
    if (m.mirror) {
      for (let k = 0; k < this.phases.length; k++) this.circles.push({ ...this.circles[0], r: this.phases[k].r });
      Object.assign(this.now, this.circles[0]);
      return;
    }
    const rng = m.secretRng("zone");
    const reach = m.reach;
    // Treasure Hunt: every circle keeps the upload machine well inside, or the last one could shut it out.
    const hunt = m.module<TreasureModule>("treasure");
    const anchor = hunt?.spot(m) ?? null;
    // v7: an instant hunt's centre stays nearer each circle's middle (0.3 of its radius; v5: 0.6), so its boxes are in.
    const slack = hunt?.anchorSlack ?? 0.6;
    for (const p of this.phases) {
      const prev = this.circles[this.circles.length - 1];
      const room = Math.max(0, prev.r - p.r);
      // Mostly inside the world: a circle hanging off the edge would be a smaller one.
      const lim = half - Math.min(p.r * 0.35, half * 0.5);
      let best: Circle = { x: prev.x, z: prev.z, r: p.r };
      if (anchor) {
        const d0 = Math.hypot(anchor.x - prev.x, anchor.z - prev.z);
        const go = d0 > 0 ? Math.min(1, room / d0) : 0;
        best = { x: prev.x + (anchor.x - prev.x) * go, z: prev.z + (anchor.z - prev.z) * go, r: p.r };
      }
      for (let t = 0; t < 60; t++) {
        const a = rng.range(0, Math.PI * 2);
        const d = Math.sqrt(rng.next()) * room;
        const x = prev.x + Math.cos(a) * d;
        const z = prev.z + Math.sin(a) * d;
        if (Math.abs(x - cx) > lim || Math.abs(z - cz) > lim || !reach.at(x, z)) continue;
        if (anchor && Math.hypot(x - anchor.x, z - anchor.z) > p.r * slack) continue;
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

    const cars = m.module<VehiclesModule>("vehicles");
    for (const c of m.contestants) {
      const i = c.index;
      if (c.status !== "alive") continue;
      // Driving fast, the sky can't see you: nothing builds, and a laser already coming misses.
      const hidden = !!cars && cars.hidden(m, c);
      if (this.doom[i] >= 0) {
        if (t >= this.doom[i]) {
          this.doom[i] = -1;
          if (hidden) m.emit({ type: "dodge", id: c.id });
          else m.eliminate(c, "zone");
        }
        continue;
      }
      if (hidden) continue;
      const dx = c.x - this.now.x;
      const dz = c.z - this.now.z;
      const out = dx * dx + dz * dz > this.now.r * this.now.r;
      const shield = m.effect(c, "shield") > 0;
      if (this.arena) {
        // A hard edge.
        if (out) {
          // A Zone Shield: the sky can't see you (no exposure), but it doesn't heal you either.
          if (!shield) this.exposure[i] = Math.min(1, this.exposure[i] + this.rate * ZONE.fill * dt);
        } else this.exposure[i] = Math.max(0, this.exposure[i] - ZONE.drain * dt);
        if (this.exposure[i] >= 1) this.callLaser(m, c, t);
        continue;
      }
      if (!out) {
        this.exposure[i] = Math.max(0, this.exposure[i] - (ZONE.forget / ZONE.grace) * dt);
        this.over[i] = 0;
        continue;
      }
      if (shield) continue;
      if (this.exposure[i] < 1) {
        this.exposure[i] = Math.min(1, this.exposure[i] + dt / ZONE.grace);
        continue;
      }
      // The grace is gone: slowly, then the laser.
      this.over[i] += dt;
      const guns = m.module<GunsModule>("guns");
      // No health to lose (a mode without guns), or seated (a bullet can't reach you, nor can this): the laser after a while.
      if (!guns || m.seated(c)) {
        if (this.over[i] >= ZONE.bleed) this.callLaser(m, c, t);
        continue;
      }
      if (t < this.tickAt[i]) continue;
      this.tickAt[i] = t + ZONE.every;
      // v6, COD-style: the gas bites harder each circle, through armour; at 0 health you're out at once.
      guns.hurt(m, c, this.dps(t) * ZONE.every, null, false, "zone", true);
    }
  }

  /** v6: the gas's health a second now: by how many circles have closed. */
  dps(t: number): number {
    let k = 0;
    while (k < this.phases.length && t >= this.phases[k].start + this.phases[k].over) k++;
    return ZONE.dps[Math.min(k, ZONE.dps.length - 1)];
  }

  private callLaser(m: Match, c: Contestant, t: number): void {
    this.doom[c.index] = t + ZONE.laser;
    m.emit({ type: "laser", id: c.id, hitAt: this.doom[c.index] });
  }

  /** Is this the open world's slow zone (not a hard edge)? */
  get slow(): boolean {
    return !this.arena;
  }

  onEvent(m: Match, e: MatchEvent): void {
    if (e.type === "respawn" || e.type === "eliminated") {
      const c = m.get(e.id);
      if (!c) return;
      this.doom[c.index] = -1;
      this.over[c.index] = 0;
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
      // On part of a world, its edge is the zone's from the start, at the first phase's rate.
      this.rate = this.arena ? (this.phases[0]?.rate ?? 1) : 0;
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

  // ── The online client's copy ──

  view(m: Match): void {
    this.at(m.elapsed, this.now);
  }

  apply(m: Match, e: MatchEvent): void {
    if (e.type === "zone") {
      this.shown = Math.max(this.shown, e.phase + 1);
      this.circles[e.phase + 1] = { x: e.x, z: e.z, r: e.r };
      // Until it's announced a phase's circle stands in as the one before (never drawn as news).
      for (let k = e.phase + 2; k < this.circles.length; k++) if (k > this.shown) this.circles[k] = { ...this.circles[e.phase + 1], r: this.phases[k - 1].r };
    }
    else if (e.type === "laser") {
      const c = m.get(e.id);
      if (c) this.doom[c.index] = e.hitAt;
    } else if (e.type === "eliminated" || e.type === "respawn") {
      const c = m.get(e.id);
      if (!c) return;
      this.doom[c.index] = -1;
      if (e.type === "respawn") this.exposure[c.index] = 0;
    }
  }

  /** The online client: a body's meter from a snapshot. */
  setExposure(i: number, v: number): void {
    this.exposure[i] = v;
  }
}
