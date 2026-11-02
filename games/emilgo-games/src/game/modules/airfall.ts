// Airfall (SPEC-V3 §10.3): at most `max` crates a match, a mode's `gap`
// apart at random. Each one's flare goes up AIRFALL.flare seconds before it
// lands, where it will land: inside the circle the zone is closing towards,
// on open ground you can walk to. Hold interact beside it for AIRFALL.open
// seconds to open it (letting go, walking off or being knocked down starts
// you again); the first to finish gets the loot: AIRFALL.rare items from the
// Airfall table and AIRFALL.core from the mode's own, straight into the
// backpack (what doesn't fit lands round you).
//
// The spectators' vote (§10.6): AIRFALL.vote seconds before each flare, three
// spots inside the closing circle are offered; anyone out of the match (a
// spectator) can vote once; the flare goes up on the spot with the most votes
// (a tie, or no votes, by the seed). Losing is still fun.

import { AIRFALL } from "../../config";
import { builtLoot, type ItemId } from "../../content/items";
import type { ModuleId } from "../../content/modes";
import type { Rng } from "../../core/rng";
import type { Contestant } from "../core/body";
import type { Match } from "../core/match";
import type { MatchEvent, RuleModule } from "../core/module";
import { pick, type ItemsModule } from "./items";
import type { ZoneModule } from "./zone";

export interface Crate {
  readonly index: number;
  readonly x: number;
  readonly z: number;
  readonly h: number;
  /** Seconds of play when it lands. */
  readonly land: number;
  landed: boolean;
  opened: boolean;
}

export class AirfallModule implements RuleModule {
  readonly id = "airfall" as const;
  readonly crates: Crate[] = [];
  /** When each crate will land (all chosen at the start, from the seed). */
  readonly times: number[] = [];
  private readonly max: number;
  private readonly gap: [number, number];
  private rng!: Rng;
  private places!: Rng;
  private progress = new Float64Array(0);
  private on = new Int32Array(0);
  /** The open vote, if any: for which crate, the spots, the counts, who has voted. */
  ballot: { crate: number; spots: { x: number; z: number; h: number }[]; votes: number[]; cast: Set<number>; until: number } | null = null;

  constructor(params: Record<string, unknown>) {
    this.max = typeof params.max === "number" ? Math.max(0, Math.min(3, Math.floor(params.max))) : 3;
    const g = params.gap;
    this.gap = Array.isArray(g) && g.length === 2 ? [Math.min(g[0], g[1]), Math.max(g[0], g[1])] : [180, 240];
  }

  init(m: Match): void {
    this.rng = m.rng("airfall");
    this.places = m.secretRng("airfall.places");
    let t = 0;
    for (let k = 0; k < this.max; k++) {
      t += this.rng.range(this.gap[0], this.gap[1]);
      if (t > m.settings.time - AIRFALL.minLeft) break;
      this.times.push(t);
    }
    const n = m.contestants.length;
    this.progress = new Float64Array(n);
    this.on = new Int32Array(n).fill(-1);
  }

  step(m: Match, dt: number): void {
    const t = m.elapsed;
    const next = this.crates.length;
    if (next < this.times.length && !this.ballot && t >= this.times[next] - AIRFALL.flare - AIRFALL.vote) this.openVote(m, next);
    while (this.crates.length < this.times.length && t >= this.times[this.crates.length] - AIRFALL.flare) this.place(m, this.times[this.crates.length]);
    for (const c of this.crates) {
      if (c.landed || t < c.land) continue;
      c.landed = true;
      m.emit({ type: "landed", crate: c.index });
    }
    for (const c of m.contestants) {
      const i = c.index;
      const crate = c.status === "alive" && c.stun <= 0 && m.holding(c) ? this.nearest(c) : null;
      if (!crate || this.on[i] !== crate.index) {
        this.progress[i] = 0;
        this.on[i] = crate ? crate.index : -1;
      }
      if (!crate) continue;
      this.progress[i] += dt;
      if (this.progress[i] >= AIRFALL.open) {
        this.progress[i] = 0;
        this.on[i] = -1;
        this.open(m, c, crate);
      }
    }
  }

  /** Three spots for the spectators to choose from. */
  private openVote(m: Match, crate: number): void {
    const spots = Array.from({ length: AIRFALL.options }, () => this.spot(m));
    const until = this.times[crate] - AIRFALL.flare;
    this.ballot = { crate, spots, votes: spots.map(() => 0), cast: new Set(), until };
    m.emit({ type: "vote", crate, xs: spots.map((s) => s.x), zs: spots.map((s) => s.z), until });
  }

  /** A spectator (out of the match) votes for spot `pick` of the open vote: once. True: counted. */
  vote(m: Match, c: Contestant, pick: number): boolean {
    const b = this.ballot;
    if (!b || c.status === "alive" || b.cast.has(c.index) || pick < 0 || pick >= b.spots.length || m.elapsed >= b.until) return false;
    b.cast.add(c.index);
    b.votes[pick]++;
    m.emit({ type: "ballot", crate: b.crate, id: c.id, pick, votes: b.votes.slice() });
    return true;
  }

  /** Where it will land: the spectators' choice if they voted, else inside the circle being closed into, on open ground. */
  private place(m: Match, land: number): void {
    const b = this.ballot && this.ballot.crate === this.crates.length ? this.ballot : null;
    let at: { x: number; z: number; h: number };
    if (b) {
      const most = Math.max(...b.votes);
      const top = b.spots.filter((_, k) => b.votes[k] === most);
      at = top[this.places.int(0, top.length - 1)];
    } else at = this.spot(m);
    this.ballot = null;
    const crate: Crate = { index: this.crates.length, x: at.x, z: at.z, h: at.h, land, landed: false, opened: false };
    this.crates.push(crate);
    m.emit({ type: "flare", crate: crate.index, x: at.x, z: at.z, h: at.h, land, ...(b ? { votes: b.votes.slice() } : {}) });
  }

  /** A spot inside the circle being closed into, on open ground. */
  private spot(m: Match): { x: number; z: number; h: number } {
    const reach = m.reach;
    const zone = m.module<ZoneModule>("zone");
    const circle = zone ? zone.safe() : null;
    let cell = -1;
    if (circle) {
      for (let t = 0; t < 80 && cell < 0; t++) {
        const a = this.places.range(0, Math.PI * 2);
        const d = Math.sqrt(this.places.next()) * circle.r * 0.7;
        const k = reach.cell(circle.x + Math.cos(a) * d, circle.z + Math.sin(a) * d);
        if (k >= 0 && reach.ground[k]) cell = k;
      }
    }
    if (cell < 0 && reach.open.length) cell = reach.open[this.places.int(0, reach.open.length - 1)];
    const [x, z] = cell >= 0 ? reach.centre(cell) : [0, 0];
    return { x, z, h: cell >= 0 ? reach.h[cell] : 0 };
  }

  /** The landed, unopened crate within reach of c, or null. */
  nearest(c: Contestant): Crate | null {
    const feet = c.h + c.y;
    let best: Crate | null = null;
    let bestD: number = AIRFALL.reach;
    for (const k of this.crates) {
      if (!k.landed || k.opened || Math.abs(k.h - feet) > 1.2) continue;
      const d = Math.hypot(k.x - c.x, k.z - c.z);
      if (d <= bestD) {
        bestD = d;
        best = k;
      }
    }
    return best;
  }

  private open(m: Match, c: Contestant, crate: Crate): void {
    crate.opened = true;
    const items = m.module<ItemsModule>("items");
    const has = (id: ModuleId) => m.module(id) !== null;
    const rare = builtLoot("airfall", has);
    const core = builtLoot(items?.table ?? "ffa-core", has);
    const kinds: ItemId[] = [];
    for (let k = 0; k < AIRFALL.rare && rare.length; k++) kinds.push(pick(rare, this.rng.next()));
    for (let k = 0; k < AIRFALL.core && core.length; k++) kinds.push(pick(core, this.rng.next()));
    m.emit({ type: "open", crate: crate.index, id: c.id, kinds: kinds.slice() });
    items?.give(m, c, kinds);
  }

  /** 0 … 1: how far body i is through opening a crate. */
  opening(i: number): number {
    return Math.min(1, (this.progress[i] ?? 0) / AIRFALL.open);
  }

  /** The online client's copy: your own hold's progress (the HUD's ring); the opening is the server's. */
  view(m: Match, dt: number): void {
    for (const c of m.contestants) {
      const i = c.index;
      const crate = c.status === "alive" && c.stun <= 0 && m.holding(c) ? this.nearest(c) : null;
      if (!crate || this.on[i] !== crate.index) {
        this.progress[i] = 0;
        this.on[i] = crate ? crate.index : -1;
      }
      if (crate) this.progress[i] = Math.min(AIRFALL.open, this.progress[i] + dt);
    }
  }

  apply(m: Match, e: MatchEvent): void {
    if (e.type === "vote") this.ballot = { crate: e.crate, spots: e.xs.map((x, k) => ({ x, z: e.zs[k], h: 0 })), votes: e.xs.map(() => 0), cast: new Set(), until: e.until };
    else if (e.type === "ballot" && this.ballot?.crate === e.crate) {
      this.ballot.votes = e.votes.slice();
      const c = m.get(e.id);
      if (c) this.ballot.cast.add(c.index);
    } else if (e.type === "flare") this.ballot = null;
    if (e.type === "flare") this.crates[e.crate] = { index: e.crate, x: e.x, z: e.z, h: e.h, land: e.land, landed: false, opened: false };
    else if (e.type === "landed" && this.crates[e.crate]) this.crates[e.crate].landed = true;
    else if (e.type === "open" && this.crates[e.crate]) this.crates[e.crate].opened = true;
  }
}
