// Vehicles (SPEC-V3 §5; Phase 5): danfos, kekes and tokunbos in Free For
// All. One or two parked far from the middle at the start; a Danfo Key calls
// another to the nearest road. Two seats each: the driver steers, anyone can
// ride. The server drives them (drive.ts); a phone's copy hears where they
// are (snapshots) and what happens to them (events), and predicts only the
// car it drives.
//
//   People      pushed aside with a knock and a wobble, never hurt.
//   The sky     faster than VEHICLES.hidden, it can't see you: no exposure,
//               and a laser already coming misses.
//   Fuel        30 s of driving; beeps at 20% and 10%; empty, it stalls and
//               everyone gets out. Fuel boys by the road top it up 10 s,
//               once a match each; a Fuel Jerrycan adds 15 s.
//   Damage      impacts, hard cornering and scraping: scratched → smoking →
//               on fire → in 10–15 s it blows (the occupants thrown out and
//               down, everyone near knocked away; nobody dies of it).
//   Hijack      hold interact at the driver's door for 0.6 s: out they come,
//               stunned, dropping what they held. A slap from inside, or
//               driving off, stops it.

import { MOVE, VEHICLES, VEHICLE_KINDS, type VehicleKind } from "../../config";
import type { Rng } from "../../core/rng";
import { knock } from "../combat";
import type { Contestant } from "../core/body";
import type { Match } from "../core/match";
import type { MatchEvent, RuleModule } from "../core/module";
import type { Mover } from "../core/space";
import { carGap, carPoint, collideWorld, doorPoint, doorSide, driveCar, newCar, type Car } from "./drive";
import type { MeleeModule } from "./melee";

export type { Car } from "./drive";

/** What interact would do at a car: drive it, ride in it, pull the driver out, or get out. */
export interface CarOption {
  kind: "drive" | "ride" | "pull" | "out";
  car: number;
  seat: number;
  d: number;
}

const _m: Mover = { x: 0, z: 0, vx: 0, vz: 0, h: 0, y: 0, vy: 0, stance: 0 };

export class VehiclesModule implements RuleModule {
  readonly id = "vehicles" as const;
  readonly cars: Car[] = [];
  /** The fuel boys' stands already used (by stand). */
  used: boolean[] = [];
  private readonly count: [number, number];
  private readonly kinds: VehicleKind[];
  private rng!: Rng;
  /** When each car last bumped each body (seconds of play). */
  private bumped: Float64Array[] = [];
  /** A Danfo Key's spot, found when the key is checked, used when it's turned. */
  private called: { x: number; z: number; hd: number } | null = null;

  constructor(params: Record<string, unknown>) {
    const c = Array.isArray(params.count) ? (params.count as unknown[]).map(Number) : [1, 2];
    const lo = Math.max(0, Math.min(VEHICLES.max, Math.floor(c[0] ?? 1)));
    this.count = [lo, Math.max(lo, Math.min(VEHICLES.max, Math.floor(c[1] ?? lo)))];
    const kinds = Array.isArray(params.kinds) ? (params.kinds as unknown[]).filter((k): k is VehicleKind => VEHICLE_KINDS.includes(k as VehicleKind)) : [];
    this.kinds = kinds.length ? kinds : [...VEHICLE_KINDS];
  }

  init(m: Match): void {
    this.used = new Array(m.world.fuel?.length ?? 0).fill(false);
    this.rng = m.rng("vehicles");
    if (m.mirror) return;
    // One, or two with eight or more people, parked far from the middle of the starts.
    const n = m.contestants.length >= 8 ? this.count[1] : this.count[0];
    const from = m.world.arena ? [[m.world.arena.x, m.world.arena.z] as const] : m.world.spawns;
    let cx = 0;
    let cz = 0;
    for (const [x, z] of from) {
      cx += x / from.length;
      cz += z / from.length;
    }
    for (let i = 0; i < n; i++) {
      const spot =
        this.roadSpot(m, (x, z) => Math.hypot(x - cx, z - cz) >= VEHICLES.far && this.cars.every((c) => Math.hypot(c.x - x, c.z - z) >= VEHICLES.apart)) ??
        this.roadSpot(m, (x, z) => this.cars.every((c) => Math.hypot(c.x - x, c.z - z) >= VEHICLES.apart / 2));
      if (spot) this.add(m, this.kinds[this.rng.int(0, this.kinds.length - 1)], spot.x, spot.z, spot.hd);
    }
  }

  private add(m: Match, kind: VehicleKind, x: number, z: number, hd: number): Car {
    const h = m.world.space.floorAt(x, z, 0.3).h;
    const car = newCar(this.cars.length, kind, x, z, h, hd);
    this.cars.push(car);
    this.bumped.push(new Float64Array(m.contestants.length).fill(-99));
    m.emit({ type: "car", car: car.index, kind, x, z, h, hd });
    return car;
  }

  /**
   * A place on a road a car fits: in a lane (Nigerian roads drive on the
   * right), facing along it, on flat ground with nothing in the way and
   * nobody standing there. `ok` says where's acceptable; `near`: close to
   * someone (a Danfo Key).
   */
  private roadSpot(m: Match, ok: (x: number, z: number) => boolean, near?: { x: number; z: number }): { x: number; z: number; hd: number } | null {
    const roads = m.world.roads ?? [];
    if (!roads.length) return null;
    const rng = this.rng;
    for (let t = 0; t < 120; t++) {
      let r = roads[rng.int(0, roads.length - 1)];
      let u = rng.range(0.06, 0.94);
      if (near) {
        // The closest point of the closest road, then up or down it a little.
        let bestD = Infinity;
        for (const q of roads) {
          const len2 = (q.x1 - q.x0) ** 2 + (q.z1 - q.z0) ** 2;
          const s = Math.max(0, Math.min(1, ((near.x - q.x0) * (q.x1 - q.x0) + (near.z - q.z0) * (q.z1 - q.z0)) / len2));
          const d = Math.hypot(q.x0 + (q.x1 - q.x0) * s - near.x, q.z0 + (q.z1 - q.z0) * s - near.z);
          if (d < bestD) {
            bestD = d;
            r = q;
            u = s;
          }
        }
        const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
        u = Math.max(0.02, Math.min(0.98, u + rng.range(-35, 35) / len));
      }
      const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
      const ux = (r.x1 - r.x0) / len;
      const uz = (r.z1 - r.z0) / len;
      const lane = rng.next() < 0.5 ? 1 : -1;
      const off = Math.max(1.2, r.w / 4);
      // The right of travel along u is (uz, −ux).
      const x = r.x0 + ux * len * u + uz * off * lane;
      const z = r.z0 + uz * len * u - ux * off * lane;
      const hd = Math.atan2(ux * lane, uz * lane);
      if (!ok(x, z) || !this.fits(m, "danfo", x, z, hd)) continue;
      return { x, z, hd };
    }
    return null;
  }

  /** Room for a car here: no wall, no drop, no other car, nobody standing in it. */
  private fits(m: Match, kind: VehicleKind, x: number, z: number, hd: number): boolean {
    const probe = newCar(-1, kind, x, z, 0, hd);
    probe.h = m.world.space.floorAt(x, z, 0.3).h;
    if (Math.abs(probe.h) > 0.35) return false;
    const r = collideWorld(probe, m.world.space, x, z, hd);
    if (r.contact || Math.hypot(probe.x - x, probe.z - z) > 0.05) return false;
    const k = VEHICLES.kinds[kind];
    for (const c of this.cars) if (Math.hypot(c.x - x, c.z - z) < k.len / 2 + VEHICLES.kinds[c.kind].len / 2 + 1.5) return false;
    for (const c of m.contestants) if (c.status === "alive" && Math.hypot(c.x - x, c.z - z) < k.len / 2 + 2) return false;
    return true;
  }

  // ── Before the bodies move: the drivers drive ──

  pre(m: Match, dt: number): void {
    for (const car of this.cars) {
      // The riders' buttons: the driver's jump is the horn; anyone's swing is a slap (it stops a hijack).
      for (let s = 0; s < 2; s++) {
        const i = car.seats[s];
        if (i < 0) continue;
        const c = m.contestants[i];
        if (c.inJump !== c.jumpSeen) {
          c.jumpSeen = c.inJump;
          if (s === 0 && m.elapsed - car.hornAt >= VEHICLES.horn) {
            car.hornAt = m.elapsed;
            m.emit({ type: "horn", car: car.index });
          }
        }
        if (c.inAttack !== c.attackSeen) {
          c.attackSeen = c.inAttack;
          if (car.hijack) this.stopHijack(m, car);
        }
        c.grabSeen = c.inGrab;
      }
      if (car.state >= 4) continue;
      const d = car.seats[0] >= 0 ? m.contestants[car.seats[0]] : null;
      const power = !!d && car.fuel > 0;
      const r = driveCar(car, d ? d.inX : 0, d ? d.inZ : 0, power, dt, m.world.space);
      if (d && power && Math.hypot(d.inX, d.inZ) > VEHICLES.deadStick) {
        car.fuel = Math.max(0, car.fuel - dt);
        this.beeps(m, car);
        if (car.fuel <= 0) this.stall(m, car);
      }
      const D = VEHICLES.damage;
      let hurt = 0;
      if (r.impact > D.impact) hurt += (r.impact - D.impact) * D.perImpact;
      const lat = car.speed * Math.abs(car.turn);
      if (lat > D.lateral) hurt += D.perG * dt * (lat / D.lateral);
      if (r.contact && car.speed > 1) hurt += D.scrape * dt;
      if (r.impact > 1.5 && car.seats[0] < 0 && car.seats[1] < 0) this.alarm(m, car);
      if (hurt > 0) this.hurt(m, car, hurt);
    }
    this.carsMeet(m);
    for (const car of this.cars) if (car.state === 3 && m.elapsed >= car.blow) this.explode(m, car);
    this.hijacks(m);
    this.placeRiders(m);
  }

  // ── After the bodies move: nobody stands inside a car; the fuel boys ──

  step(m: Match): void {
    const melee = m.module<MeleeModule>("melee");
    const P = VEHICLES.push;
    for (const car of this.cars) {
      const k = VEHICLES.kinds[car.kind];
      const s = Math.sin(car.heading);
      const co = Math.cos(car.heading);
      const ex = k.wid / 2 + MOVE.radius;
      const ez = k.len / 2 + MOVE.radius;
      const reach2 = ex * ex + ez * ez;
      for (const c of m.contestants) {
        if (c.status !== "alive" || m.seated(c)) continue;
        const dx = c.x - car.x;
        const dz = c.z - car.z;
        if (dx * dx + dz * dz > reach2 || Math.abs(c.h + c.y - car.h) > 1.6) continue;
        // In the car's frame: x to its right, z to its nose.
        const lx = dx * co - dz * s;
        const lz = dx * s + dz * co;
        if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) continue;
        const px = ex - Math.abs(lx);
        const pz = ez - Math.abs(lz);
        const sx = lx >= 0 ? 1 : -1;
        const sz = lz >= 0 ? 1 : -1;
        // Out the shortest way.
        if (px < pz) {
          c.x += co * sx * px;
          c.z -= s * sx * px;
        } else {
          c.x += s * sz * pz;
          c.z += co * sz * pz;
        }
        const ran = Math.hypot(c.vx, c.vz);
        m.world.space.resolve(c, MOVE.radius);
        if (car.speed > 1.5 && lz > -k.len * 0.25 && m.elapsed - this.bumped[car.index][c.index] >= P.every) {
          // In its way: aside, to their side of it, and on along its path.
          this.bumped[car.index][c.index] = m.elapsed;
          let bx = co * sx + s * 0.6;
          let bz = -s * sx + co * 0.6;
          const bl = Math.hypot(bx, bz);
          bx /= bl;
          bz /= bl;
          const driver = car.seats[0] >= 0 ? m.contestants[car.seats[0]] : null;
          const w = driver && m.sameSquad(driver, c) ? 0 : P.wobble * Math.min(1, car.speed / k.top);
          const dist = P.knock + P.perSpeed * car.speed;
          if (melee) melee.shove(m, c, bx, bz, dist, P.stun, w);
          else knock(c, bx, bz, dist, P.stun);
          car.speed *= P.slow;
          m.emit({ type: "bump", car: car.index, tg: c.id, kx: c.vx, kz: c.vz, w: melee ? melee.wobble[c.index] : 0 });
        } else if (ran > MOVE.run + 0.5 && car.seats[0] < 0 && car.seats[1] < 0) this.alarm(m, car);
      }
    }
    // The fuel boys: stop beside one for his top-up (once a match each).
    const stands = m.world.fuel ?? [];
    for (const car of this.cars) {
      if (car.state >= 4 || car.seats[0] < 0 || car.speed >= VEHICLES.still || car.fuel >= VEHICLES.fuel.full - 0.5) continue;
      for (let j = 0; j < stands.length; j++) {
        if (this.used[j] || carGap(car, stands[j].x, stands[j].z) > VEHICLES.fuel.boyR) continue;
        this.used[j] = true;
        this.refuel(m, car, VEHICLES.fuel.boy, "boy", j);
        break;
      }
    }
  }

  /** Two cars touching: apart, and the hit costs both. */
  private carsMeet(m: Match): void {
    const list = this.cars;
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const A = list[a];
        const B = list[b];
        const ka = VEHICLES.kinds[A.kind];
        const kb = VEHICLES.kinds[B.kind];
        if (Math.hypot(A.x - B.x, A.z - B.z) > (ka.len + kb.len) / 2 + 0.5) continue;
        let best = 0;
        let nx = 0;
        let nz = 0;
        for (const oa of ka.circles) {
          const ax = A.x + Math.sin(A.heading) * oa;
          const az = A.z + Math.cos(A.heading) * oa;
          for (const ob of kb.circles) {
            const dx = B.x + Math.sin(B.heading) * ob - ax;
            const dz = B.z + Math.cos(B.heading) * ob - az;
            const d = Math.hypot(dx, dz);
            const over = ka.r + kb.r - d;
            if (over > best && d > 1e-6) {
              best = over;
              nx = dx / d;
              nz = dz / d;
            }
          }
        }
        if (best <= 0) continue;
        // A wreck doesn't move: the other takes all of it.
        const wa = A.state >= 4 ? 0 : B.state >= 4 ? 1 : 0.5;
        const wb = 1 - wa;
        A.x -= nx * best * wa;
        A.z -= nz * best * wa;
        B.x += nx * best * wb;
        B.z += nz * best * wb;
        const closing = (Math.sin(A.heading) * A.speed - Math.sin(B.heading) * B.speed) * nx + (Math.cos(A.heading) * A.speed - Math.cos(B.heading) * B.speed) * nz;
        if (closing <= 0) continue;
        for (const [C, sign] of [[A, 1], [B, -1]] as const) {
          const along = (Math.sin(C.heading) * nx + Math.cos(C.heading) * nz) * sign;
          if (along > 0) C.speed = Math.max(0, C.speed - closing * along * 0.8);
          if (C.seats[0] < 0 && C.seats[1] < 0) this.alarm(m, C);
        }
        const D = VEHICLES.damage;
        if (closing > D.impact) {
          this.hurt(m, A, (closing - D.impact) * D.perImpact * 0.7);
          this.hurt(m, B, (closing - D.impact) * D.perImpact * 0.7);
        }
      }
    }
  }

  // ── Damage ──

  private hurt(m: Match, car: Car, amount: number): void {
    if (car.state >= 3 || amount <= 0) return;
    car.damage = Math.min(100, car.damage + amount);
    const st = VEHICLES.damage.states;
    const state = car.damage >= st[2] ? 3 : car.damage >= st[1] ? 2 : car.damage >= st[0] ? 1 : 0;
    if (state <= car.state) return;
    car.state = state;
    if (state === 3) {
      const [a, b] = VEHICLES.damage.fire;
      car.blow = m.elapsed + this.rng.range(a, b);
      m.emit({ type: "wreck", car: car.index, state, blow: car.blow });
    } else m.emit({ type: "wreck", car: car.index, state });
  }

  /** It blows: the occupants thrown out and down, everyone near knocked away. Nobody dies of it. */
  private explode(m: Match, car: Car): void {
    const D = VEHICLES.damage;
    car.state = 4;
    car.speed = 0;
    car.turn = 0;
    this.stopHijack(m, car);
    m.emit({ type: "wreck", car: car.index, state: 4 });
    const melee = m.module<MeleeModule>("melee");
    const thrown = new Set<number>();
    for (let s = 0; s < 2; s++) {
      const i = car.seats[s];
      if (i < 0) continue;
      const c = m.contestants[i];
      thrown.add(i);
      this.out(m, car, c, false);
      this.away(m, car, c, D.blastKnock, D.blastWobble, melee);
      this.down(m, c, D.blastDown, "blast", melee);
    }
    for (const c of m.contestants) {
      if (c.status !== "alive" || m.seated(c) || thrown.has(c.index)) continue;
      if (Math.hypot(c.x - car.x, c.z - car.z) > D.blast || Math.abs(c.h + c.y - car.h) > 3) continue;
      this.away(m, car, c, D.blastKnock * 0.7, D.blastWobble, melee);
    }
  }

  private away(m: Match, car: Car, c: Contestant, dist: number, wobble: number, melee: MeleeModule | null): void {
    let dx = c.x - car.x;
    let dz = c.z - car.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    if (melee) melee.shove(m, c, dx, dz, dist, 0.8, wobble);
    else knock(c, dx, dz, dist, 0.8);
  }

  /** Down for `s` (melee's knockdown when there's melee: it drops what's in their hands). */
  private down(m: Match, c: Contestant, s: number, why: "hijack" | "blast" | "tumble", melee: MeleeModule | null): void {
    if (c.status !== "alive") return;
    if (melee) melee.knockdown(m, c, s, why, null);
    else {
      c.stun = Math.max(c.stun, s);
      m.emit({ type: "down", id: c.id, s, why, by: null });
    }
  }

  // ── Fuel ──

  private beeps(m: Match, car: Car): void {
    const due = this.beepsDue(car.fuel);
    if (due > car.beeps) {
      car.beeps = due;
      m.emit({ type: "fuel", car: car.index, s: car.fuel, why: "beep" });
    }
  }

  private beepsDue(fuel: number): number {
    const [a, b] = VEHICLES.fuel.beeps;
    const full = VEHICLES.fuel.full;
    return fuel <= full * b ? 2 : fuel <= full * a ? 1 : 0;
  }

  /** Empty: it stalls and everyone gets out. */
  private stall(m: Match, car: Car): void {
    car.speed = Math.min(car.speed, VEHICLES.still * 0.5);
    m.emit({ type: "fuel", car: car.index, s: 0, why: "empty" });
    for (let s = 0; s < 2; s++) if (car.seats[s] >= 0) this.out(m, car, m.contestants[car.seats[s]], false);
  }

  private refuel(m: Match, car: Car, add: number, why: "boy" | "can", stand?: number): void {
    car.fuel = Math.min(VEHICLES.fuel.full, car.fuel + add);
    car.beeps = this.beepsDue(car.fuel);
    m.emit({ type: "fuel", car: car.index, s: car.fuel, why, ...(stand !== undefined ? { stand } : {}) });
  }

  private alarm(m: Match, car: Car): void {
    if (car.state >= 4 || m.elapsed - car.alarmAt < VEHICLES.alarm) return;
    car.alarmAt = m.elapsed;
    m.emit({ type: "alarm", car: car.index });
  }

  // ── Getting in and out ──

  /** What interact would do for c at a car now (the nearest door wins), or null. */
  option(m: Match, c: Contestant): CarOption | null {
    const mine = m.seatOf(c);
    if (mine >= 0) return { kind: "out", car: mine, seat: this.cars[mine]?.seats.indexOf(c.index) ?? 0, d: -1 };
    if (c.status !== "alive" || m.module<MeleeModule>("melee")?.busy(c.index)) return null;
    let best: CarOption | null = null;
    for (const car of this.cars) {
      if (car.state >= 4 || car.speed >= VEHICLES.still) continue;
      const k = VEHICLES.kinds[car.kind];
      if (Math.hypot(car.x - c.x, car.z - c.z) > k.len / 2 + k.wid + VEHICLES.door) continue;
      if (Math.abs(c.h + c.y - car.h) > 1.2) continue;
      for (let s = 0; s < 2; s++) {
        const [dx, dz] = doorPoint(car, s);
        const d = Math.hypot(dx - c.x, dz - c.z);
        if (d > VEHICLES.door || (best && best.d <= d)) continue;
        const other = 1 - s;
        const sitting = car.seats[s];
        let opt: CarOption | null = null;
        if (sitting < 0) opt = { kind: s === 0 ? "drive" : "ride", car: car.index, seat: s, d };
        else if (s === 0 && !car.hijack && !m.sameSquad(c, m.contestants[sitting])) opt = { kind: "pull", car: car.index, seat: 0, d };
        else if (car.seats[other] < 0) opt = { kind: other === 0 ? "drive" : "ride", car: car.index, seat: other, d };
        if (opt) best = opt;
      }
    }
    return best;
  }

  reachFor(m: Match, c: Contestant): { d: number; take: () => void } | null {
    const o = this.option(m, c);
    if (!o) return null;
    const car = this.cars[o.car];
    return {
      d: o.d,
      take: () => {
        if (o.kind === "out") this.out(m, car, c, true);
        else if (o.kind === "pull") {
          car.hijack = { by: c.index, since: m.elapsed };
          m.emit({ type: "hijack", car: car.index, id: c.id, how: "start" });
        } else this.into(m, car, c, o.seat);
      },
    };
  }

  private into(m: Match, car: Car, c: Contestant, seat: number): void {
    if (car.seats[seat] >= 0 || m.seated(c)) return;
    car.seats[seat] = c.index;
    m.setSeat(c, car.index);
    c.stance = c.inStance = 0;
    c.stanceT = c.slide = 0;
    c.sprinting = false;
    c.stun = 0;
    c.y = c.vy = 0;
    this.place(car, c, seat);
    m.emit({ type: "seat", car: car.index, id: c.id, seat, x: c.x, z: c.z });
  }

  /**
   * Out by your door (or the other, or behind, or in front: wherever there's
   * room). `own`: you chose to (at speed you tumble); otherwise you were put out.
   */
  private out(m: Match, car: Car, c: Contestant, own: boolean): void {
    const seat = car.seats.indexOf(c.index);
    if (seat < 0) return;
    car.seats[seat] = -1;
    m.setSeat(c, -1);
    if (seat === 0) this.stopHijack(m, car);
    const k = VEHICLES.kinds[car.kind];
    const side = doorSide(car.kind, seat);
    const tries: [number, number][] = [
      [side * (k.wid / 2 + 0.7), k.seats[seat][1]],
      [-side * (k.wid / 2 + 0.7), k.seats[seat][1]],
      [0, -(k.len / 2 + 0.8)],
      [0, k.len / 2 + 0.8],
    ];
    let spot = carPoint(car, tries[0][0], tries[0][1]);
    for (const [lx, lz] of tries) {
      const [x, z] = carPoint(car, lx, lz);
      _m.x = x;
      _m.z = z;
      _m.vx = _m.vz = 0;
      _m.h = car.h;
      _m.y = _m.vy = 0;
      _m.stance = 0;
      m.world.space.resolve(_m, MOVE.radius);
      if (Math.hypot(_m.x - x, _m.z - z) < 0.15 && Math.abs(_m.h - car.h) < 0.5 && m.reach.at(x, z)) {
        spot = [x, z];
        break;
      }
    }
    const fast = car.speed;
    c.x = spot[0];
    c.z = spot[1];
    c.h = m.world.space.floorAt(c.x, c.z, car.h + 0.3).h;
    c.y = c.vy = 0;
    c.vx = c.vz = 0;
    c.heading = car.heading;
    m.world.space.resolve(c, MOVE.radius);
    m.emit({ type: "seat", car: car.index, id: c.id, seat: -1, x: c.x, z: c.z });
    if (own && fast > VEHICLES.still) {
      // Out at speed: a tumble on along the road.
      const melee = m.module<MeleeModule>("melee");
      knock(c, Math.sin(car.heading), Math.cos(car.heading), fast * 0.35, VEHICLES.tumble);
      this.down(m, c, VEHICLES.tumble, "tumble", melee);
    }
  }

  private stopHijack(m: Match, car: Car): void {
    const h = car.hijack;
    if (!h) return;
    car.hijack = null;
    m.emit({ type: "hijack", car: car.index, id: m.contestants[h.by].id, how: "stop" });
  }

  /** Hijacks in progress: held long enough, the driver comes out and the hijacker drives. */
  private hijacks(m: Match): void {
    const melee = m.module<MeleeModule>("melee");
    for (const car of this.cars) {
      const h = car.hijack;
      if (!h) continue;
      const by = m.contestants[h.by];
      const [dx, dz] = doorPoint(car, 0);
      const ok =
        by.status === "alive" && !m.seated(by) && m.holding(by) && car.seats[0] >= 0 && car.speed < VEHICLES.still && car.state < 4 &&
        Math.hypot(dx - by.x, dz - by.z) <= VEHICLES.door + 0.5 && !melee?.busy(by.index);
      if (!ok) {
        this.stopHijack(m, car);
        continue;
      }
      if (m.elapsed - h.since < VEHICLES.hijack.hold) continue;
      const victim = m.contestants[car.seats[0]];
      car.hijack = null;
      m.emit({ type: "hijack", car: car.index, id: by.id, how: "done" });
      this.out(m, car, victim, false);
      this.down(m, victim, VEHICLES.hijack.stun, "hijack", melee);
      this.into(m, car, by, 0);
    }
  }

  /** Riders sit where their seats are, going where the car goes. */
  placeRiders(m: Match): void {
    for (const car of this.cars) for (let s = 0; s < 2; s++) if (car.seats[s] >= 0) this.place(car, m.contestants[car.seats[s]], s);
  }

  private place(car: Car, c: Contestant, seat: number): void {
    const [lx, lz] = VEHICLES.kinds[car.kind].seats[seat];
    const [x, z] = carPoint(car, lx, lz);
    c.x = x;
    c.z = z;
    c.h = car.h;
    c.y = 0;
    c.heading = car.heading;
    c.vx = Math.sin(car.heading) * car.speed;
    c.vz = Math.cos(car.heading) * car.speed;
  }

  // ── The sky, items ──

  /** Too fast for the sky to see: in a car going faster than VEHICLES.hidden, with fuel. */
  hidden(m: Match, c: Contestant): boolean {
    const i = m.seatOf(c);
    const car = i >= 0 ? this.cars[i] : null;
    return !!car && car.state < 4 && car.fuel > 0 && car.speed > VEHICLES.hidden;
  }

  /** The car a Fuel Jerrycan would fill: the one you're in, or one beside you, not full. */
  fuelTarget(m: Match, c: Contestant): Car | null {
    const i = m.seatOf(c);
    if (i >= 0) return this.cars[i].state < 4 && this.cars[i].fuel < VEHICLES.fuel.full - 0.5 ? this.cars[i] : null;
    let best: Car | null = null;
    let bestD = 2.5;
    for (const car of this.cars) {
      if (car.state >= 4 || car.fuel >= VEHICLES.fuel.full - 0.5) continue;
      const d = carGap(car, c.x, c.z);
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    return best;
  }

  /** Can a Danfo Key call one here (fewer than VEHICLES.max cars, a road near enough)? Remembers the spot. */
  canCall(m: Match, c: Contestant): boolean {
    this.called = null;
    if (this.cars.length >= VEHICLES.max) return false;
    const [lo, hi] = VEHICLES.call;
    this.called = this.roadSpot(m, (x, z) => {
      const d = Math.hypot(x - c.x, z - c.z);
      return d >= lo && d <= hi;
    }, { x: c.x, z: c.z });
    return !!this.called;
  }

  onEvent(m: Match, e: MatchEvent): void {
    switch (e.type) {
      case "use": {
        const c = m.get(e.id);
        if (!c) break;
        if (e.kind === "jerrycan") {
          const car = this.fuelTarget(m, c);
          if (car) this.refuel(m, car, VEHICLES.fuel.can, "can");
        } else if (e.kind === "danfo-key" && this.called) {
          const s = this.called;
          this.called = null;
          this.add(m, "danfo", s.x, s.z, s.hd);
        }
        break;
      }
      case "eliminated": {
        // Out of the match from a seat (the sky got a slow car): the seat is free.
        const c = m.get(e.id);
        if (c) this.vacate(m, c);
        break;
      }
      case "down": {
        // Knocked down while pulling at a door: that's the end of it.
        const c = m.get(e.id);
        if (c) for (const car of this.cars) if (car.hijack?.by === c.index) this.stopHijack(m, car);
        break;
      }
      default:
        break;
    }
  }

  private vacate(m: Match, c: Contestant): void {
    const i = m.seatOf(c);
    if (i < 0) return;
    const car = this.cars[i];
    const s = car ? car.seats.indexOf(c.index) : -1;
    if (s >= 0) car.seats[s] = -1;
    m.setSeat(c, -1);
  }

  // ── The online client's copy ──

  apply(m: Match, e: MatchEvent): void {
    switch (e.type) {
      case "car":
        if (!this.cars[e.car]) {
          this.cars[e.car] = newCar(e.car, e.kind, e.x, e.z, e.h, e.hd);
          this.bumped[e.car] = new Float64Array(m.contestants.length).fill(-99);
        }
        break;
      case "seat": {
        const car = this.cars[e.car];
        const c = m.get(e.id);
        if (!car || !c) break;
        this.vacate(m, c);
        if (e.seat >= 0) {
          car.seats[e.seat] = c.index;
          m.setSeat(c, car.index);
          this.place(car, c, e.seat);
        } else {
          c.x = e.x;
          c.z = e.z;
          c.h = m.world.space.floorAt(e.x, e.z, car.h + 0.3).h;
          c.y = 0;
          c.vx = c.vz = 0;
        }
        break;
      }
      case "hijack": {
        const car = this.cars[e.car];
        const c = m.get(e.id);
        if (car) car.hijack = e.how === "start" && c ? { by: c.index, since: m.elapsed } : null;
        break;
      }
      case "fuel": {
        const car = this.cars[e.car];
        if (car) car.fuel = e.s;
        if (e.stand !== undefined && e.stand >= 0 && e.stand < this.used.length) this.used[e.stand] = true;
        break;
      }
      case "wreck": {
        const car = this.cars[e.car];
        if (!car) break;
        car.state = e.state;
        if (e.blow !== undefined) car.blow = e.blow;
        if (e.state >= 4) car.speed = 0;
        break;
      }
      case "horn": {
        const car = this.cars[e.car];
        if (car) car.hornAt = m.elapsed;
        break;
      }
      case "alarm": {
        const car = this.cars[e.car];
        if (car) car.alarmAt = m.elapsed;
        break;
      }
      case "eliminated": {
        const c = m.get(e.id);
        if (c) this.vacate(m, c);
        break;
      }
      default:
        break;
    }
  }
}
