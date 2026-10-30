// Vehicles (SPEC-V3 §5, Phase 5): where they start, how they drive, what they
// do to people, the sky, fuel and the fuel boys, damage and the blast, the
// hijack, the items, and the phone's copy keeping step. Headless, on Naija
// World, as the server runs it.
//
//   node server/build-tools.mjs && node server/dist/cartest.mjs

import { VEHICLES, type VehicleKind } from "../../src/config";
import { BUILTIN_MANIFEST } from "../../src/content/modes";
import type { Contestant } from "../../src/game/core/body";
import { Match, settingsOf, type MatchSettings } from "../../src/game/core/match";
import type { MatchEvent } from "../../src/game/core/module";
import { Space } from "../../src/game/core/space";
import { carPoint, doorPoint, type Car } from "../../src/game/modules/drive";
import type { FlagsModule } from "../../src/game/modules/flags";
import type { ItemsModule } from "../../src/game/modules/items";
import type { MeleeModule } from "../../src/game/modules/melee";
import type { VehiclesModule } from "../../src/game/modules/vehicles";
import type { ZoneModule } from "../../src/game/modules/zone";
import { matchWorldOf } from "../../src/maps/open/matchWorld";
import { buildNaijaWorld, SURFACE_OF } from "../../src/maps/open/naija";

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures++;
}

const DT = 1 / 60;
const layout = buildNaijaWorld();
const space = new Space(layout.solids, { x0: -layout.half, z0: -layout.half, x1: layout.half, z1: layout.half }, (x, z) => SURFACE_OF[layout.groundAt(x, z)]);
const world = matchWorldOf(layout, space);
const def = (id: string) => BUILTIN_MANIFEST.modes.find((m) => m.id === id)!;
const EAST = Math.PI / 2;

function mode(id: string, patch: (s: MatchSettings) => void = () => {}): MatchSettings {
  const s = settingsOf(def(id));
  patch(s);
  return s;
}
/** No zone, no Airfall, a long clock. */
const bare = (id = "find-the-flag", extra: (s: MatchSettings) => void = () => {}) =>
  mode(id, (s) => {
    delete s.modules.zone;
    delete s.modules.airfall;
    s.time = 900;
    extra(s);
  });
function newMatch(seed: number, settings: MatchSettings, n = 12, squads?: number[]): Match {
  return new Match({ seed, world, settings, contestants: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, bot: false, ...(squads ? { squad: squads[i] } : {}) })) });
}
function toPlay(m: Match): void {
  let g = 0;
  while (m.phase !== "play" && g++ < 1e5) {
    m.step(DT);
    m.drain();
  }
}
function runFor(m: Match, s: number, out: MatchEvent[] = [], each?: () => void): MatchEvent[] {
  toPlay(m);
  const end = m.elapsed + s;
  let g = 0;
  while (m.elapsed < end - 1e-9 && !m.over && g++ < 2e6) {
    each?.();
    m.step(DT);
    out.push(...m.drain());
  }
  return out;
}
function put(m: Match, id: string, x: number, z: number, heading = 0): Contestant {
  const c = m.get(id)!;
  c.x = x;
  c.z = z;
  c.vx = c.vz = 0;
  c.inX = c.inZ = 0;
  c.h = space.floorAt(x, z, 0).h;
  c.y = c.vy = 0;
  c.heading = heading;
  return c;
}
/** Everyone not named, far away in a quiet corner. */
function clear(m: Match, keep: string[]): void {
  let k = 0;
  for (const c of m.contestants) if (!keep.includes(c.id)) put(m, c.id, -170 + (k % 6) * 4, 170 + Math.floor(k++ / 6) * 4);
}
const veh = (m: Match) => m.module<VehiclesModule>("vehicles")!;
/** A car of `kind`, parked here (the module's own way in, for a test). */
function park(m: Match, kind: VehicleKind, x: number, z: number, heading: number): Car {
  const v = veh(m) as unknown as { add(m: Match, k: VehicleKind, x: number, z: number, hd: number): Car };
  const car = v.add(m, kind, x, z, heading);
  m.drain();
  return car;
}
/** Everything else on the map out of the way: the cars the match parked go to the far corner. */
function noOtherCars(m: Match, keep: Car[]): void {
  let k = 0;
  for (const car of veh(m).cars) {
    if (keep.includes(car)) continue;
    car.x = 150 + k * 8;
    car.z = 185;
    k++;
  }
}
let press = 0;
/** A new interact tap (the counter skips 0, which reads as "never pressed"). */
const tap = (m: Match, id: string, hold = false) => m.setInteract(id, (press = (press % 255) + 1), hold);
const holdOn = (m: Match, id: string) => m.setInteract(id, press & 255, true);
let atk = 0;
const slap = (m: Match, id: string) => m.setActions(id, ((++atk & 63) << 2) | 2, m.get(id)!.inGrab);
/** Into a car's seat by its door. */
function getIn(m: Match, id: string, car: Car, seat: number): MatchEvent[] {
  const [x, z] = doorPoint(car, seat);
  put(m, id, x, z);
  tap(m, id);
  return runFor(m, 0.05);
}
/** Market Road's east lane (z −92 on the road at z −90, heading east), clear from x 5 to 55. */
const LANE: [number, number] = [8, -92];

// ── Where they start ──

console.log("where they start:");
{
  const m = newMatch(3, mode("find-the-flag"));
  const v = veh(m);
  check(v.cars.length === 2, `12 people: ${v.cars.length} cars (2 from 8 people up)`);
  const m6 = newMatch(4, mode("find-the-flag"), 6);
  check(veh(m6).cars.length === 1, `6 people: ${veh(m6).cars.length} car`);
  let cx = 0;
  let cz = 0;
  for (const [x, z] of world.spawns) {
    cx += x / world.spawns.length;
    cz += z / world.spawns.length;
  }
  const far = [...v.cars, ...veh(m6).cars].every((c) => Math.hypot(c.x - cx, c.z - cz) >= VEHICLES.far);
  check(far, `parked far from the middle of the starts (≥ ${VEHICLES.far} m: ${v.cars.map((c) => Math.round(Math.hypot(c.x - cx, c.z - cz))).join(", ")} m)`);
  const onRoad = v.cars.every((c) => world.roads!.some((r) => {
    const len2 = (r.x1 - r.x0) ** 2 + (r.z1 - r.z0) ** 2;
    const s = Math.max(0, Math.min(1, ((c.x - r.x0) * (r.x1 - r.x0) + (c.z - r.z0) * (r.z1 - r.z0)) / len2));
    return Math.hypot(r.x0 + (r.x1 - r.x0) * s - c.x, r.z0 + (r.z1 - r.z0) * s - c.z) <= r.w / 2;
  }));
  check(onRoad && v.cars.every((c) => Math.abs(c.h) < 0.35), "on a road, on flat ground");
  const seeds = new Set<string>();
  for (let s = 0; s < 6; s++) seeds.add(veh(newMatch(100 + s, mode("find-the-flag"))).cars.map((c) => c.kind).join());
  check(seeds.size > 1, `the seed picks the kinds (${[...seeds].join(" | ")})`);
  check(!newMatch(5, mode("flag-duel"), 4).module("vehicles"), "the staked Flag Duel has none");
  check(world.fuel!.length === 6, `${world.fuel!.length} fuel boys by the roads`);
}

// ── Driving ──

console.log("driving:");
{
  const m = newMatch(7, bare());
  toPlay(m);
  clear(m, ["p0"]);
  const car = park(m, "tokunbo", LANE[0], LANE[1], EAST);
  noOtherCars(m, [car]);
  const ev = getIn(m, "p0", car, 0);
  const p0 = m.get("p0")!;
  check(ev.some((e) => e.type === "seat" && e.id === "p0" && e.seat === 0) && m.seated(p0), "interact at the driver's door: you drive");
  // Standing still, the stick can't turn it.
  m.setInput("p0", 0, 1);
  const h0 = car.heading;
  runFor(m, DT);
  check(Math.abs(car.heading - h0) < 0.01, "standing still it doesn't turn on the spot");
  m.setInput("p0", 1, 0);
  runFor(m, 2.5);
  check(car.speed > 6 && car.x > LANE[0] + 6 && Math.abs(car.z - LANE[1]) < 0.5, `stick east: away east (${car.speed.toFixed(1)} m/s after 2.5 s)`);
  check(Math.hypot(p0.x - car.x, p0.z - car.z) < 1 && p0.heading === car.heading, "the driver goes with it, in the seat");
  // Hard turn at speed: no more sideways g than the tyres hold.
  m.setInput("p0", 0, 1);
  let most = 0;
  runFor(m, 0.4, [], () => (most = Math.max(most, car.speed * Math.abs(car.turn))));
  check(most <= VEHICLES.kinds.tokunbo.grip + 0.01, `a hard turn at speed: ${most.toFixed(1)} m/s² sideways (grip ${VEHICLES.kinds.tokunbo.grip})`);
  // Pull back: it brakes and stops; it never goes backwards.
  m.setInput("p0", -Math.sin(car.heading), -Math.cos(car.heading));
  let back = false;
  let px = car.x;
  let pz = car.z;
  runFor(m, 3, [], () => {
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    if ((car.x - px) * fx + (car.z - pz) * fz < -1e-6) back = true;
    px = car.x;
    pz = car.z;
  });
  check(car.speed === 0 && !back, "pull back: it brakes to a stop, and never reverses");
  // Out, standing still: on your feet beside it.
  tap(m, "p0");
  const out = runFor(m, 0.05);
  const melee = m.module<MeleeModule>("melee")!;
  check(out.some((e) => e.type === "seat" && e.id === "p0" && e.seat === -1) && !m.seated(p0) && !melee.isDown(p0.index), "interact again: out, on your feet");
  check(!m.reach.at(p0.x, p0.z) || Math.hypot(p0.x - car.x, p0.z - car.z) > VEHICLES.kinds.tokunbo.wid / 2, "beside the car, not in it");
}

console.log("walls, gutters, the edge:");
{
  const m = newMatch(8, bare());
  toPlay(m);
  clear(m, ["p0"]);
  // The east end of the road, at the city wall.
  const car = park(m, "danfo", 168, LANE[1], EAST);
  noOtherCars(m, [car]);
  getIn(m, "p0", car, 0);
  m.setInput("p0", 1, 0);
  let inside = false;
  const ev = runFor(m, 6, [], () => {
    for (const off of VEHICLES.kinds.danfo.circles) {
      const [x] = carPoint(car, 0, off);
      if (x > layout.half - VEHICLES.kinds.danfo.r + 0.05) inside = true;
    }
  });
  check(car.x < layout.half && !inside && car.speed < 1, `into the city wall: stopped at x ${car.x.toFixed(1)}, never through it`);
  check(car.damage > 0, `the hit cost it (${car.damage.toFixed(0)} damage${ev.some((e) => e.type === "wreck") ? `, now ${["", "scratched", "smoking", "on fire"][car.state]}` : ""})`);
  // Off the side of the road: a gutter stops it; it never drops in.
  const m2 = newMatch(9, bare());
  toPlay(m2);
  clear(m2, ["p0"]);
  const c2 = park(m2, "tokunbo", 30, LANE[1], EAST);
  noOtherCars(m2, [c2]);
  getIn(m2, "p0", c2, 0);
  m2.setInput("p0", 0.3, -1);
  let low = 0;
  runFor(m2, 4, [], () => (low = Math.min(low, c2.h)));
  check(low > -0.05 && c2.z > -96, `steered at the gutter: it stops at the edge (lowest ${low.toFixed(2)} m, z ${c2.z.toFixed(1)})`);
}

// ── People ──

console.log("people in the way:");
{
  const m = newMatch(10, bare());
  toPlay(m);
  clear(m, ["p0", "p1"]);
  const car = park(m, "tokunbo", LANE[0], LANE[1], EAST);
  noOtherCars(m, [car]);
  getIn(m, "p0", car, 0);
  const p1 = put(m, "p1", LANE[0] + 22, LANE[1] + 0.3);
  m.setInput("p0", 1, 0);
  const ev = runFor(m, 3.5);
  const melee = m.module<MeleeModule>("melee")!;
  const bump = ev.find((e) => e.type === "bump" && e.tg === "p1");
  check(!!bump, "a car into someone: bumped");
  check(p1.status === "alive" && Math.abs(p1.z - LANE[1]) > 1, `pushed aside (now ${Math.abs(p1.z - LANE[1]).toFixed(1)} m off its line), never hurt`);
  check(melee.wobble[p1.index] > 0 || melee.isDown(p1.index), `with a wobble (${melee.wobble[p1.index].toFixed(2)})`);
  // Walking into a parked car: kept out of it.
  const m2 = newMatch(11, bare());
  toPlay(m2);
  clear(m2, ["p1"]);
  const parked = park(m2, "danfo", LANE[0], LANE[1], EAST);
  noOtherCars(m2, [parked]);
  const w = put(m2, "p1", LANE[0], LANE[1] + 3);
  m2.setInput("p1", 0, -1);
  let worst = 9;
  runFor(m2, 2, [], () => {
    const lx = (w.x - parked.x) * Math.cos(parked.heading) - (w.z - parked.z) * Math.sin(parked.heading);
    const lz = (w.x - parked.x) * Math.sin(parked.heading) + (w.z - parked.z) * Math.cos(parked.heading);
    worst = Math.min(worst, Math.max(Math.abs(lx) - VEHICLES.kinds.danfo.wid / 2, Math.abs(lz) - VEHICLES.kinds.danfo.len / 2));
  });
  check(worst > -0.05, `walking into a parked danfo: kept out (closest ${worst.toFixed(2)} m from its side)`);
  // Riders can't be hit.
  const m3 = newMatch(12, bare());
  toPlay(m3);
  clear(m3, ["p0", "p1"]);
  const c3 = park(m3, "keke", LANE[0], LANE[1], EAST);
  noOtherCars(m3, [c3]);
  getIn(m3, "p0", c3, 1);
  const [dx, dz] = doorPoint(c3, 1, 0.2);
  put(m3, "p1", dx, dz, Math.atan2(m3.get("p0")!.x - dx, m3.get("p0")!.z - dz));
  slap(m3, "p1");
  const ev3 = runFor(m3, 0.4);
  check(!ev3.some((e) => e.type === "hit" && e.tg === "p0"), "a swing at someone riding: nothing lands");
}

// ── The sky ──

console.log("the sky:");
{
  // A tiny zone straight away: everyone is outside it.
  const m = newMatch(13, mode("find-the-flag", (s) => {
    delete s.modules.airfall;
    s.modules.zone = { phases: [[0, 4, 1, 4]] };
    s.time = 900;
  }));
  toPlay(m);
  const zone = m.module<ZoneModule>("zone")!;
  clear(m, ["p0", "p1"]);
  const car = park(m, "tokunbo", LANE[0], LANE[1], EAST);
  noOtherCars(m, [car]);
  // Far from the circle (it's somewhere in the city; the lane must be outside it).
  getIn(m, "p0", car, 0);
  const p0 = m.get("p0")!;
  const p1 = put(m, "p1", LANE[0] - 6, LANE[1] - 3);
  for (const c of m.contestants) if (c !== p0 && c !== p1) m.eliminate(c, "hazard");
  m.drain();
  // Away at once, while the circle closes: fast, nothing builds.
  m.setInput("p0", 1, 0);
  runFor(m, 1.5);
  const hiddenNow = veh(m).hidden(m, p0);
  const e0 = zone.exposureOf(p0.index);
  runFor(m, 2);
  const outside = Math.hypot(car.x - zone.now.x, car.z - zone.now.z) > zone.now.r;
  check(outside && hiddenNow && zone.exposureOf(p0.index) <= e0 + 1e-9, `outside, faster than ${VEHICLES.hidden} m/s: the sky can't see you (exposure stays ${e0.toFixed(2)})`);
  check(zone.exposureOf(p1.index) > 0, `on foot outside: it builds (${zone.exposureOf(p1.index).toFixed(2)})`);
  // Stopped: it builds, the laser comes; away fast before it lands: it misses.
  m.setInput("p0", -1, 0);
  const ev = runFor(m, 30, [], () => {
    if (zone.doomed(p0.index) && m.get("p0")!.inX < 0) m.setInput("p0", Math.sin(car.heading), Math.cos(car.heading));
  });
  const laser = ev.some((e) => e.type === "laser" && e.id === "p0");
  const dodged = ev.some((e) => e.type === "dodge" && e.id === "p0");
  check(laser && dodged && p0.status === "alive", `stopped, it found you; away fast before it landed: it missed${laser ? "" : " (no laser came)"}`);
}

// ── Fuel ──

console.log("fuel:");
{
  const m = newMatch(14, bare());
  toPlay(m);
  clear(m, ["p0"]);
  const car = park(m, "keke", LANE[0], LANE[1], EAST);
  noOtherCars(m, [car]);
  getIn(m, "p0", car, 0);
  // Round and round the junction's open ground: steer in a slow circle.
  let a = 0;
  const ev = runFor(m, VEHICLES.fuel.full + 2, [], () => {
    a += DT * 0.6;
    m.setInput("p0", Math.cos(a) * 0.5, Math.sin(a) * 0.5);
    car.x = Math.max(-20, Math.min(40, car.x));
  });
  const beeps = ev.filter((e) => e.type === "fuel" && e.why === "beep").length;
  check(beeps === 2, `beeps at 20% and 10% (${beeps})`);
  check(ev.some((e) => e.type === "fuel" && e.why === "empty") && car.fuel === 0, `empty after ${VEHICLES.fuel.full} s of driving: it stalls`);
  check(!m.seated(m.get("p0")!), "… and everyone gets out");
  // A fuel boy: stop beside him.
  const m2 = newMatch(15, bare());
  toPlay(m2);
  clear(m2, ["p0"]);
  const st = world.fuel![0];
  const c2 = park(m2, "tokunbo", st.x + Math.cos(st.rot) * 2.5, st.z - Math.sin(st.rot) * 2.5, st.rot + EAST);
  noOtherCars(m2, [c2]);
  c2.fuel = 8;
  const ev2 = getIn(m2, "p0", c2, 0);
  runFor(m2, 0.3, ev2);
  check(ev2.some((e) => e.type === "fuel" && e.why === "boy") && Math.abs(c2.fuel - 18) < 0.2 && veh(m2).used[0], `a fuel boy: +${VEHICLES.fuel.boy} s (8 → ${c2.fuel.toFixed(1)})`);
  c2.fuel = 5;
  runFor(m2, 0.5);
  check(c2.fuel === 5, "once a match: he's sold out");
  // A Fuel Jerrycan, used in the car.
  const items = m2.module<ItemsModule>("items")!;
  const p0 = m2.get("p0")!;
  items.packs[p0.index][0] = "jerrycan";
  m2.setPack("p0", (1 << 5) | 0);
  const ev3 = runFor(m2, 0.05);
  check(ev3.some((e) => e.type === "use" && e.kind === "jerrycan") && Math.abs(c2.fuel - 5 - VEHICLES.fuel.can) < 0.1, `a Fuel Jerrycan in the car: +${VEHICLES.fuel.can} s (${c2.fuel.toFixed(1)})`);
  // With no car near, it stays in the pack.
  const m3 = newMatch(16, bare());
  toPlay(m3);
  clear(m3, ["p0"]);
  noOtherCars(m3, []);
  put(m3, "p0", -168, -176);
  const it3 = m3.module<ItemsModule>("items")!;
  it3.packs[0][0] = "jerrycan";
  m3.setPack("p0", (2 << 5) | 0);
  runFor(m3, 0.05);
  check(it3.packs[0][0] === "jerrycan", "no car to fill: the jerrycan stays in the pack");
  // A Danfo Key: a danfo comes to the nearest road.
  it3.packs[0][1] = "danfo-key";
  put(m3, "p0", 10, -85);
  const n = veh(m3).cars.length;
  m3.setPack("p0", (3 << 5) | 1);
  const ev4 = runFor(m3, 0.05);
  const called = veh(m3).cars[n];
  const d = called ? Math.hypot(called.x - 10, called.z + 85) : -1;
  check(!!called && called.kind === "danfo" && ev4.some((e) => e.type === "car") && d >= VEHICLES.call[0] && d <= VEHICLES.call[1], `a Danfo Key: a danfo on a road ${d.toFixed(0)} m away`);
}

// ── Damage and the blast ──

console.log("damage:");
{
  const m = newMatch(17, bare());
  toPlay(m);
  clear(m, ["p0", "p1", "p2"]);
  const car = park(m, "danfo", 168, LANE[1], EAST);
  noOtherCars(m, [car]);
  getIn(m, "p0", car, 0);
  getIn(m, "p1", car, 1);
  const p2 = put(m, "p2", 166, LANE[1] - 4);
  car.damage = VEHICLES.damage.states[2] - 1;
  m.setInput("p0", 1, 0);
  let fireAt = -1;
  let blowAt = -1;
  const watch = () => {
    if (car.state === 3 && fireAt < 0) {
      fireAt = m.elapsed;
      m.setInput("p0", 0, 0);
    }
    if (car.state === 4 && blowAt < 0) blowAt = m.elapsed;
  };
  const ev = runFor(m, 8, [], watch);
  check(fireAt > 0 && ev.some((e) => e.type === "wreck" && e.state === 3), "a hit with it nearly done: on fire");
  const ev2 = runFor(m, 16, [], watch);
  const blew = ev2.some((e) => e.type === "wreck" && e.state === 4);
  const after = blowAt - fireAt;
  check(blew && car.state === 4 && after >= VEHICLES.damage.fire[0] - 0.05 && after <= VEHICLES.damage.fire[1] + 0.05, `it blew ${after.toFixed(1)} s later (10–15)`);
  const thrown = ev2.filter((e) => e.type === "down" && e.why === "blast").map((e) => (e as { id: string }).id);
  check(thrown.includes("p0") && thrown.includes("p1") && !m.seated(m.get("p0")!) && !m.seated(m.get("p1")!), "both thrown out and down");
  check(m.contestants.every((c) => c.status === "alive" || c.cause !== "hazard" || !["p0", "p1", "p2"].includes(c.id)) && p2.status === "alive", "nobody dies of it (the one standing by knocked away)");
  // A wreck: nobody gets in.
  const [dx, dz] = doorPoint(car, 0);
  put(m, "p2", dx, dz);
  check(veh(m).option(m, m.get("p2")!) === null, "a wreck: no way in");
  // Out at speed: a tumble.
  const m2 = newMatch(18, bare());
  toPlay(m2);
  clear(m2, ["p0"]);
  const c2 = park(m2, "tokunbo", LANE[0], LANE[1], EAST);
  noOtherCars(m2, [c2]);
  getIn(m2, "p0", c2, 0);
  m2.setInput("p0", 1, 0);
  runFor(m2, 2);
  tap(m2, "p0");
  const ev3 = runFor(m2, 0.1);
  check(ev3.some((e) => e.type === "down" && e.id === "p0" && e.why === "tumble"), `out at ${c2.speed.toFixed(0)} m/s: a tumble`);
}

// ── Hijack ──

console.log("the hijack:");
{
  const m = newMatch(19, bare());
  toPlay(m);
  clear(m, ["p0", "p1"]);
  const car = park(m, "tokunbo", LANE[0], LANE[1], EAST);
  noOtherCars(m, [car]);
  getIn(m, "p0", car, 0);
  const [dx, dz] = doorPoint(car, 0);
  put(m, "p1", dx, dz);
  check(veh(m).option(m, m.get("p1")!)?.kind === "pull", "at a rival's driver door: pull them out");
  tap(m, "p1", true);
  const ev = runFor(m, 0.3, [], () => holdOn(m, "p1"));
  check(ev.some((e) => e.type === "hijack" && e.how === "start") && !!car.hijack, "held: it starts");
  slap(m, "p0");
  const ev2 = runFor(m, 0.1, [], () => holdOn(m, "p1"));
  check(ev2.some((e) => e.type === "hijack" && e.how === "stop") && car.seats[0] === m.get("p0")!.index, "a slap from inside stops it");
  // Again, and this time nobody slaps.
  tap(m, "p1", true);
  const ev3 = runFor(m, VEHICLES.hijack.hold + 0.2, [], () => holdOn(m, "p1"));
  check(ev3.some((e) => e.type === "hijack" && e.how === "done") && car.seats[0] === m.get("p1")!.index, `held ${VEHICLES.hijack.hold} s: they're out, you drive`);
  check(ev3.some((e) => e.type === "down" && e.id === "p0" && e.why === "hijack") && !m.seated(m.get("p0")!), "the driver is out and down");
  // Pulling: driving off stops it.
  const m2 = newMatch(20, bare());
  toPlay(m2);
  clear(m2, ["p0", "p1"]);
  const c2 = park(m2, "tokunbo", LANE[0], LANE[1], EAST);
  noOtherCars(m2, [c2]);
  getIn(m2, "p0", c2, 0);
  const [ex, ez] = doorPoint(c2, 0);
  put(m2, "p1", ex, ez);
  tap(m2, "p1", true);
  m2.setInput("p0", 1, 0);
  const ev4 = runFor(m2, 1.5, [], () => holdOn(m2, "p1"));
  check(ev4.some((e) => e.type === "hijack" && e.how === "stop") && c2.seats[0] === m2.get("p0")!.index, "driving off stops it");
  // A squad mate's door: you ride with them instead.
  const m3 = newMatch(21, bare("find-the-flag"), 4, [0, 0, 1, 1]);
  toPlay(m3);
  clear(m3, ["p0", "p1"]);
  const c3 = park(m3, "tokunbo", LANE[0], LANE[1], EAST);
  noOtherCars(m3, [c3]);
  getIn(m3, "p0", c3, 0);
  const [fx, fz] = doorPoint(c3, 0);
  put(m3, "p1", fx, fz);
  check(veh(m3).option(m3, m3.get("p1")!)?.kind === "ride", "a squad mate's driver door: you get in beside them, no pulling");
}

// ── With a flag ──

console.log("with a flag:");
{
  const m = newMatch(22, bare("hold-the-flag"));
  toPlay(m);
  clear(m, ["p0"]);
  const flags = m.module<FlagsModule>("flags")!;
  const f = flags.flags[0];
  const car = park(m, "tokunbo", LANE[0], LANE[1], EAST);
  noOtherCars(m, [car]);
  // Take it, then drive with it.
  put(m, "p0", f.x, f.z);
  runFor(m, 0.3);
  const holding = !!flags.heldBy(m.get("p0")!.index);
  getIn(m, "p0", car, 0);
  m.setInput("p0", 1, 0);
  runFor(m, 2);
  check(holding && !!flags.heldBy(m.get("p0")!.index) && Math.hypot(f.x - car.x, f.z - car.z) < 3, "a flag holder drives off with it");
}

// ── The phone's copy ──

console.log("the phone's copy (mirror):");
{
  const s = mode("find-the-flag", (x) => {
    x.time = 120;
  });
  const srv = newMatch(23, s);
  const ph = new Match({ seed: 23, world, settings: s, contestants: srv.contestants.map((c) => ({ id: c.id, name: c.name, bot: false })), mirror: true });
  for (const e of srv.drain()) ph.applyRemote(e);
  ph.drain();
  toPlay(srv);
  const sv = veh(srv);
  const pv = veh(ph);
  // Drivers for both cars: everyone else heads for the nearest door and taps.
  let n = 0;
  for (let f = 0; f < 60 * 90; f++) {
    for (const c of srv.contestants) {
      if (c.status !== "alive") continue;
      if (srv.seated(c)) {
        if (f % 40 === c.index) srv.setInput(c.id, Math.sin(f * 0.01 + c.index), Math.cos(f * 0.013 + c.index));
        if (f % 900 === c.index * 7) tap(srv, c.id);
      } else {
        const car = sv.cars[c.index % sv.cars.length];
        const [dx, dz] = doorPoint(car, c.index % 2);
        const d = Math.hypot(dx - c.x, dz - c.z);
        srv.setInput(c.id, d > 1 ? (dx - c.x) / d : 0, d > 1 ? (dz - c.z) / d : 0);
        if (d < 1.5 && f % 20 === 0) tap(srv, c.id);
      }
    }
    srv.step(DT);
    ph.phase = srv.phase;
    for (const e of srv.drain()) {
      ph.applyRemote(e);
      n++;
    }
    ph.drain();
    ph.elapsed = srv.elapsed;
    for (const car of sv.cars) {
      const pc = pv.cars[car.index];
      if (pc) Object.assign(pc, { x: car.x, z: car.z, heading: car.heading, speed: car.speed, fuel: car.fuel, damage: car.damage });
    }
  }
  const seats = sv.cars.every((c, i) => c.seats.join() === pv.cars[i]?.seats.join());
  const bodies = srv.contestants.every((c) => srv.seatOf(c) === ph.seatOf(ph.contestants[c.index]));
  const states = sv.cars.every((c, i) => c.state === pv.cars[i]?.state);
  const rode = sv.cars.some((c) => c.seats[0] >= 0) || n > 0;
  check(seats && bodies && states && rode && pv.cars.length === sv.cars.length, `90 s of people getting in, driving and out: the copy agrees on every seat and car (${n} events)`);
}

// ── Cost ──

{
  const m = newMatch(24, mode("find-the-flag"));
  toPlay(m);
  const v = veh(m);
  for (const [i, car] of v.cars.entries()) {
    const [dx, dz] = doorPoint(car, 0);
    put(m, `p${i}`, dx, dz);
    tap(m, `p${i}`);
  }
  runFor(m, 0.1);
  const driving = v.cars.filter((c) => c.seats[0] >= 0).length;
  // A full tank every second: they drive the whole minute.
  const fill = () => {
    for (const car of v.cars) car.fuel = VEHICLES.fuel.full;
  };
  const t = performance.now();
  for (let f = 0; f < 60 * 60; f++) {
    if (f % 30 === 0) for (const c of m.contestants) m.setInput(c.id, Math.sin(f * 0.02 + c.index), Math.cos(f * 0.017 + c.index));
    if (f % 60 === 0) fill();
    m.step(DT);
    m.drain();
  }
  const ms = (performance.now() - t) / 3600;
  check(driving === v.cars.length && ms < 0.6, `a 12-player step with ${driving} cars driving costs ${(ms * 1000).toFixed(0)} µs`);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
