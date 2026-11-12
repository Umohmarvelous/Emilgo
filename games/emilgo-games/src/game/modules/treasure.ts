// Treasure Hunt (v5, the owner's first Free For All game): five treasures in
// boxes hidden all over the world, among many empty ones. Hold interact to open
// a box. Find all five, carry them to the one upload machine, and stand in its
// ring while they upload.
//
//   A body that dies drops every treasure it holds where it fell, for anyone.
//   Uploading needs all five, and leaving the ring or dying starts it again.
//   In a squad only the leader uploads: a mate carrying a treasure hands it over
//   by coming close, and the rest protect them.
//   Time up: the squad holding the most treasures wins; a tie, nobody.
//
// Which boxes are real is the server's secret (the phone learns on opening). The
// boxes' places and the machine come from the public seed, so a copy agrees.
//
// v7 (the owner, 12 Nov: "treasure hunt rules ... remain the same where players
// have to find all 5 hidden treasures and upload them"): the v6 rules, with the
// boxes gathered round the hunt's centre (`area`, metres: the machine, which the
// zone closes on), so they're in the circle or just outside it, the real ones
// within TREASURE.core of it. Time up (the last circle shut: the zone is the
// clock): the most carried wins, then the most still standing.

import { TREASURE } from "../../config";
import type { Contestant } from "../core/body";
import type { Match } from "../core/match";
import type { MatchEvent, RuleModule } from "../core/module";
import { nearOpen } from "./flags";
import type { MeleeModule } from "./melee";

export interface TreasureBox {
  readonly index: number;
  x: number;
  z: number;
  h: number;
  opened: boolean;
}

export interface Treasure {
  readonly index: number;
  /** In a box still (its index), or −1. */
  box: number;
  /** Who carries it (body index), or −1. */
  holder: number;
  x: number;
  z: number;
  h: number;
  droppedBy: number;
  droppedAt: number;
}

export class TreasureModule implements RuleModule {
  readonly id = "treasure" as const;
  readonly need: number;
  readonly boxCount: number;
  readonly uploadTime: number;
  /** v7: the boxes' circle round the machine, metres (0: the whole world, as v5). */
  readonly area: number;
  /** v7 (H4, heavy loot): the speed each treasure carried costs (0.03: 3%), and from how many there's no sprint or slide (0: never). */
  readonly heavy: number;
  readonly heavyAt: number;
  readonly boxes: TreasureBox[] = [];
  readonly treasures: Treasure[] = [];
  machine: { x: number; z: number; h: number } | null = null;
  /** Who is uploading (body index, −1), and how far along, seconds. */
  uploader = -1;
  uploaded = 0;
  /** Per body: treasures carried, the box being opened and for how long. */
  count = new Int32Array(0);
  private openT = new Float64Array(0);
  private openOn = new Int32Array(0);

  constructor(params: Record<string, unknown>) {
    const num = (k: string, d: number) => (typeof params[k] === "number" ? (params[k] as number) : d);
    this.need = Math.max(1, Math.min(9, Math.floor(num("need", TREASURE.need))));
    this.boxCount = Math.max(this.need, Math.min(80, Math.floor(num("boxes", TREASURE.boxes))));
    this.uploadTime = Math.max(1, num("upload", TREASURE.upload));
    const area = num("area", 0);
    this.area = area > 0 ? Math.max(60, area) : 0;
    this.heavy = Math.max(0, Math.min(0.1, num("heavy", 0)));
    this.heavyAt = Math.max(0, Math.min(9, Math.floor(num("heavyAt", 0))));
  }

  /** v7 (H4): the share of your speed you keep with what you carry (5 at 3%: 0.85). */
  speedShare(i: number): number {
    const n = this.count[i] ?? 0;
    return n > 0 && this.heavy > 0 ? Math.max(0.5, 1 - this.heavy * n) : 1;
  }

  /** v7 (H4): too laden to sprint or slide. */
  laden(i: number): boolean {
    return this.heavyAt > 0 && (this.count[i] ?? 0) >= this.heavyAt;
  }

  /** How far from each circle's centre the hunt's centre may lie, as a share of its radius (zone.ts). */
  get anchorSlack(): number {
    return this.area > 0 ? 0.3 : 0.6;
  }

  /**
   * The machine's spot: open ground with nothing near, from the public seed. The zone closes on it (zone.ts), so it
   * can always be reached. v7: with an `area`, nearer the middle of the world.
   */
  spot(m: Match): { x: number; z: number; h: number } {
    if (this.machine) return this.machine;
    const b = m.world.space.bounds;
    const half = Math.max(b.x1 - b.x0, b.z1 - b.z0) / 2;
    const rng = m.rng("treasure.machine");
    const reach = m.reach;
    let best: { x: number; z: number; h: number } | null = null;
    for (let t = 0; t < 400 && !best; t++) {
      const a = rng.range(0, Math.PI * 2);
      const d = this.area > 0 ? rng.range(half * 0.05, half * 0.3) : rng.range(half * 0.12, half * 0.5);
      const cell = nearOpen(m, (b.x0 + b.x1) / 2 + Math.cos(a) * d, (b.z0 + b.z1) / 2 + Math.sin(a) * d, 3);
      if (cell < 0) continue;
      const [x, z] = reach.centre(cell);
      if (m.world.space.near(x, z, TREASURE.field).length) continue;
      best = { x, z, h: reach.h[cell] };
    }
    if (!best) {
      const cell = reach.open[0];
      const [x, z] = reach.centre(cell);
      best = { x, z, h: reach.h[cell] };
    }
    this.machine = best;
    return best;
  }

  init(m: Match): void {
    const n = m.contestants.length;
    this.count = new Int32Array(n);
    this.openT = new Float64Array(n);
    this.openOn = new Int32Array(n).fill(-1);
    const centre = this.spot(m);
    const rng = m.rng("treasure");
    const reach = m.reach;
    // v7: with an area, every box within it round the machine.
    const within = (x: number, z: number, r = this.area) => this.area <= 0 || Math.hypot(x - centre.x, z - centre.z) <= r;
    const put = (x0: number, z0: number): boolean => {
      if (!within(x0, z0)) return false;
      const cell = nearOpen(m, x0, z0, 4);
      if (cell < 0) return false;
      const [x, z] = reach.centre(cell);
      if (!within(x, z)) return false;
      if (this.boxes.some((o) => Math.hypot(o.x - x, o.z - z) < TREASURE.apart)) return false;
      this.boxes.push({ index: this.boxes.length, x, z, h: reach.h[cell], opened: false });
      return true;
    };
    // Tucked beside things where there are things (a wreck, a kiosk, a generator): the owner's "almost hidden".
    const stash = rng.shuffle([...(m.world.stash ?? [])]);
    // Some in every named place first, so no part of the world is empty.
    const named = m.world.named ?? [];
    for (const p of named) {
      let put1 = 0;
      for (const s of stash) {
        if (put1 >= 2 || this.boxes.length >= this.boxCount) break;
        if (Math.hypot(s.x - p.x, s.z - p.z) > Math.max(p.r, 30)) continue;
        if (put(s.x, s.z)) put1++;
      }
      for (let k = 0; k < 12 && put1 < 1 && this.boxes.length < this.boxCount; k++) if (put(p.x + rng.range(-p.r, p.r) * 0.7, p.z + rng.range(-p.r, p.r) * 0.7)) put1++;
    }
    for (const s of stash) {
      if (this.boxes.length >= this.boxCount) break;
      put(s.x, s.z);
    }
    for (let k = 0; k < 600 && this.boxes.length < this.boxCount; k++) {
      if (this.area > 0) {
        // Anywhere in the area, evenly over its disc.
        const a = rng.range(0, Math.PI * 2);
        const d = Math.sqrt(rng.next()) * this.area;
        put(centre.x + Math.cos(a) * d, centre.z + Math.sin(a) * d);
        continue;
      }
      const cell = reach.open[Math.floor(rng.next() * reach.open.length) % reach.open.length];
      const [x, z] = reach.centre(cell);
      put(x, z);
    }
    // The real ones: the secret stream. The copy doesn't know until a box is opened.
    if (!m.mirror) {
      const secret = m.secretRng("treasure");
      // v7: with an area, the treasures hide in the boxes nearest the machine (inside TREASURE.core when it has enough).
      const inner = this.area > 0 ? this.boxes.filter((b) => within(b.x, b.z, TREASURE.core)) : [];
      const order = secret.shuffle((inner.length >= this.need * 2 ? inner : this.boxes).map((b) => b.index));
      for (let k = 0; k < this.need; k++) this.treasures.push({ index: k, box: order[k % order.length], holder: -1, x: 0, z: 0, h: 0, droppedBy: -1, droppedAt: -99 });
    } else for (let k = 0; k < this.need; k++) this.treasures.push({ index: k, box: -2, holder: -1, x: 0, z: 0, h: 0, droppedBy: -1, droppedAt: -99 });
  }

  /** The squad's leader: its first body still in the match (their first seat, so the party's leader). */
  leaderOf(m: Match, squad: number): number {
    let first = -1;
    for (const c of m.contestants) {
      if (m.squads[c.index] !== squad) continue;
      if (c.status === "alive") return c.index;
      if (first < 0) first = c.index;
    }
    return first;
  }

  /** The unopened box c could open, or null. */
  boxFor(c: Contestant): TreasureBox | null {
    let best: TreasureBox | null = null;
    let bestD: number = TREASURE.reach;
    for (const b of this.boxes) {
      if (b.opened || Math.abs(b.h - (c.h + c.y)) > 1.4) continue;
      const d = Math.hypot(b.x - c.x, b.z - c.z);
      if (d <= bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /** How far along c is in opening a box, 0…1. */
  opening(i: number): number {
    return Math.min(1, (this.openT[i] ?? 0) / TREASURE.open);
  }

  inRing(c: Contestant): boolean {
    const p = this.machine;
    return !!p && Math.hypot(c.x - p.x, c.z - p.z) <= TREASURE.ring;
  }

  private canAct(m: Match, c: Contestant): boolean {
    return c.status === "alive" && c.stun <= 0 && !m.seated(c) && !m.module<MeleeModule>("melee")?.isDown(c.index);
  }

  /** The kiosk is solid: nobody stands inside it (a circle of 0.8 m). */
  private solid(m: Match): void {
    const p = this.machine;
    if (!p) return;
    for (const c of m.contestants) {
      if (c.status !== "alive") continue;
      const dx = c.x - p.x;
      const dz = c.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d >= 0.8 || d < 1e-4) continue;
      c.x = p.x + (dx / d) * 0.8;
      c.z = p.z + (dz / d) * 0.8;
    }
  }

  step(m: Match, dt: number): void {
    const t = m.elapsed;
    this.solid(m);
    // v7 (H4): heavy loot: the greedy are slower, and from heavyAt on they can't sprint or slide.
    for (const c of m.contestants) {
      if (c.status !== "alive" || !this.count[c.index]) continue;
      const k = this.speedShare(c.index);
      if (k < 1) m.slow(c, k);
      if (this.laden(c.index)) m.noSprint(c);
    }
    // Opening boxes.
    for (const c of m.contestants) {
      const i = c.index;
      const box = this.canAct(m, c) && m.holding(c) ? this.boxFor(c) : null;
      if (!box || this.openOn[i] !== box.index) {
        this.openT[i] = 0;
        this.openOn[i] = box ? box.index : -1;
      }
      if (!box) continue;
      this.openT[i] += dt;
      if (this.openT[i] >= TREASURE.open) {
        this.openT[i] = 0;
        this.openOn[i] = -1;
        box.opened = true;
        const tr = this.treasures.find((x) => x.box === box.index) ?? null;
        m.emit({ type: "tbox", box: box.index, id: c.id, found: tr ? tr.index : -1 });
        if (tr) this.take(m, tr, c, "find");
      }
    }
    // Loose treasures: the first to step onto one takes it.
    for (const tr of this.treasures) {
      if (tr.holder >= 0 || tr.box >= 0) continue;
      for (const c of m.contestants) {
        if (!this.canAct(m, c)) continue;
        if (c.index === tr.droppedBy && t - tr.droppedAt < TREASURE.noRetake) continue;
        if (Math.hypot(c.x - tr.x, c.z - tr.z) > TREASURE.touch || Math.abs(c.h + c.y - tr.h) > 1.4) continue;
        this.take(m, tr, c, "take");
        break;
      }
    }
    // Squads: a mate close to the leader hands over.
    for (const tr of this.treasures) {
      if (tr.holder < 0) continue;
      const c = m.contestants[tr.holder];
      const lead = this.leaderOf(m, m.squads[c.index]);
      if (lead === c.index || lead < 0) continue;
      const l = m.contestants[lead];
      if (l.status === "alive" && Math.hypot(l.x - c.x, l.z - c.z) <= TREASURE.hand) {
        this.count[c.index]--;
        this.count[lead]++;
        tr.holder = lead;
        m.emit({ type: "tre", t: tr.index, how: "give", id: l.id, x: l.x, z: l.z, h: l.h });
      }
    }
    // Everyone carried moves with its carrier (for the map and the drop).
    for (const tr of this.treasures) {
      if (tr.holder < 0) continue;
      const c = m.contestants[tr.holder];
      tr.x = c.x;
      tr.z = c.z;
      tr.h = c.h;
    }
    // The upload.
    if (this.uploader >= 0) {
      const c = m.contestants[this.uploader];
      if (!this.canAct(m, c) || !this.inRing(c) || this.count[this.uploader] < this.need) {
        m.emit({ type: "upl", id: c.id, how: "stop" });
        this.uploader = -1;
        this.uploaded = 0;
      } else {
        this.uploaded += dt;
        if (this.uploaded >= this.uploadTime) {
          m.emit({ type: "upl", id: c.id, how: "done" });
          return void m.win(c);
        }
      }
    }
    if (this.uploader < 0) {
      for (const c of m.contestants) {
        // Only a squad's leader uploads (on your own, you are your leader).
        if (this.count[c.index] >= this.need && this.canAct(m, c) && this.inRing(c) && this.leaderOf(m, m.squads[c.index]) === c.index) {
          this.uploader = c.index;
          this.uploaded = 0;
          m.emit({ type: "upl", id: c.id, how: "start" });
          break;
        }
      }
    }
  }

  private take(m: Match, tr: Treasure, c: Contestant, how: "find" | "take"): void {
    tr.box = -1;
    tr.holder = c.index;
    this.count[c.index]++;
    m.emit({ type: "tre", t: tr.index, how, id: c.id, x: c.x, z: c.z, h: c.h });
  }

  onEvent(m: Match, e: MatchEvent): void {
    // A Map Print shows its user where the treasures still hide (theirs alone: the rest never learn).
    if (e.type === "use" && e.kind === "map-print") {
      const hid = this.treasures.filter((t) => t.box >= 0);
      m.whisper(e.id, { type: "tmap", t: hid.map((t) => t.index), b: hid.map((t) => t.box) });
      return;
    }
    if (e.type !== "eliminated") return;
    const c = m.get(e.id);
    if (!c) return;
    let k = 0;
    for (const tr of this.treasures) {
      if (tr.holder !== c.index) continue;
      tr.holder = -1;
      tr.droppedBy = c.index;
      tr.droppedAt = m.elapsed;
      // Spread round where they fell, so each can be seen.
      const a = (k++ / Math.max(1, this.need)) * Math.PI * 2;
      tr.x = e.x + Math.cos(a) * 0.9;
      tr.z = e.z + Math.sin(a) * 0.9;
      tr.h = e.h;
      m.emit({ type: "tre", t: tr.index, how: "drop", id: c.id, x: tr.x, z: tr.z, h: tr.h });
    }
    this.count[c.index] = 0;
  }

  /**
   * Time up: the squad with the most treasures wins; v7 (question 7): a tie goes to the squad with the most still
   * standing; still a tie, nobody.
   */
  timeUp(m: Match): void {
    const by = new Map<number, { n: number; up: number }>();
    for (const c of m.contestants) {
      const q = m.squads[c.index];
      const s = by.get(q) ?? { n: 0, up: 0 };
      s.n += this.count[c.index];
      if (c.status === "alive") s.up++;
      by.set(q, s);
    }
    const sorted = [...by.entries()].sort((a, b) => b[1].n - a[1].n || b[1].up - a[1].up);
    if (!sorted.length || sorted[0][1].n <= 0) return;
    if (sorted[1] && sorted[1][1].n === sorted[0][1].n && sorted[1][1].up === sorted[0][1].up) return;
    const q = sorted[0][0];
    m.win(m.contestants[this.leaderOf(m, q)] ?? null, q);
  }

  objective(_m: Match, i: number): number {
    return this.count[i] ?? 0;
  }

  // ── The online client's copy ──

  view(m: Match, dt: number): void {
    this.solid(m);
    for (const c of m.contestants) {
      const i = c.index;
      const box = this.canAct(m, c) && m.holding(c) ? this.boxFor(c) : null;
      if (!box || this.openOn[i] !== box.index) {
        this.openT[i] = 0;
        this.openOn[i] = box ? box.index : -1;
      }
      if (box) this.openT[i] = Math.min(TREASURE.open, this.openT[i] + dt);
    }
    if (this.uploader >= 0) this.uploaded = Math.min(this.uploadTime, this.uploaded + dt);
    for (const tr of this.treasures) {
      if (tr.holder < 0) continue;
      const c = m.contestants[tr.holder];
      tr.x = c.x;
      tr.z = c.z;
      tr.h = c.h;
    }
  }

  apply(m: Match, e: MatchEvent): void {
    if (e.type === "tmap") {
      e.t.forEach((k, j) => {
        const tr = this.treasures[k];
        if (tr && tr.box !== -1 && tr.holder < 0) tr.box = e.b[j];
      });
      return;
    }
    if (e.type === "tbox") {
      const b = this.boxes[e.box];
      if (b) b.opened = true;
      if (e.found >= 0 && this.treasures[e.found]) this.treasures[e.found].box = e.box;
    } else if (e.type === "tre") {
      const tr = this.treasures[e.t];
      if (!tr) return;
      if (tr.holder >= 0) this.count[tr.holder] = Math.max(0, this.count[tr.holder] - 1);
      const c = e.id ? m.get(e.id) : null;
      tr.box = -1;
      tr.x = e.x;
      tr.z = e.z;
      tr.h = e.h;
      if (e.how === "drop" || !c) tr.holder = -1;
      else {
        tr.holder = c.index;
        this.count[c.index]++;
      }
    } else if (e.type === "upl") {
      const c = m.get(e.id);
      if (e.how === "start" && c) {
        this.uploader = c.index;
        this.uploaded = 0;
      } else if (e.how === "stop") {
        this.uploader = -1;
        this.uploaded = 0;
      }
    }
  }
}
