// Steal & Reposition's drop zones (SPEC-V3 §9 #3): `live` circles at a time,
// each live for `life` seconds, then it moves somewhere else (far from the
// others, inside the zone's safe circle when it can be). Carry a flag into a
// live one to deliver it (flags.ts counts it). Seeded: the server and every
// phone agree where they go.

import { DROPZONES } from "../../config";
import type { Rng } from "../../core/rng";
import type { Match } from "../core/match";
import type { MatchEvent, RuleModule } from "../core/module";
import { nearOpen } from "./flags";
import type { ZoneModule } from "./zone";

export interface DropZone {
  readonly k: number;
  x: number;
  z: number;
  /** Live until (seconds of play). */
  until: number;
}

export class DropzonesModule implements RuleModule {
  readonly id = "dropzones" as const;
  readonly zones: DropZone[] = [];
  readonly live: number;
  readonly life: number;
  readonly target: number;
  private rng!: Rng;

  constructor(params: Record<string, unknown>) {
    const num = (k: string, d: number) => (typeof params[k] === "number" ? (params[k] as number) : d);
    this.live = Math.max(1, Math.min(6, Math.floor(num("live", 3))));
    this.life = Math.max(10, num("life", 60));
    this.target = Math.max(1, Math.floor(num("target", 5)));
  }

  init(m: Match): void {
    this.rng = m.rng("dropzones");
    // Staggered, so they don't all move at once.
    for (let k = 0; k < this.live; k++) this.zones.push({ k, x: 0, z: 0, until: 0 });
    for (const z of this.zones) this.move(m, z, (this.life * (z.k + 1)) / this.live);
  }

  private move(m: Match, z: DropZone, life: number): void {
    const safe = m.module<ZoneModule>("zone")?.safe();
    const b = m.world.space.bounds;
    let cell = -1;
    for (let t = 0; t < 80 && cell < 0; t++) {
      let x: number;
      let zz: number;
      if (safe && t < 60) {
        const a = this.rng.range(0, Math.PI * 2);
        const r = Math.sqrt(this.rng.next()) * safe.r * 0.8;
        x = safe.x + Math.cos(a) * r;
        zz = safe.z + Math.sin(a) * r;
      } else {
        x = this.rng.range(b.x0 + 20, b.x1 - 20);
        zz = this.rng.range(b.z0 + 20, b.z1 - 20);
      }
      const c = nearOpen(m, x, zz, 3);
      if (c < 0) continue;
      const [cx, cz] = m.reach.centre(c);
      if (t < 50 && this.zones.some((o) => o !== z && o.until > 0 && Math.hypot(o.x - cx, o.z - cz) < DROPZONES.minApart)) continue;
      cell = c;
    }
    if (cell >= 0) [z.x, z.z] = m.reach.centre(cell);
    z.until = m.elapsed + life;
    m.emit({ type: "dz", k: z.k, x: z.x, z: z.z, until: z.until });
  }

  step(m: Match): void {
    for (const z of this.zones) if (m.elapsed >= z.until) this.move(m, z, this.life);
  }

  /** The live zone (x, z) is in, or −1. */
  liveAt(t: number, x: number, z: number): number {
    for (const d of this.zones) if (t < d.until && Math.hypot(x - d.x, z - d.z) <= DROPZONES.radius) return d.k;
    return -1;
  }

  apply(_m: Match, e: MatchEvent): void {
    if (e.type !== "dz") return;
    const z = this.zones[e.k] ?? (this.zones[e.k] = { k: e.k, x: 0, z: 0, until: 0 });
    z.x = e.x;
    z.z = e.z;
    z.until = e.until;
  }
}
