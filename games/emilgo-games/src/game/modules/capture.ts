// Squad Rally's moving point (SPEC-V3 §9 #4): a circle that drives the main
// roads at walking pace (the world's route, a loop). Every second inside
// counts for your squad (double in the last `doubleLast` seconds); at the end
// the squad with the most members inside wins, ties to the most time inside.
// Where it is follows from the clock alone, so a phone draws it without being told.

import { RALLY } from "../../config";
import type { Match } from "../core/match";
import type { GadgetsModule } from "./gadgets";
import type { RuleModule } from "../core/module";

export class CaptureModule implements RuleModule {
  readonly id = "capture" as const;
  readonly radius: number;
  readonly speed: number;
  readonly doubleLast: number;
  /** Where it is now. */
  x = 0;
  z = 0;
  /** Seconds inside per body (doubled late). */
  inside = new Float64Array(0);
  private route: [number, number][] = [];
  private lengths: number[] = [];
  private total = 0;

  constructor(params: Record<string, unknown>) {
    const num = (k: string, d: number) => (typeof params[k] === "number" ? (params[k] as number) : d);
    this.radius = Math.max(3, num("radius", RALLY.radius));
    this.speed = Math.max(0, num("speed", RALLY.speed));
    this.doubleLast = Math.max(0, num("doubleLast", 60));
  }

  init(m: Match): void {
    this.inside = new Float64Array(m.contestants.length);
    const r = m.world.route ?? [];
    this.route = r.length >= 2 ? r.map(([x, z]) => [x, z]) : [[0, 0], [0, 1]];
    this.total = 0;
    this.lengths = this.route.map((p, k) => {
      const q = this.route[(k + 1) % this.route.length];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      this.total += d;
      return d;
    });
    this.place(0);
  }

  /** The point after `t` seconds of play. */
  place(t: number): void {
    let d = (t * this.speed) % Math.max(1e-6, this.total);
    for (let k = 0; k < this.route.length; k++) {
      const len = this.lengths[k];
      if (d <= len || k === this.route.length - 1) {
        const p = this.route[k];
        const q = this.route[(k + 1) % this.route.length];
        const u = len > 0 ? Math.min(1, d / len) : 0;
        this.x = p[0] + (q[0] - p[0]) * u;
        this.z = p[1] + (q[1] - p[1]) * u;
        return;
      }
      d -= len;
    }
  }

  isInside(x: number, z: number): boolean {
    return Math.hypot(x - this.x, z - this.z) <= this.radius;
  }

  step(m: Match, dt: number): void {
    this.place(m.elapsed);
    const late = m.settings.time - m.elapsed <= this.doubleLast ? 2 : 1;
    const gad = m.module<GadgetsModule>("gadgets");
    for (const c of m.contestants) if (c.status === "alive" && this.isInside(c.x, c.z)) this.inside[c.index] += dt * late * (gad?.boost(m, m.squads[c.index], this.x, this.z, this.radius + 2) ?? 1);
  }

  view(m: Match, dt: number): void {
    this.step(m, dt);
  }

  /** Time up: the squad with the most members inside now (ties: the most time inside). */
  timeUp(m: Match): void {
    const now = new Map<number, number>();
    const time = new Map<number, number>();
    for (const c of m.contestants) {
      const q = m.squads[c.index];
      if (c.status === "alive" && this.isInside(c.x, c.z)) now.set(q, (now.get(q) ?? 0) + 1);
      time.set(q, (time.get(q) ?? 0) + this.inside[c.index]);
    }
    const order = [...time.keys()].sort((a, b) => (now.get(b) ?? 0) - (now.get(a) ?? 0) || (time.get(b) ?? 0) - (time.get(a) ?? 0));
    const [a, b] = order;
    if (a === undefined) return;
    const tie = b !== undefined && (now.get(a) ?? 0) === (now.get(b) ?? 0) && Math.abs((time.get(a) ?? 0) - (time.get(b) ?? 0)) < 1e-6;
    if (!tie && ((now.get(a) ?? 0) > 0 || (time.get(a) ?? 0) > 0)) m.win(null, a);
  }

  objective(_m: Match, i: number): number {
    return this.inside[i] ?? 0;
  }

  setObjective(i: number, v: number): void {
    this.inside[i] = v;
  }
}
