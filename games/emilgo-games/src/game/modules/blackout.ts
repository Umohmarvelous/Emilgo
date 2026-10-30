// Lights Out (SPEC-V3 §9 #10; Phase 6): hide-and-seek where everyone is
// hunter and hunted. Everyone carries a small lamp that always shows. Keep a
// rival in your lamp's light (in front of you, in sight) for `findHold`
// seconds and they're found: out. Power cuts every 60–90 s dim the city;
// then crouching hides your glow (only half the reach finds you), and the
// street generators start up: they light whoever is near them, and shock
// whoever touches one. A smoke cloud hides you. Last one not found wins.
//
// Pure: when the power goes is seeded (the copy knows it too); finding is
// judged by the server and sent as eliminations.

import { BLACKOUT } from "../../config";
import type { Contestant } from "../core/body";
import type { Match } from "../core/match";
import type { MatchEvent, RuleModule } from "../core/module";
import type { GadgetsModule } from "./gadgets";
import type { MeleeModule } from "./melee";

/** A lamp's eye: held at chest height. */
const EYE = 1.3;

export class BlackoutModule implements RuleModule {
  readonly id = "blackout" as const;
  readonly every: [number, number];
  readonly dim: number;
  readonly findHold: number;
  /** The power cuts: [from, to] seconds of play. */
  readonly cuts: [number, number][] = [];
  /** How long each finder has had each rival in their light (n × n). */
  private held = new Float64Array(0);
  /** Rivals each body has found. */
  found = new Float64Array(0);
  /** Seconds each body stayed unfound. */
  hidden = new Float64Array(0);
  private n = 0;
  private tick = 0;

  constructor(params: Record<string, unknown>) {
    const ev = Array.isArray(params.every) ? (params.every as unknown[]).map(Number) : [60, 90];
    this.every = [Math.max(20, ev[0] ?? 60), Math.max(20, ev[1] ?? ev[0] ?? 90)];
    this.dim = typeof params.dim === "number" ? Math.max(0, Math.min(1, params.dim)) : 0.15;
    this.findHold = typeof params.findHold === "number" ? Math.max(0.5, params.findHold) : 1.5;
  }

  init(m: Match): void {
    this.n = m.contestants.length;
    this.held = new Float64Array(this.n * this.n);
    this.found = new Float64Array(this.n);
    this.hidden = new Float64Array(this.n);
    // The cuts, from the public seed: everyone's lights go at the same moment.
    const rng = m.rng("blackout");
    let t = rng.range(this.every[0], this.every[1]);
    while (t < m.settings.time) {
      this.cuts.push([t, t + BLACKOUT.cut]);
      t += BLACKOUT.cut + rng.range(this.every[0], this.every[1]);
    }
  }

  /** Is the power off now? */
  cut(m: Match): boolean {
    const t = m.elapsed;
    return this.cuts.some(([a, b]) => t >= a && t < b);
  }

  /** The next change: seconds until the power goes (or comes back), and which. */
  next(m: Match): { off: boolean; in: number } | null {
    const t = m.elapsed;
    for (const [a, b] of this.cuts) {
      if (t < a) return { off: true, in: a - t };
      if (t < b) return { off: false, in: b - t };
    }
    return null;
  }

  /** Lit by a running generator (in a cut). */
  private byGenerator(m: Match, c: Contestant): boolean {
    for (const g of m.world.generators ?? []) if (Math.hypot(c.x - g.x, c.z - g.z) <= BLACKOUT.genLight) return true;
    return false;
  }

  /** Could finder a's lamp find b now? */
  sees(m: Match, a: Contestant, b: Contestant, dark = this.cut(m)): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dz);
    let reach: number = dark ? BLACKOUT.cutReach : BLACKOUT.reach;
    if (dark && b.stance > 0 && !this.byGenerator(m, b)) reach *= 0.5;
    if (dark && this.byGenerator(m, b)) reach = BLACKOUT.reach;
    if (d > reach || d < 1e-6 || Math.abs(a.h + a.y - (b.h + b.y)) > 2.5) return false;
    const off = Math.acos(Math.max(-1, Math.min(1, (dx * Math.sin(a.heading) + dz * Math.cos(a.heading)) / d)));
    if (off > BLACKOUT.cone) return false;
    const smoke = m.module<GadgetsModule>("gadgets");
    if (smoke && (smoke.inSmoke(m, b.x, b.z) || smoke.inSmoke(m, (a.x + b.x) / 2, (a.z + b.z) / 2))) return false;
    // The target's chest (lower when crouched or prone) from the finder's lamp.
    const y = Math.min(a.h + a.y + EYE, b.h + b.y + (b.stance === 2 ? 0.3 : b.stance === 1 ? 0.8 : EYE));
    return m.world.space.lineClear(a.x, a.z, b.x, b.z, y);
  }

  step(m: Match, dt: number): void {
    const list = m.contestants;
    for (const c of list) if (c.status === "alive") this.hidden[c.index] += dt;
    const dark = this.cut(m);
    const melee = m.module<MeleeModule>("melee");
    // Running generators in a cut: touching one shocks you.
    if (dark && melee) {
      for (const c of list) {
        if (c.status !== "alive" || melee.isDown(c.index) || c.stun > 0) continue;
        for (const g of m.world.generators ?? []) {
          const d = Math.hypot(c.x - g.x, c.z - g.z);
          if (d > BLACKOUT.genTouch) continue;
          const s = BLACKOUT.shock;
          melee.shove(m, c, d > 1e-6 ? (c.x - g.x) / d : 1, d > 1e-6 ? (c.z - g.z) / d : 0, s.knock, s.stun, s.wobble);
          m.emit({ type: "shock", id: c.id, x: g.x, z: g.z });
          break;
        }
      }
    }
    // Finding: judged a few times a second.
    if (++this.tick % BLACKOUT.every !== 0) return;
    const step = dt * BLACKOUT.every;
    const n = this.n;
    for (const a of list) {
      for (const b of list) {
        if (a === b) continue;
        const k = a.index * n + b.index;
        const live = a.status === "alive" && b.status === "alive" && !melee?.isDown(a.index) && !m.sameSquad(a, b) && this.sees(m, a, b, dark);
        this.held[k] = live ? this.held[k] + step : 0;
        if (!live || this.held[k] < this.findHold) continue;
        this.found[a.index]++;
        m.emit({ type: "found", id: a.id, tg: b.id });
        m.eliminate(b, "found");
        for (let j = 0; j < n; j++) this.held[b.index * n + j] = this.held[j * n + b.index] = 0;
      }
    }
    this.judge(m);
  }

  /** How far a finder's light is on a rival (0 … 1), for the phone's ring. */
  progress(a: number, b: number): number {
    return Math.min(1, (this.held[a * this.n + b] ?? 0) / this.findHold);
  }

  private judge(m: Match): void {
    if (m.winner) return;
    const alive = m.contestants.filter((c) => c.status === "alive");
    const squads = new Set(alive.map((c) => m.squads[c.index]));
    if (squads.size === 1 && alive.length > 0 && m.contestants.length > 1) m.win(alive[0]);
  }

  /** The measure: seconds unfound (finds break ties). */
  objective(_m: Match, i: number): number {
    return Math.round(this.hidden[i]) + this.found[i] * 0.01;
  }

  // ── The copy ──

  apply(m: Match, e: MatchEvent): void {
    if (e.type === "found") {
      const a = m.get(e.id);
      if (a) this.found[a.index]++;
    }
  }

  view(m: Match, dt: number): void {
    for (const c of m.contestants) if (c.status === "alive") this.hidden[c.index] += dt;
  }
}
