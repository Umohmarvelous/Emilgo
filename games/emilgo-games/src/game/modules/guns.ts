// Guns (v4 Phase 2): Free For All becomes a shooter.
//
//   Loadout  everyone spawns (and respawns) with a pistol; an assault rifle,
//            an SMG or a shotgun is loot on the ground, in six rarities
//            (Common → Mythic: more damage, a bigger magazine). One primary
//            at a time: taking another drops yours at your feet. A body that
//            falls drops its primary.
//   Shots    hitscan from the shoulder the camera looks over, along the aim
//            (the camera's yaw and pitch), with spread: hip or aimed down the
//            sights (ADS), more on the move or in the air, plus a bloom that
//            grows each shot and drains. The target is judged where it was
//            when the shooter saw it (rewound by their lag, at most 150 ms).
//            Heads take more; damage falls off with distance; walls stop it.
//   Health   100 plus armour (plates on the ground, up to 150). Armour takes
//            70% of a hit until it's gone. Health comes back after 6 s
//            unhurt. At 0 you're out (the mode's respawn rule brings you back).
//   Melee    stays as backup: a landed blow costs health too.
//   Things   anything shootable breaks: crates (they give loot), fuel drums
//            (they blow, hurting everyone near), street props, and cars (they
//            smoke, burn and blow, and the blast hurts).
//
// Pure and shared, like every module: the server referees; the phone's copy
// (Match.mirror) applies the server's events and works out only the regen.

import { GROWTH, GUN_KINDS, GUNS, VEHICLES, type GunKind } from "../../config";
import type { ItemsModule } from "./items";
import { SpotGrid } from "../core/spotgrid";
import type { Contestant } from "../core/body";
import type { Match } from "../core/match";
import type { MatchEvent, RuleModule } from "../core/module";
import type { Rng } from "../../core/rng";
import type { MeleeModule } from "./melee";
import type { VehiclesModule } from "./vehicles";

export type PickupKind = "gun" | "ammo" | "plate";

export interface Pickup {
  readonly index: number;
  readonly kind: PickupKind;
  /** GUN_KINDS index (a gun), else −1; its rarity 0–5. */
  readonly gun: number;
  readonly rarity: number;
  readonly x: number;
  readonly z: number;
  readonly h: number;
  /** The magazine and spare rounds a dropped gun still holds (−1: full, as found). */
  readonly mag: number;
  readonly res: number;
  taken: boolean;
}

export type BreakKind = "crate" | "drum";

export interface Breakable {
  readonly index: number;
  readonly kind: BreakKind;
  readonly x: number;
  readonly z: number;
  readonly h: number;
  hp: number;
  broken: boolean;
}

/** What a shot hit, for the phone's tracer, puff and hit marker. */
export type HitKind = "none" | "wall" | "body" | "head" | "car" | "crate" | "drum" | "prop";
export const HIT_KINDS: readonly HitKind[] = ["none", "wall", "body", "head", "car", "crate", "drum", "prop"];

const PISTOL = 0;

/** A gun's numbers with its rarity in. */
export function gunStats(kind: GunKind, rarity: number): { dmg: number; mag: number } {
  const k = GUNS.kinds[kind];
  const r = Math.max(0, Math.min(5, rarity | 0));
  return { dmg: k.dmg * GUNS.rarity.dmg[r], mag: Math.round(k.mag * (1 + GUNS.rarity.mag[r])) };
}

export class GunsModule implements RuleModule {
  readonly id = "guns" as const;
  /** Royale (Naija Max): the last squad with anyone standing wins (no comebacks). */
  readonly royale: boolean;
  constructor(params: Record<string, unknown> = {}) {
    this.royale = params.royale === true;
  }
  hp: number[] = [];
  armour: number[] = [];
  /** Per body, per slot (0 the pistol, 1 the primary): GUN_KINDS index or −1, rarity, magazine, spare rounds. */
  gun: [number, number][] = [];
  rarity: [number, number][] = [];
  mag: [number, number][] = [];
  res: [number, number][] = [];
  /** The slot in hand. */
  slot: number[] = [];
  /** Seconds of play: the reload finishes (−1: none); the next shot can go; last hurt; last fired or aimed. */
  reloadAt: number[] = [];
  nextAt: number[] = [];
  /** v6: the trigger as it was last step (a semi-automatic fires on each new press), and when a held one fires next. */
  private trigWas: boolean[] = [];
  private holdAt: number[] = [];
  hurtAt: number[] = [];
  aimedAt: number[] = [];
  bloom: number[] = [];
  /** Who hurt them last (index, −1), for the kill. */
  lastBy: number[] = [];
  private rlSeen: number[] = [];
  private swSeen: number[] = [];
  readonly pickups: Pickup[] = [];
  readonly breakables: Breakable[] = [];
  /** Buckets of 32 m (the big world has thousands of each): what's near a body or along a shot, without a full scan. */
  private readonly pickupGrid = new Map<number, number[]>();
  private readonly breakGrid = new Map<number, number[]>();
  private stampN = 0;
  private stamps = new Int32Array(0);
  /** Positions for rewinding, per body: x, z, the floor + jump, stance, a ring of GUNS.histTicks. */
  private hist: Float32Array[] = [];
  private histAt = 0;
  private rng!: Rng;
  private shotRng!: Rng;

  init(m: Match): void {
    const n = m.contestants.length;
    this.rng = m.rng("guns");
    this.shotRng = m.rng("gunshots");
    for (let i = 0; i < n; i++) {
      this.hp.push(GUNS.hp);
      this.armour.push(0);
      this.gun.push([PISTOL, -1]);
      this.rarity.push([0, 0]);
      const ps = gunStats("pistol", 0);
      this.mag.push([ps.mag, -1]);
      this.res.push([GUNS.kinds.pistol.reserve, 0]);
      this.slot.push(0);
      this.reloadAt.push(-1);
      this.nextAt.push(0);
      this.trigWas.push(false);
      this.holdAt.push(0);
      this.hurtAt.push(-99);
      this.aimedAt.push(-99);
      this.bloom.push(0);
      this.lastBy.push(-1);
      this.rlSeen.push(0);
      this.swSeen.push(0);
      this.hist.push(new Float32Array(GUNS.histTicks * 4));
    }
    this.scatter(m);
  }

  /** Loot and breakables, from the match's seed (the copy places the same). */
  private scatter(m: Match): void {
    const b = m.world.space.bounds;
    // The big world (v4 Naija Max) gets half the density: the same fights, more room between them.
    const raw = ((b.x1 - b.x0) * (b.z1 - b.z0)) / 10000;
    const area = raw > 100 ? raw * 0.5 : raw;
    const reach = m.reach;
    if (!reach.open.length) return;
    const rng = this.rng;
    const spots = new SpotGrid(8);
    const place = (minGap: number): [number, number, number] | null => {
      for (let t = 0; t < 30; t++) {
        const cell = reach.open[rng.int(0, reach.open.length - 1)];
        if (!reach.ground[cell]) continue;
        const [x, z] = reach.centre(cell);
        if (spots.any(x, z, minGap, (sx, sz) => Math.hypot(sx - x, sz - z) < minGap)) continue;
        spots.add(x, z);
        return [x, z, reach.h[cell]];
      }
      return null;
    };
    const L = GUNS.loot;
    const count = (per: number) => Math.max(1, Math.round(per * area));
    for (let k = 0; k < count(L.guns); k++) {
      const p = place(6);
      if (p) this.addPickup("gun", 1 + rng.int(0, 2), this.rollRarity(rng), p[0], p[1], p[2]);
    }
    for (let k = 0; k < count(L.ammo); k++) {
      const p = place(4);
      if (p) this.addPickup("ammo", -1, 0, p[0], p[1], p[2]);
    }
    for (let k = 0; k < count(L.plates); k++) {
      const p = place(4);
      if (p) this.addPickup("plate", -1, 0, p[0], p[1], p[2]);
    }
    for (let k = 0; k < count(L.crates); k++) {
      const p = place(3);
      if (p) this.breakables.push({ index: this.breakables.length, kind: "crate", x: p[0], z: p[1], h: p[2], hp: GUNS.crate.hp, broken: false });
    }
    for (let k = 0; k < count(L.drums); k++) {
      const p = place(8);
      if (p) this.breakables.push({ index: this.breakables.length, kind: "drum", x: p[0], z: p[1], h: p[2], hp: GUNS.drum.hp, broken: false });
    }
    for (const b of this.breakables) bucket(this.breakGrid, b.x, b.z).push(b.index);
    this.stamps = new Int32Array(this.breakables.length);
  }

  private rollRarity(rng: Rng): number {
    const odds = GUNS.rarity.odds;
    let total = 0;
    for (const o of odds) total += o;
    let v = rng.next() * total;
    for (let r = 0; r < odds.length; r++) {
      v -= odds[r];
      if (v < 0) return r;
    }
    return 0;
  }

  private addPickup(kind: PickupKind, gun: number, rarity: number, x: number, z: number, h: number, mag = -1, res = -1): Pickup {
    const p: Pickup = { index: this.pickups.length, kind, gun, rarity, x, z, h, mag, res, taken: false };
    this.pickups.push(p);
    bucket(this.pickupGrid, x, z).push(p.index);
    return p;
  }

  /** A new pickup in play (a dropped gun, a crate's gift): everyone's copy adds it. */
  private drop(m: Match, kind: PickupKind, gun: number, rarity: number, x: number, z: number, h: number, mag = -1, res = -1): void {
    const p = this.addPickup(kind, gun, rarity, x, z, h, mag, res);
    m.emit({ type: "pick", p: p.index, kind, g: gun, r: rarity, x, z, h, mag, res });
  }

  // ── Each step ──

  step(m: Match, dt: number): void {
    const t = m.elapsed;
    const k = this.histAt++ % GUNS.histTicks;
    for (const c of m.contestants) {
      const h = this.hist[c.index];
      h[k * 4] = c.x;
      h[k * 4 + 1] = c.z;
      h[k * 4 + 2] = c.h + c.y;
      h[k * 4 + 3] = c.stance;
    }
    for (const c of m.contestants) {
      const i = c.index;
      const a = m.aims[i];
      if (c.status !== "alive") {
        this.rlSeen[i] = a.reload;
        this.swSeen[i] = a.swap;
        continue;
      }
      this.regen(t, i, dt);
      const kind = GUN_KINDS[this.gun[i][this.slot[i]]] ?? "pistol";
      const K = GUNS.kinds[kind];
      this.bloom[i] = Math.max(0, this.bloom[i] - K.drain * dt);
      if (m.seated(c)) {
        this.rlSeen[i] = a.reload;
        this.swSeen[i] = a.swap;
        continue;
      }
      // Swap: to the other slot (if it has a gun); a reload in progress stops.
      if (a.swap !== this.swSeen[i]) {
        this.swSeen[i] = a.swap;
        const other = 1 - this.slot[i];
        if (this.gun[i][other] >= 0) {
          this.slot[i] = other;
          this.reloadAt[i] = -1;
          this.nextAt[i] = Math.max(this.nextAt[i], t + 0.35);
          m.emit({ type: "swap", id: c.id, s: other });
        }
      }
      const s = this.slot[i];
      // Reload: asked for, or the trigger on an empty magazine.
      const wantReload = a.reload !== this.rlSeen[i];
      this.rlSeen[i] = a.reload;
      const full = gunStats(kind, this.rarity[i][s]).mag;
      if (this.reloadAt[i] < 0 && this.res[i][s] > 0 && this.mag[i][s] < full && (wantReload || (a.trigger && this.mag[i][s] <= 0))) {
        this.reloadAt[i] = t + K.reload;
        m.emit({ type: "reload", id: c.id, how: "start", s, mag: this.mag[i][s], res: this.res[i][s], at: this.reloadAt[i] });
      }
      if (this.reloadAt[i] >= 0 && t >= this.reloadAt[i]) {
        this.reloadAt[i] = -1;
        const take = Math.min(full - this.mag[i][s], this.res[i][s]);
        this.mag[i][s] += take;
        this.res[i][s] -= take;
        m.emit({ type: "reload", id: c.id, how: "done", s, mag: this.mag[i][s], res: this.res[i][s], at: t });
      }
      if (a.trigger || a.ads) this.aimedAt[i] = t;
      // Aiming or firing, the body turns to the aim (not mid-swing: a blow keeps its own facing).
      if (t - this.aimedAt[i] < 0.8 && c.act <= 0) c.heading = a.yaw + Math.PI;
      // v6: semi-automatic guns (the pistol, the shotgun) fire once a press; held, single shots at their `hold` rate.
      const pressed = a.trigger && !this.trigWas[i];
      this.trigWas[i] = a.trigger;
      const ready = K.hold <= 0 || pressed || t >= this.holdAt[i];
      if (a.trigger && ready && this.reloadAt[i] < 0 && this.mag[i][s] > 0 && t >= this.nextAt[i]) {
        const melee = m.module<MeleeModule>("melee");
        // Knocked down or held: no shooting.
        if (!melee || (!melee.isDown(i) && melee.heldBy[i] < 0)) this.fire(m, c, kind, s);
      }
    }
  }

  private regen(t: number, i: number, dt: number): void {
    if (this.hp[i] < GUNS.hp && t - this.hurtAt[i] >= GUNS.regen.after) this.hp[i] = Math.min(GUNS.hp, this.hp[i] + GUNS.regen.rate * dt);
  }

  /** The copy: health comes back on its own (the server's next hit carries the true value). */
  view(m: Match, dt: number): void {
    for (const c of m.contestants) if (c.status === "alive") this.regen(m.elapsed, c.index, dt);
  }

  /** The eye a shot leaves from: the shoulder the camera looks over, as the phone's camera has it. */
  muzzle(m: Match, c: Contestant, out: [number, number, number]): [number, number, number] {
    const a = m.aims[c.index];
    const eye = GUNS.eye[c.stance] ?? GUNS.eye[0];
    out[0] = c.x + Math.cos(a.yaw) * GUNS.shoulder;
    out[1] = c.h + c.y * 0.85 + eye;
    out[2] = c.z - Math.sin(a.yaw) * GUNS.shoulder;
    return out;
  }

  private fire(m: Match, c: Contestant, kind: GunKind, s: number): void {
    const i = c.index;
    const t = m.elapsed;
    const K = GUNS.kinds[kind];
    const a = m.aims[i];
    this.nextAt[i] = t + 1 / K.rate;
    if (K.hold > 0) this.holdAt[i] = t + 1 / K.hold;
    this.mag[i][s]--;
    const moving = Math.hypot(c.vx, c.vz) > 0.6;
    const spread = (a.ads ? K.ads : K.hip) * (c.stance === 1 ? 0.8 : c.stance === 2 ? 0.6 : 1) + (moving ? K.move : 0) + (c.y > 0.05 ? K.move * 2 : 0) + this.bloom[i];
    this.bloom[i] = Math.min(K.most, this.bloom[i] + K.bloom);
    const [ox, oy, oz] = this.muzzle(m, c, _o);
    const dmg = gunStats(kind, this.rarity[i][s]).dmg;
    const lag = Math.min(GUNS.rewind, c.graceBonus);
    // Every pellet's damage per target, added up: one hit per target a shot.
    _dealt.clear();
    let end: [number, number, number] = [ox, oy, oz];
    let first: HitKind = "none";
    for (let p = 0; p < K.pellets; p++) {
      const ang = this.shotRng.next() * Math.PI * 2;
      const rad = spread * Math.sqrt(this.shotRng.next());
      const yaw = a.yaw + (Math.cos(ang) * rad) / Math.max(0.3, Math.cos(a.pitch));
      const pitch = a.pitch + Math.sin(ang) * rad;
      const cp = Math.cos(pitch);
      const dx = -Math.sin(yaw) * cp;
      const dy = -Math.sin(pitch);
      const dz = -Math.cos(yaw) * cp;
      const hit = this.trace(m, c, ox, oy, oz, dx, dy, dz, K.range, lag);
      const d = hit.t;
      const fall = d <= K.near ? 1 : d >= K.far ? K.low : 1 - ((d - K.near) / (K.far - K.near)) * (1 - K.low);
      const amount = dmg * fall;
      if (p === 0) {
        end = [ox + dx * d, oy + dy * d, oz + dz * d];
        first = hit.kind;
      }
      if (hit.kind === "body" || hit.kind === "head") {
        const key = hit.index;
        const prev = _dealt.get(key);
        const v = amount * (hit.kind === "head" ? K.head : 1);
        _dealt.set(key, { v: (prev?.v ?? 0) + v, head: (prev?.head ?? false) || hit.kind === "head" });
      } else if (hit.kind === "car") this.cars(m)?.hurt(m, this.cars(m)!.cars[hit.index], amount * GUNS.car.perDmg);
      else if (hit.kind === "crate" || hit.kind === "drum") this.hitThing(m, c, this.breakables[hit.index], amount);
      else if (hit.kind === "prop") m.module<MeleeModule>("melee")?.shatter(m, hit.index, c);
      if (p === 0 && (hit.kind === "body" || hit.kind === "head") && K.pellets > 1) first = hit.kind;
    }
    m.emit({ type: "fire", id: c.id, g: GUN_KINDS.indexOf(kind), x: end[0], y: end[1], z: end[2], hit: HIT_KINDS.indexOf(first), mag: this.mag[i][s] });
    for (const [j, d] of _dealt) this.hurt(m, m.contestants[j], d.v, c, d.head, kind);
  }

  private cars(m: Match): VehiclesModule | null {
    return m.module<VehiclesModule>("vehicles");
  }

  /** The first thing a ray meets: a wall, a rival (rewound by `lag`), a car, a crate or drum, a street prop. */
  private trace(m: Match, me: Contestant, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, range: number, lag: number): { t: number; kind: HitKind; index: number } {
    let best = m.world.space.ray(ox, oy, oz, dx, dy, dz, range);
    let kind: HitKind = best < range ? "wall" : "none";
    let index = -1;
    const back = Math.min(GUNS.histTicks - 1, Math.round(lag * 60));
    const slot = (((this.histAt - 1 - back) % GUNS.histTicks) + GUNS.histTicks) % GUNS.histTicks;
    const B = GUNS.body;
    for (const o of m.contestants) {
      if (o === me || o.status !== "alive" || m.seated(o) || m.sameSquad(me, o)) continue;
      const h = this.hist[o.index];
      const x = back > 0 ? h[slot * 4] : o.x;
      const z = back > 0 ? h[slot * 4 + 1] : o.z;
      const base = back > 0 ? h[slot * 4 + 2] : o.h + o.y;
      const st = back > 0 ? h[slot * 4 + 3] : o.stance;
      // Quick reject: the ray's closest pass to the body's axis.
      const ex = x - ox;
      const ez = z - oz;
      const along = ex * dx + ez * dz;
      if (along < 0 || along > best + 1) continue;
      const top = base + (st === 2 ? 0.55 : st === 1 ? 1.15 : 1.75);
      const r = st === 2 ? B.proneR : B.r;
      // The head first (it's on top of the body): a ball.
      const hy = top - B.head;
      const th = sphere(ox, oy, oz, dx, dy, dz, x, hy, z, B.head);
      if (th >= 0 && th < best) {
        best = th;
        kind = "head";
        index = o.index;
      }
      const tb = cylinder(ox, oy, oz, dx, dy, dz, x, z, r, base, top - B.head * 2);
      if (tb >= 0 && tb < best) {
        best = tb;
        kind = "body";
        index = o.index;
      }
    }
    // The crates and drums in the buckets along the shot (its box in x and z).
    const ex = ox + dx * best;
    const ez = oz + dz * best;
    const q0 = Math.floor(Math.min(ox, ex) / BUCKET);
    const q1 = Math.floor(Math.max(ox, ex) / BUCKET);
    const r0 = Math.floor(Math.min(oz, ez) / BUCKET);
    const r1 = Math.floor(Math.max(oz, ez) / BUCKET);
    const stamp = ++this.stampN;
    for (let q = q0; q <= q1; q++) {
      for (let r = r0; r <= r1; r++) {
        const list = this.breakGrid.get(key(q, r));
        if (!list) continue;
        for (const bi of list) {
          if (this.stamps[bi] === stamp) continue;
          this.stamps[bi] = stamp;
          const b = this.breakables[bi];
          if (b.broken) continue;
          const tt = b.kind === "crate" ? box(ox, oy, oz, dx, dy, dz, b.x, b.z, b.h, 0, GUNS.crate.half, GUNS.crate.half, GUNS.crate.half * 2, best) : cylinderT(ox, oy, oz, dx, dy, dz, b.x, b.z, GUNS.drum.r, b.h, b.h + GUNS.drum.tall, best);
          if (tt < best) {
            best = tt;
            kind = b.kind;
            index = b.index;
          }
        }
      }
    }
    const cars = this.cars(m)?.cars ?? [];
    for (const car of cars) {
      if (car.state >= 4) continue;
      const kk = VEHICLES.kinds[car.kind];
      const tall = car.kind === "danfo" ? 2.1 : car.kind === "keke" ? 1.7 : 1.45;
      const tc = box(ox, oy, oz, dx, dy, dz, car.x, car.z, car.h, car.heading, kk.wid / 2, kk.len / 2, tall, best);
      if (tc < best) {
        best = tc;
        kind = "car";
        index = car.index;
      }
    }
    const props = m.module<MeleeModule>("melee")?.props ?? [];
    for (const p of props) {
      if (p.holder !== -1) continue;
      const tp = sphere(ox, oy, oz, dx, dy, dz, p.x, p.h + 0.35, p.z, 0.4);
      if (tp >= 0 && tp < best) {
        best = tp;
        kind = "prop";
        index = p.index;
      }
    }
    return { t: best, kind, index };
  }

  /** Damage on a body (a shot, a blow, a blast): armour first, then health; out at 0. */
  /** `bare`: through armour and growth (v6: the zone's gas). */
  hurt(m: Match, c: Contestant, amount: number, by: Contestant | null, head: boolean, how: string, bare = false): void {
    const i = c.index;
    if (c.status !== "alive" || amount <= 0 || m.seated(c)) return;
    // v5: grown on Titan Serum, every hit takes less.
    if (!bare) amount *= GROWTH.take[m.module<ItemsModule>("items")?.growth[i] ?? 0] ?? 1;
    let left = amount;
    if (this.armour[i] > 0 && !bare) {
      const a = Math.min(this.armour[i], amount * GUNS.armour.share);
      this.armour[i] -= a;
      left -= a;
    }
    this.hp[i] = Math.max(0, this.hp[i] - left);
    this.hurtAt[i] = m.elapsed;
    if (by) this.lastBy[i] = by.index;
    m.emit({ type: "dmg", tg: c.id, by: by?.id ?? null, hp: Math.round(this.hp[i] * 10) / 10, ar: Math.round(this.armour[i] * 10) / 10, head, amt: Math.round(amount * 10) / 10 });
    if (this.hp[i] <= 0) {
      const killer = by ?? (this.lastBy[i] >= 0 ? m.contestants[this.lastBy[i]] : null);
      m.emit({ type: "kill", tg: c.id, by: killer?.id ?? null, how, head });
      m.eliminate(c, how === "blast" ? "blast" : how === "zone" ? "zone" : "shot");
    }
  }

  private hitThing(m: Match, by: Contestant, b: Breakable, amount: number): void {
    if (b.broken) return;
    b.hp -= amount;
    if (b.hp > 0) return;
    b.broken = true;
    m.emit({ type: "brk", b: b.index, by: by.id, x: b.x, z: b.z, h: b.h });
    if (b.kind === "drum") this.blast(m, b.x, b.h + 0.5, b.z, GUNS.drum.blast, GUNS.drum.blastDmg, by);
    else {
      // A crate gives: ammo, a plate or (rarely) a gun.
      const g = GUNS.loot.crateGives;
      const v = this.shotRng.next();
      if (v < g[0]) this.drop(m, "ammo", -1, 0, b.x, b.z, b.h);
      else if (v < g[0] + g[1]) this.drop(m, "plate", -1, 0, b.x, b.z, b.h);
      else this.drop(m, "gun", 1 + this.shotRng.int(0, 2), Math.min(5, this.rollRarity(this.shotRng) + 1), b.x, b.z, b.h);
    }
  }

  /** A blast: damage falling from `dmg` at its heart to nothing at `r` (walls between shield), other drums go up too. */
  private blast(m: Match, x: number, y: number, z: number, r: number, dmg: number, by: Contestant | null): void {
    for (const c of m.contestants) {
      if (c.status !== "alive") continue;
      const d = Math.hypot(c.x - x, c.h + 1 - y, c.z - z);
      if (d >= r || !m.world.space.lineClear(x, z, c.x, c.z, y)) continue;
      this.hurt(m, c, dmg * (1 - d / r), by, false, "blast");
    }
    for (const b of this.breakables) {
      if (b.broken || Math.hypot(b.x - x, b.z - z) >= r) continue;
      if (by) this.hitThing(m, by, b, b.kind === "drum" ? 999 : dmg);
    }
  }

  // ── Events: blows, wrecks, deaths and comebacks ──

  onEvent(m: Match, e: MatchEvent): void {
    if (m.mirror) return;
    if (e.type === "hit") {
      const tg = m.get(e.tg);
      const by = m.get(e.id);
      const v = GUNS.melee[e.kind] ?? 0;
      if (tg && v > 0) this.hurt(m, tg, v, by ?? null, false, "melee");
    } else if (e.type === "wreck" && e.state === 4) {
      const car = this.cars(m)?.cars[e.car];
      if (car) {
        // Whoever shot it last gets the blast's kills.
        this.blast(m, car.x, (car.h) + 1, car.z, GUNS.car.blast, GUNS.car.blastDmg, null);
      }
    } else if (e.type === "eliminated") {
      const c = m.get(e.id);
      if (!c) return;
      const i = c.index;
      if (this.royale) this.lastStanding(m);
      // Their primary falls where they fell.
      if (this.gun[i][1] >= 0) this.drop(m, "gun", this.gun[i][1], this.rarity[i][1], e.x, e.z, e.h, this.mag[i][1], this.res[i][1]);
      if (this.armour[i] >= GUNS.armour.plate) this.drop(m, "plate", -1, 0, e.x + 0.6, e.z, e.h);
    } else if (e.type === "respawn") this.fresh(m, e.id);
    else if (e.type === "take") this.itemArmour(m, e.id);
  }

  /** Every item taken into the backpack is armour too (the copy does the same from the event). */
  private itemArmour(m: Match, id: string): void {
    const c = m.get(id);
    if (c) this.armour[c.index] = Math.min(GUNS.armour.max, this.armour[c.index] + GUNS.armour.item);
  }

  /** Royale: one squad left with anyone alive is the winner (its first alive member named). */
  private lastStanding(m: Match): void {
    if (m.winner || m.phase !== "play") return;
    let squad = -1;
    let who: Contestant | null = null;
    for (const c of m.contestants) {
      if (c.status !== "alive") continue;
      const q = m.squads[c.index];
      if (squad === -1) {
        squad = q;
        who = c;
      } else if (q !== squad) return;
    }
    if (who) m.win(who, squad);
  }

  /** Back in: full health, no armour, a pistol and nothing else. */
  private fresh(m: Match, id: string): void {
    const c = m.get(id);
    if (!c) return;
    const i = c.index;
    this.hp[i] = GUNS.hp;
    this.armour[i] = 0;
    this.gun[i] = [PISTOL, -1];
    this.rarity[i] = [0, 0];
    this.mag[i] = [gunStats("pistol", 0).mag, -1];
    this.res[i] = [GUNS.kinds.pistol.reserve, 0];
    this.slot[i] = 0;
    this.reloadAt[i] = -1;
    this.bloom[i] = 0;
    this.lastBy[i] = -1;
  }

  /** Interact: the nearest pickup in reach. */
  reachFor(m: Match, c: Contestant): { d: number; take: () => void } | null {
    let best: Pickup | null = null;
    let bd: number = GUNS.reach;
    for (const pi of this.near(this.pickupGrid, c.x, c.z)) {
      const p = this.pickups[pi];
      if (p.taken || Math.abs(p.h - c.h) > 1.5) continue;
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best) return null;
    const p = best;
    return { d: bd, take: () => this.take(m, c, p) };
  }

  /** Walking over ammo or a plate takes it; a gun needs the interact button. */
  pre(m: Match): void {
    for (const c of m.contestants) {
      if (c.status !== "alive" || m.seated(c)) continue;
      for (const pi of this.nearR(this.pickupGrid, c.x, c.z, 1.1)) {
        const p = this.pickups[pi];
        if (p.taken || p.kind === "gun" || Math.abs(p.h - c.h) > 1.5) continue;
        if (Math.hypot(p.x - c.x, p.z - c.z) > 1.1) continue;
        if (p.kind === "plate" && this.armour[c.index] >= GUNS.armour.max) continue;
        this.take(m, c, p);
      }
    }
  }

  /** The indices in the buckets within r of (x, z) (usually one: a walk-over pickup is a step away). */
  private nearR(grid: Map<number, number[]>, x: number, z: number, r: number): number[] {
    _near.length = 0;
    const q0 = Math.floor((x - r) / BUCKET);
    const q1 = Math.floor((x + r) / BUCKET);
    const r0 = Math.floor((z - r) / BUCKET);
    const r1 = Math.floor((z + r) / BUCKET);
    for (let q = q0; q <= q1; q++) for (let w = r0; w <= r1; w++) {
      const list = grid.get(key(q, w));
      if (list) for (const i of list) _near.push(i);
    }
    return _near;
  }

  /** The indices in (x, z)'s bucket and its neighbours. */
  private near(grid: Map<number, number[]>, x: number, z: number): number[] {
    _near.length = 0;
    const q = Math.floor(x / BUCKET);
    const r = Math.floor(z / BUCKET);
    for (let dq = -1; dq <= 1; dq++) for (let dr = -1; dr <= 1; dr++) {
      const list = grid.get(key(q + dq, r + dr));
      if (list) for (const i of list) _near.push(i);
    }
    return _near;
  }

  private take(m: Match, c: Contestant, p: Pickup): void {
    if (p.taken) return;
    const i = c.index;
    p.taken = true;
    if (p.kind === "ammo") {
      for (let s = 0; s < 2; s++) {
        const g = this.gun[i][s];
        if (g < 0) continue;
        const K = GUNS.kinds[GUN_KINDS[g]];
        this.res[i][s] = Math.min(Math.round(K.reserve * 1.5), this.res[i][s] + gunStats(GUN_KINDS[g], this.rarity[i][s]).mag * 2);
      }
    } else if (p.kind === "plate") this.armour[i] = Math.min(GUNS.armour.max, this.armour[i] + GUNS.armour.plate);
    else {
      // One primary: yours drops at your feet.
      if (this.gun[i][1] >= 0) this.drop(m, "gun", this.gun[i][1], this.rarity[i][1], c.x + Math.sin(c.heading) * 0.7, c.z + Math.cos(c.heading) * 0.7, c.h, this.mag[i][1], this.res[i][1]);
      const kind = GUN_KINDS[p.gun];
      this.gun[i][1] = p.gun;
      this.rarity[i][1] = p.rarity;
      this.mag[i][1] = p.mag >= 0 ? p.mag : gunStats(kind, p.rarity).mag;
      this.res[i][1] = p.res >= 0 ? p.res : GUNS.kinds[kind].reserve;
      this.slot[i] = 1;
      this.reloadAt[i] = -1;
    }
    m.emit({ type: "ptake", p: p.index, id: c.id, hp: Math.round(this.hp[i]), ar: Math.round(this.armour[i]), g1: this.gun[i][1], r1: this.rarity[i][1], mag: this.mag[i][1], res: this.res[i][1], res0: this.res[i][0] });
  }

  // ── The copy (online): the server's events ──

  apply(m: Match, e: MatchEvent): void {
    switch (e.type) {
      case "fire": {
        const c = m.get(e.id);
        if (!c) return;
        const s = this.slot[c.index];
        this.mag[c.index][s] = e.mag;
        this.aimedAt[c.index] = m.elapsed;
        break;
      }
      case "dmg": {
        const c = m.get(e.tg);
        if (!c) return;
        this.hp[c.index] = e.hp;
        this.armour[c.index] = e.ar;
        this.hurtAt[c.index] = m.elapsed;
        break;
      }
      case "reload": {
        const c = m.get(e.id);
        if (!c) return;
        this.reloadAt[c.index] = e.how === "start" ? e.at : -1;
        this.mag[c.index][e.s] = e.mag;
        this.res[c.index][e.s] = e.res;
        break;
      }
      case "swap": {
        const c = m.get(e.id);
        if (c) {
          this.slot[c.index] = e.s;
          this.reloadAt[c.index] = -1;
        }
        break;
      }
      case "pick":
        while (this.pickups.length < e.p) this.addPickup("ammo", -1, 0, 0, 0, -99).taken = true;
        if (this.pickups.length === e.p) this.addPickup(e.kind, e.g, e.r, e.x, e.z, e.h, e.mag, e.res);
        break;
      case "ptake": {
        const p = this.pickups[e.p];
        if (p) p.taken = true;
        const c = m.get(e.id);
        if (!c) return;
        const i = c.index;
        this.hp[i] = e.hp;
        this.armour[i] = e.ar;
        if (p?.kind === "gun") {
          this.gun[i][1] = e.g1;
          this.rarity[i][1] = e.r1;
          this.slot[i] = 1;
        }
        this.mag[i][1] = e.mag;
        this.res[i][1] = e.res;
        this.res[i][0] = e.res0;
        break;
      }
      case "brk": {
        const b = this.breakables[e.b];
        if (b) {
          b.broken = true;
          b.hp = 0;
        }
        break;
      }
      case "respawn":
        this.fresh(m, e.id);
        break;
      case "take":
        this.itemArmour(m, e.id);
        break;
    }
  }
}

const _o: [number, number, number] = [0, 0, 0];
const _near: number[] = [];
const BUCKET = 32;
const key = (q: number, r: number) => (q + 1024) * 4096 + (r + 1024);
function bucket(grid: Map<number, number[]>, x: number, z: number): number[] {
  const k = key(Math.floor(x / BUCKET), Math.floor(z / BUCKET));
  let list = grid.get(k);
  if (!list) grid.set(k, (list = []));
  return list;
}
const _dealt = new Map<number, { v: number; head: boolean }>();

/** Ray vs ball: the entry distance, or −1. */
function sphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number {
  const lx = ox - cx;
  const ly = oy - cy;
  const lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : -1;
}

/** Ray vs an upright cylinder from y0 to y1: the entry distance through its side, or −1. */
function cylinder(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cz: number, r: number, y0: number, y1: number): number {
  const lx = ox - cx;
  const lz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return -1;
  const b = lx * dx + lz * dz;
  const c = lx * lx + lz * lz - r * r;
  const disc = b * b - a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < 0) return -1;
  const y = oy + dy * t;
  return y >= y0 && y <= y1 ? t : -1;
}

function cylinderT(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cz: number, r: number, y0: number, y1: number, max: number): number {
  const t = cylinder(ox, oy, oz, dx, dy, dz, cx, cz, r, y0, y1);
  return t >= 0 && t < max ? t : max;
}

/** Ray vs a box on the ground turned by `rot` (its +z along heading (sin, cos)): the entry distance, or `max`. */
function box(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cz: number, y0: number, rot: number, hx: number, hz: number, tall: number, max: number): number {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const px = ox - cx;
  const pz = oz - cz;
  // Into the box's frame: its +z is (sin rot, cos rot).
  const lx = px * c - pz * s;
  const lz = px * s + pz * c;
  const ldx = dx * c - dz * s;
  const ldz = dx * s + dz * c;
  let t0 = 0;
  let t1 = max;
  const axes: [number, number, number, number][] = [
    [lx, ldx, -hx, hx],
    [oy, dy, y0, y0 + tall],
    [lz, ldz, -hz, hz],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return max;
      continue;
    }
    let u = (lo - o) / d;
    let v = (hi - o) / d;
    if (u > v) [u, v] = [v, u];
    if (u > t0) t0 = u;
    if (v < t1) t1 = v;
    if (t0 > t1) return max;
  }
  return t0;
}
