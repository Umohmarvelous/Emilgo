// Flags (SPEC-V3 §9): one module, four of the first five modes, by its numbers.
//
//   Find the Flag   (spots "stash") one flag hidden in 1 of 40 stash spots —
//                   inside a danfo, a water tank, under a stall. Search a spot
//                   with an interact tap. Radio hints narrow it to a district.
//                   Hold it `claimHold` seconds to win; the holder glows on
//                   everyone's compass. The Flag Duel is this on the market.
//   Hold the Flag   (ping) one flag (two with FLAGS.extraAt players or more)
//                   in the open; the holder is slower and shows on the map
//                   every `ping` seconds; most seconds held wins (squads pool).
//   Steal & Repos.  four flags; carry one into a live drop zone (dropzones.ts)
//                   to deliver it; first squad to the target, or most.
//   Scarcity        (extractAt) three flags, no respawns: the last standing
//                   with a flag wins, or the first to carry one into the
//                   extraction gate once it opens.
//
// A loose flag is taken by walking onto it. Knocked down or out, you drop it
// where you are (and its dropper can't snatch it straight back). One in your
// hands at a time; taking one drops a street prop you were holding.

import { FLAGS } from "../../config";
import type { Contestant } from "../core/body";
import type { Match } from "../core/match";
import type { GadgetsModule } from "./gadgets";
import type { MatchEvent, RuleModule } from "../core/module";
import type { DropzonesModule } from "./dropzones";
import type { MeleeModule } from "./melee";
import type { ZoneModule } from "./zone";

export interface Flag {
  readonly index: number;
  x: number;
  z: number;
  h: number;
  /** Who holds it (index), or −1. */
  holder: number;
  /** Find the Flag: still in its stash (nobody has seen it). */
  hidden: boolean;
  /** The last to drop it, and when: they can't retake it for FLAGS.noRetake. */
  droppedBy: number;
  droppedAt: number;
}

export interface Stash {
  readonly index: number;
  readonly x: number;
  readonly z: number;
  readonly h: number;
}

export class FlagsModule implements RuleModule {
  readonly id = "flags" as const;
  readonly flags: Flag[] = [];
  readonly stashes: Stash[] = [];
  /** Find the Flag: the stash the flag is in. */
  secret = -1;
  /** Scarcity's extraction gate, once open. */
  gate: { x: number; z: number } | null = null;
  readonly count: number;
  readonly claimHold: number;
  readonly hints: readonly number[];
  readonly ping: number;
  readonly holderSlow: number;
  readonly extractAt: number;
  readonly stash: boolean;
  /** Per body: seconds held (Hold, Scarcity), the current claim (Find the Flag), deliveries (Steal & Reposition). */
  held = new Float64Array(0);
  claim = new Float64Array(0);
  best = new Float64Array(0);
  delivered = new Float64Array(0);
  private hinted = 0;
  private nextPing = 0;
  private searched: Set<number>[] = [];

  constructor(params: Record<string, unknown>) {
    const num = (k: string, d: number) => (typeof params[k] === "number" ? (params[k] as number) : d);
    this.count = Math.max(1, Math.min(6, Math.floor(num("count", 1))));
    this.stash = params.spots === "stash";
    this.claimHold = num("claimHold", 0);
    this.hints = Array.isArray(params.hints) ? (params.hints as number[]).filter((v) => typeof v === "number").sort((a, b) => a - b) : [];
    this.ping = num("ping", 0);
    this.holderSlow = num("holderSlow", 0);
    this.extractAt = num("extractAt", 0);
  }

  init(m: Match): void {
    const n = m.contestants.length;
    this.held = new Float64Array(n);
    this.claim = new Float64Array(n);
    this.best = new Float64Array(n);
    this.delivered = new Float64Array(n);
    this.searched = Array.from({ length: n }, () => new Set());
    const rng = m.rng("flags");
    const reach = m.reach;
    if (this.stash) {
      // The stash spots: next to each danfo, tank or stall, on ground you can reach; spread out.
      const cands = rng.shuffle([...(m.world.stash ?? [])]);
      for (const s of cands) {
        if (this.stashes.length >= FLAGS.stashes) break;
        const cell = nearOpen(m, s.x, s.z, 4);
        if (cell < 0) continue;
        const [x, z] = reach.centre(cell);
        if (this.stashes.some((o) => Math.hypot(o.x - x, o.z - z) < 8)) continue;
        this.stashes.push({ index: this.stashes.length, x, z, h: reach.h[cell] });
      }
      if (this.stashes.length) {
        // Which one is the server's secret: the copy on a phone never knows until it's found.
        if (m.mirror) this.flags.push({ index: 0, x: 0, z: 0, h: 0, holder: -1, hidden: true, droppedBy: -1, droppedAt: -99 });
        else {
          this.secret = m.secretRng("flags").int(0, this.stashes.length - 1);
          const s = this.stashes[this.secret];
          this.flags.push({ index: 0, x: s.x, z: s.z, h: s.h, holder: -1, hidden: true, droppedBy: -1, droppedAt: -99 });
        }
        return;
      }
    }
    // In the open: at the places (Hold the Flag's in the middle of things, the others spread).
    const n0 = this.ping > 0 && n >= FLAGS.extraAt ? Math.max(this.count, 2) : this.count;
    for (let k = 0; k < n0; k++) {
      const [x, z, h] = this.spot(m, rng.next(), rng.next());
      this.flags.push({ index: k, x, z, h, holder: -1, hidden: false, droppedBy: -1, droppedAt: -99 });
    }
    this.nextPing = this.ping;
  }

  /** A fresh spot for a flag: a place's open ground, inside the zone's safe circle if it can be, apart from other flags. */
  private spot(m: Match, u: number, v: number): [number, number, number] {
    const reach = m.reach;
    const places = m.world.places;
    const safe = m.module<ZoneModule>("zone")?.safe();
    const rng = m.rng(`flags.${this.flags.length}.${Math.floor(m.elapsed)}.${Math.floor(u * 1e6)}`);
    for (let t = 0; t < 40; t++) {
      const p = places.length ? places[Math.floor((t === 0 ? v : rng.next()) * places.length) % places.length] : { x: 0, z: 0, r: 30 };
      if (safe && t < 30 && Math.hypot(p.x - safe.x, p.z - safe.z) > safe.r * 0.85) continue;
      const cell = nearOpen(m, p.x + rng.range(-p.r, p.r) * 0.5, p.z + rng.range(-p.r, p.r) * 0.5, 6);
      if (cell < 0) continue;
      const [x, z] = reach.centre(cell);
      if (this.flags.some((f) => Math.hypot(f.x - x, f.z - z) < 25)) continue;
      return [x, z, reach.h[cell]];
    }
    const cell = reach.open[Math.floor(u * reach.open.length) % reach.open.length];
    const [x, z] = reach.centre(cell);
    return [x, z, reach.h[cell]];
  }

  /** The flag body i holds, or null. */
  heldBy(i: number): Flag | null {
    for (const f of this.flags) if (f.holder === i) return f;
    return null;
  }

  pre(m: Match): void {
    if (this.holderSlow <= 0) return;
    for (const f of this.flags) if (f.holder >= 0) m.slow(m.contestants[f.holder], 1 - this.holderSlow);
  }

  step(m: Match, dt: number): void {
    const t = m.elapsed;
    const melee = m.module<MeleeModule>("melee");
    // Loose flags: the first to step onto one takes it.
    for (const f of this.flags) {
      if (f.holder >= 0 || f.hidden) continue;
      for (const c of m.contestants) {
        if (c.status !== "alive" || c.stun > 0 || this.heldBy(c.index) || melee?.isDown(c.index)) continue;
        if (c.index === f.droppedBy && t - f.droppedAt < FLAGS.noRetake) continue;
        if (Math.hypot(c.x - f.x, c.z - f.z) > FLAGS.touch || Math.abs(c.h + c.y - f.h) > 1.2) continue;
        this.take(m, f, c, "take");
        break;
      }
    }
    // Holding: the claim, the seconds, the pings, delivering, the gate.
    const zones = m.module<DropzonesModule>("dropzones");
    for (const f of this.flags) {
      if (f.holder < 0) continue;
      const c = m.contestants[f.holder];
      f.x = c.x;
      f.z = c.z;
      f.h = c.h;
      // An Odogwu Pose near the holder counts their squad's seconds 10% more.
      const k = m.module<GadgetsModule>("gadgets")?.boost(m, m.squads[c.index], c.x, c.z) ?? 1;
      this.held[c.index] += dt * k;
      if (this.claimHold > 0) {
        this.claim[c.index] += dt * k;
        this.best[c.index] = Math.max(this.best[c.index], this.claim[c.index]);
        if (this.claim[c.index] >= this.claimHold) return void m.win(c);
      }
      if (zones) {
        const k = zones.liveAt(t, c.x, c.z);
        if (k >= 0) {
          this.delivered[c.index]++;
          m.emit({ type: "flag", flag: f.index, how: "deliver", id: c.id, x: c.x, z: c.z, h: c.h });
          f.holder = -1;
          const [x, z, h] = this.spot(m, m.rng(`deliver.${f.index}.${Math.round(t * 60)}`).next(), (f.index + 0.5) / this.flags.length);
          Object.assign(f, { x, z, h, droppedBy: -1, droppedAt: -99 });
          m.emit({ type: "flag", flag: f.index, how: "home", id: null, x, z, h });
          if (this.squadDeliveries(m, c) >= zones.target) return void m.win(c);
        }
      }
      if (this.gate && Math.hypot(c.x - this.gate.x, c.z - this.gate.z) <= FLAGS.gate) return void m.win(c);
    }
    // Hold the Flag: every holder shows on the map now and then.
    if (this.ping > 0 && t >= this.nextPing) {
      this.nextPing += this.ping;
      for (const f of this.flags) if (f.holder >= 0) {
        const c = m.contestants[f.holder];
        m.emit({ type: "ping", id: c.id, x: c.x, z: c.z });
      }
    }
    // Find the Flag's radio hints while it is still hidden.
    while (this.hinted < this.hints.length && t >= this.hints[this.hinted]) {
      const f = this.flags[0];
      const n = this.hinted++;
      if (!f?.hidden) continue;
      const r = FLAGS.hintR[Math.min(n, FLAGS.hintR.length - 1)];
      const rng = m.secretRng(`hint.${n}`);
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(0, r * 0.6);
      m.emit({ type: "hint", n, x: f.x + Math.cos(a) * d, z: f.z + Math.sin(a) * d, r });
    }
    // Scarcity: the gate opens, inside the circle being closed into.
    if (this.extractAt > 0 && !this.gate && t >= this.extractAt) {
      const safe = m.module<ZoneModule>("zone")?.safe();
      const rng = m.rng("gate");
      let cell = -1;
      for (let k = 0; k < 60 && cell < 0; k++) {
        const r = safe ? Math.sqrt(rng.next()) * safe.r * 0.6 : rng.range(0, 60);
        const a = rng.range(0, Math.PI * 2);
        cell = nearOpen(m, (safe?.x ?? 0) + Math.cos(a) * r, (safe?.z ?? 0) + Math.sin(a) * r, 3);
      }
      const [x, z] = cell >= 0 ? m.reach.centre(cell) : [0, 0];
      this.gate = { x, z };
      m.emit({ type: "gate", x, z });
    }
    // Scarcity: the last squad standing that holds a flag.
    if (this.extractAt > 0) {
      let squad = -2;
      let one = true;
      for (const c of m.contestants) {
        if (c.status !== "alive") continue;
        const q = m.squads[c.index];
        if (squad === -2) squad = q;
        else if (q !== squad) one = false;
      }
      if (one && squad !== -2) {
        const holder = this.flags.map((f) => f.holder).find((h) => h >= 0 && m.squads[h] === squad);
        if (holder !== undefined) m.win(m.contestants[holder]);
      }
    }
  }

  private squadDeliveries(m: Match, c: Contestant): number {
    let n = 0;
    for (const o of m.contestants) if (m.squads[o.index] === m.squads[c.index]) n += this.delivered[o.index];
    return n;
  }

  private take(m: Match, f: Flag, c: Contestant, how: "take" | "found"): void {
    f.holder = c.index;
    f.hidden = false;
    this.claim[c.index] = 0;
    m.module<MeleeModule>("melee")?.dropProp(m, c);
    m.emit({ type: "flag", flag: f.index, how, id: c.id, x: f.x, z: f.z, h: f.h });
  }

  private drop(m: Match, c: Contestant, x = c.x, z = c.z, h = c.h): void {
    const f = this.heldBy(c.index);
    if (!f) return;
    f.holder = -1;
    f.x = x;
    f.z = z;
    f.h = h;
    f.droppedBy = c.index;
    f.droppedAt = m.elapsed;
    this.claim[c.index] = 0;
    m.emit({ type: "flag", flag: f.index, how: "drop", id: c.id, x, z, h });
  }

  /** Find the Flag: the nearest stash spot within reach (an interact tap searches it). */
  reachFor(m: Match, c: Contestant): { d: number; take: () => void } | null {
    if (!this.stash || !this.flags[0]?.hidden) return null;
    let best: Stash | null = null;
    let bestD: number = FLAGS.search;
    for (const s of this.stashes) {
      if (this.searched[c.index].has(s.index) || Math.abs(s.h - (c.h + c.y)) > 1.2) continue;
      const d = Math.hypot(s.x - c.x, s.z - c.z);
      if (d <= bestD) {
        bestD = d;
        best = s;
      }
    }
    if (!best) return null;
    const s = best;
    return {
      d: bestD,
      take: () => {
        const found = s.index === this.secret && this.flags[0].hidden;
        this.searched[c.index].add(s.index);
        m.emit({ type: "search", id: c.id, spot: s.index, found });
        if (found) this.take(m, this.flags[0], c, "found");
      },
    };
  }

  /** The nearest stash spot c hasn't searched, within reach (the HUD's prompt). */
  stashFor(c: Contestant): Stash | null {
    if (!this.stash || !this.flags[0]?.hidden) return null;
    let best: Stash | null = null;
    let bestD: number = FLAGS.search;
    for (const s of this.stashes) {
      if (this.searched[c.index]?.has(s.index)) continue;
      const d = Math.hypot(s.x - c.x, s.z - c.z);
      if (d <= bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  onEvent(m: Match, e: MatchEvent): void {
    if (e.type === "down" || e.type === "eliminated") {
      const c = m.get(e.id);
      if (c) this.drop(m, c, e.type === "eliminated" ? e.x : c.x, e.type === "eliminated" ? e.z : c.z, e.type === "eliminated" ? e.h : c.h);
    }
    // Hold the Flag's bounty on the leader (§10.10): Daze them, take some of their seconds.
    if (e.type === "down" && e.why === "daze" && e.by && this.ping > 0 && this.claimHold <= 0 && this.extractAt <= 0) {
      const c = m.get(e.id);
      const by = m.get(e.by);
      if (!c || !by || m.sameSquad(c, by)) return;
      let top = -1;
      for (let i = 0; i < this.held.length; i++) if (top < 0 || this.held[i] > this.held[top]) top = i;
      if (top !== c.index || this.held[top] <= 0) return;
      const v = Math.min(this.held[top], FLAGS.bounty);
      this.held[top] -= v;
      this.held[by.index] += v;
      m.emit({ type: "bounty", id: by.id, tg: c.id, v });
    }
  }

  /** Time up: in a "most" mode, the clear leader wins (a tie: nobody). */
  timeUp(m: Match): void {
    if (this.claimHold > 0 || this.extractAt > 0) return;
    const st = m.standings();
    const top = st.filter((s) => s.place === 1);
    const squads = new Set(top.map((s) => s.squad));
    if (squads.size === 1 && top[0] && top[0].objective + 0 > 0) m.win(m.get(top[0].id) ?? null, top[0].squad);
  }

  objective(_m: Match, i: number): number {
    if (this.claimHold > 0) return this.best[i] ?? 0;
    if (this.extractAt > 0 || this.ping > 0) return this.held[i] ?? 0;
    return this.delivered[i] ?? 0;
  }

  // ── The online client's copy ──

  view(m: Match, dt: number): void {
    for (const f of this.flags) {
      if (f.holder < 0) continue;
      const c = m.contestants[f.holder];
      f.x = c.x;
      f.z = c.z;
      f.h = c.h;
      const k = m.module<GadgetsModule>("gadgets")?.boost(m, m.squads[c.index], c.x, c.z) ?? 1;
      this.held[f.holder] += dt * k;
      if (this.claimHold > 0) {
        this.claim[f.holder] += dt * k;
        this.best[f.holder] = Math.max(this.best[f.holder], this.claim[f.holder]);
      }
    }
  }

  apply(m: Match, e: MatchEvent): void {
    switch (e.type) {
      case "flag": {
        const f = this.flags[e.flag];
        if (!f) return;
        const c = e.id ? m.get(e.id) : undefined;
        if (e.how === "take" || e.how === "found") {
          f.holder = c ? c.index : -1;
          f.hidden = false;
          if (c) this.claim[c.index] = 0;
        } else {
          if (e.how === "deliver" && c) this.delivered[c.index]++;
          if (c) this.claim[c.index] = 0;
          f.holder = -1;
          if (e.how === "drop" && c) {
            f.droppedBy = c.index;
            f.droppedAt = m.elapsed;
          }
        }
        f.x = e.x;
        f.z = e.z;
        f.h = e.h;
        break;
      }
      case "search": {
        const c = m.get(e.id);
        if (c) this.searched[c.index].add(e.spot);
        break;
      }
      case "gate":
        this.gate = { x: e.x, z: e.z };
        break;
    }
  }

  /** The online client: the server's measures (they drift otherwise), from a snapshot. */
  setObjective(i: number, v: number): void {
    if (this.claimHold > 0) this.best[i] = v;
    else if (this.extractAt > 0 || this.ping > 0) this.held[i] = v;
    else this.delivered[i] = v;
  }
}

/** The nearest walkable cell to (x, z) within `r` metres, or −1. */
export function nearOpen(m: Match, x: number, z: number, r: number): number {
  const reach = m.reach;
  let best = -1;
  let bestD = Infinity;
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const cell = reach.cell(x + dx, z + dz);
      if (cell < 0 || !reach.ground[cell]) continue;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = cell;
      }
    }
  }
  return best;
}
