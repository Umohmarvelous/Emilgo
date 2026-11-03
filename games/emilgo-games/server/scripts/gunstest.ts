// Guns (v4 Phase 2): Free For All as a shooter, refereed headless on Naija
// World as the server runs it. The loadout, hits (body, head, falloff),
// armour, kills and comebacks, friendly fire, walls, the lag rewind, pickups,
// reloads, crates and drums, cars, melee as backup, which modes carry guns,
// and the phone's copy kept true by the server's events.
//
//   node server/build-tools.mjs && node server/dist/gunstest.mjs

import { GUNS } from "../../src/config";
import { BUILTIN_MANIFEST } from "../../src/content/modes";
import type { Contestant } from "../../src/game/core/body";
import { Match, settingsOf, type MatchSettings } from "../../src/game/core/match";
import type { MatchEvent } from "../../src/game/core/module";
import { Space } from "../../src/game/core/space";
import { gunStats, type GunsModule } from "../../src/game/modules/guns";
import type { VehiclesModule } from "../../src/game/modules/vehicles";
import { matchWorldOf } from "../../src/maps/open/matchWorld";
import { buildNaijaWorld, SURFACE_OF } from "../../src/maps/open/naija";
import { decodeEvent, encodeEvent } from "../../src/net/matchWire";

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
const bare = (id: string, extra: (s: MatchSettings) => void = () => {}): MatchSettings => {
  const s = settingsOf(def(id));
  delete s.modules.zone;
  delete s.modules.airfall;
  delete s.modules.vehicles;
  s.time = 900;
  extra(s);
  return s;
};
function newMatch(seed: number, settings: MatchSettings, n = 4, squads?: number[]): Match {
  return new Match({ seed, world, settings, countdown: 0.1, contestants: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, bot: false, ...(squads ? { squad: squads[i] } : {}) })) });
}
function toPlay(m: Match, out: MatchEvent[] = []): MatchEvent[] {
  let guard = 0;
  while (m.phase !== "play" && guard++ < 1e5) {
    m.step(DT);
    out.push(...m.drain());
  }
  return out;
}
function run(m: Match, s: number, out: MatchEvent[] = [], each?: () => void): MatchEvent[] {
  const end = m.elapsed + s;
  let guard = 0;
  while (m.elapsed < end - 1e-9 && !m.over && guard++ < 2e6) {
    each?.();
    m.step(DT);
    out.push(...m.drain());
  }
  return out;
}
/** A quiet, open, flat spot. */
const YARD: [number, number] = [-168, -176];
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
function clear(m: Match, keep: string[]): void {
  let k = 0;
  for (const c of m.contestants) if (!keep.includes(c.id)) put(m, c.id, 60 + (k % 6) * 8, 160 + Math.floor(k++ / 6) * 8);
}
/** Aim c's shot (from the shoulder the camera looks over) through a point: yaw and pitch, worked out as the rules' muzzle has it. */
function aimAt(m: Match, c: Contestant, x: number, y: number, z: number, trigger = true, ads = true): void {
  const g = m.module<GunsModule>("guns")!;
  let yaw = Math.atan2(-(x - c.x), -(z - c.z));
  const o: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 6; k++) {
    m.setAim(c.id, yaw, 0, false, ads, m.aims[c.index].reload, m.aims[c.index].swap);
    g.muzzle(m, c, o);
    yaw = Math.atan2(-(x - o[0]), -(z - o[2]));
  }
  m.setAim(c.id, yaw, 0, false, ads, m.aims[c.index].reload, m.aims[c.index].swap);
  g.muzzle(m, c, o);
  const d = Math.hypot(x - o[0], y - o[1], z - o[2]);
  const pitch = Math.asin(-(y - o[1]) / d);
  m.setAim(c.id, yaw, pitch, trigger, ads, m.aims[c.index].reload, m.aims[c.index].swap);
}
const stop = (m: Match, c: Contestant) => m.setAim(c.id, m.aims[c.index].yaw, m.aims[c.index].pitch, false, false, m.aims[c.index].reload, m.aims[c.index].swap);
/** One shot exactly: the trigger for one step, then off until the gun is ready again. */
function shoot(m: Match, c: Contestant, x: number, y: number, z: number, out: MatchEvent[] = []): MatchEvent[] {
  const g = m.module<GunsModule>("guns")!;
  while (g.nextAt[c.index] > m.elapsed + 1e-9) run(m, DT, out);
  aimAt(m, c, x, y, z);
  run(m, DT, out);
  stop(m, c);
  return out;
}
const [YX, YZ] = YARD;

console.log("which modes carry guns:");
for (const id of ["find-the-flag", "hold-the-flag", "steal-reposition", "squad-rally", "hustle", "scarcity", "compound-wars", "riddles-elders", "flag-duel"]) {
  const m = newMatch(1, settingsOf(def(id)), 4);
  check(!!m.module("guns"), `${id}: guns`);
}
for (const id of ["chase-reverse", "lights-out", "dead-streets"]) {
  const m = newMatch(1, settingsOf(def(id)), id === "dead-streets" ? 1 : 4);
  check(!m.module("guns"), `${id}: no guns (its rules are a touch, a find, or its own gun)`);
}

console.log("the loadout and a hit:");
{
  const m = newMatch(2, bare("find-the-flag"));
  const g = m.module<GunsModule>("guns")!;
  toPlay(m);
  clear(m, ["p0", "p1"]);
  const a = put(m, "p0", YX, YZ);
  const b = put(m, "p1", YX + 8, YZ);
  check(g.hp[a.index] === 100 && g.gun[a.index][0] === 0 && g.gun[a.index][1] === -1 && g.mag[a.index][0] === 12 && g.res[a.index][0] === 48, "everyone starts with 100 health and a pistol (12 in it, 48 spare)");
  const ev = shoot(m, a, b.x, b.h + 1.0, b.z);
  const dmg = ev.find((e) => e.type === "dmg") as Extract<MatchEvent, { type: "dmg" }> | undefined;
  check(!!dmg && dmg.tg === "p1" && dmg.by === "p0" && !dmg.head && Math.abs(g.hp[b.index] - (100 - GUNS.kinds.pistol.dmg)) < 0.01, `a body shot at 8 m: ${GUNS.kinds.pistol.dmg} off (health ${g.hp[b.index]})`);
  check(g.mag[a.index][0] === 11, "one round gone");
  const fire = ev.find((e) => e.type === "fire") as Extract<MatchEvent, { type: "fire" }> | undefined;
  check(!!fire && Math.hypot(fire.x - b.x, fire.z - b.z) < 0.6, "the shot's end is on the target (the phone draws the streak to it)");
  const before = g.hp[b.index];
  const ev2 = shoot(m, a, b.x, b.h + 1.75 - GUNS.body.head, b.z);
  const d2 = ev2.find((e) => e.type === "dmg") as Extract<MatchEvent, { type: "dmg" }> | undefined;
  check(!!d2 && d2.head && Math.abs(before - g.hp[b.index] - GUNS.kinds.pistol.dmg * GUNS.kinds.pistol.head) < 0.05, `a head shot: × ${GUNS.kinds.pistol.head}`);
  // Out: shot until health is gone.
  const out: MatchEvent[] = [];
  for (let k = 0; k < 6 && b.status === "alive"; k++) shoot(m, a, b.x, b.h + 1.0, b.z, out);
  const kill = out.find((e) => e.type === "kill") as Extract<MatchEvent, { type: "kill" }> | undefined;
  const elim = out.find((e) => e.type === "eliminated") as Extract<MatchEvent, { type: "eliminated" }> | undefined;
  check(b.status === "eliminated" && !!kill && kill.by === "p0" && kill.tg === "p1" && elim?.cause === "shot", "at 0 health they're out, shot by the shooter");
  // Find the Flag brings you back after its delay, with a fresh pistol.
  g.armour[b.index] = 40;
  run(m, m.settings.respawn.delay + 0.2);
  check(b.status === "alive" && g.hp[b.index] === 100 && g.armour[b.index] === 0 && g.gun[b.index][1] === -1, "back after the mode's delay: full health, no armour, a pistol");
}

console.log("falloff, armour, squads, walls:");
{
  const m = newMatch(3, bare("find-the-flag"), 4, [0, 1, 0, 2]);
  const g = m.module<GunsModule>("guns")!;
  toPlay(m);
  clear(m, ["p0", "p1", "p2"]);
  const a = put(m, "p0", YX, YZ);
  const b = put(m, "p1", YX + 30, YZ);
  shoot(m, a, b.x, b.h + 1.0, b.z);
  const K = GUNS.kinds.pistol;
  const fall = 1 - ((30 - K.near) / (K.far - K.near)) * (1 - K.low);
  check(Math.abs(100 - g.hp[b.index] - K.dmg * fall) < 0.6, `at 30 m a pistol does ${(K.dmg * fall).toFixed(1)} (falls off past ${K.near} m)`);
  put(m, "p1", YX + 6, YZ);
  g.hp[b.index] = 100;
  g.armour[b.index] = 50;
  shoot(m, a, b.x, b.h + 1.0, b.z);
  check(Math.abs(g.armour[b.index] - (50 - K.dmg * GUNS.armour.share)) < 0.05 && Math.abs(g.hp[b.index] - (100 - K.dmg * (1 - GUNS.armour.share))) < 0.05, "armour takes 70% of a hit until it's gone");
  const mate = put(m, "p2", YX + 6, YZ + 3);
  shoot(m, a, mate.x, mate.h + 1.0, mate.z);
  check(g.hp[mate.index] === 100, "no friendly fire: a squad mate isn't hurt");
  // A wall between: find a tall building's side and stand either side of it.
  const wall = layout.solids.find((s) => s.kind === "box" && s.y0 === 0 && s.y1 > 3 && s.hx > 2 && s.hz > 2 && Math.abs(s.rot) < 0.01 && Math.hypot(s.x - YX, s.z - YZ) < 250)!;
  const ax = wall.x - wall.hx - 3;
  const bx = wall.x + wall.hx + 3;
  const wa = put(m, "p0", ax, wall.z);
  const wb = put(m, "p1", bx, wall.z);
  g.hp[wb.index] = 100;
  g.armour[wb.index] = 0;
  const ev = shoot(m, wa, wb.x, wb.h + 1.0, wb.z);
  const f = ev.find((e) => e.type === "fire") as Extract<MatchEvent, { type: "fire" }> | undefined;
  check(g.hp[wb.index] === 100 && !!f && f.x < wall.x, "a wall stops the bullet (it ends on the wall's near side)");
}

console.log("the lag rewind:");
{
  const m = newMatch(4, bare("find-the-flag"));
  const g = m.module<GunsModule>("guns")!;
  toPlay(m);
  clear(m, ["p0", "p1"]);
  const a = put(m, "p0", YX, YZ);
  const b = put(m, "p1", YX + 10, YZ - 4);
  // b runs north (−z) at full speed; a saw them 100 ms ago and aims there.
  m.setInput("p1", 0, -1);
  run(m, 0.5);
  const seen = { x: b.x, z: b.z };
  run(m, 0.1);
  a.graceBonus = 0.1;
  shoot(m, a, seen.x, b.h + 1.0, seen.z);
  check(g.hp[b.index] < 100, "aiming where a runner was on your screen (100 ms ago) still hits");
  g.hp[b.index] = 100;
  run(m, 0.3);
  const old = { x: b.x, z: b.z };
  run(m, 0.3);
  a.graceBonus = 0.1;
  shoot(m, a, old.x, b.h + 1.0, old.z);
  check(g.hp[b.index] === 100, "… but not where they were 300 ms ago (the rewind stops at 150 ms)");
}

console.log("pickups and reloads:");
{
  const m = newMatch(5, bare("find-the-flag"));
  const g = m.module<GunsModule>("guns")!;
  const ev = toPlay(m);
  clear(m, ["p0"]);
  check(g.pickups.filter((p) => p.kind === "gun").length >= 20 && g.pickups.some((p) => p.kind === "ammo") && g.pickups.some((p) => p.kind === "plate"), `loot on the ground: ${g.pickups.filter((p) => p.kind === "gun").length} guns, ammo, plates`);
  const rar = new Set(g.pickups.filter((p) => p.kind === "gun").map((p) => p.rarity));
  check(rar.size >= 3, `in several rarities (${[...rar].sort().join(", ")})`);
  const a = m.get("p0")!;
  const p = g.pickups.find((q) => q.kind === "gun")!;
  put(m, "p0", p.x + 0.5, p.z);
  m.setInteract("p0", 1, false);
  run(m, DT * 2, ev);
  check(p.taken && g.gun[a.index][1] === p.gun && g.rarity[a.index][1] === p.rarity && g.slot[a.index] === 1 && g.mag[a.index][1] === gunStats((["pistol", "rifle", "smg", "shotgun"] as const)[p.gun], p.rarity).mag, "interact takes a gun: it's your primary, in hand, full");
  const q = g.pickups.find((x) => x.kind === "gun" && !x.taken && x !== p)!;
  put(m, "p0", q.x + 0.5, q.z);
  const n0 = g.pickups.length;
  m.setInteract("p0", 2, false);
  const ev2 = run(m, DT * 2);
  check(q.taken && g.gun[a.index][1] === q.gun && g.pickups.length === n0 + 1 && ev2.some((e) => e.type === "pick" && e.g === p.gun), "taking another drops yours at your feet");
  // Swap to the pistol and back.
  m.setAim("p0", 0, 0, false, false, 0, 1);
  run(m, DT * 2);
  check(g.slot[a.index] === 0, "swap: the pistol in hand");
  m.setAim("p0", 0, 0, false, false, 0, 2);
  run(m, DT * 2);
  check(g.slot[a.index] === 1, "swap again: the primary");
  // Empty it, then the trigger reloads.
  const s = g.slot[a.index];
  g.mag[a.index][s] = 0;
  const res = g.res[a.index][s];
  m.setAim("p0", 0, 0.5, true, false, 0, 2);
  const ev3 = run(m, DT * 3);
  check(ev3.some((e) => e.type === "reload" && e.how === "start"), "the trigger on an empty magazine starts a reload");
  m.setAim("p0", 0, 0.5, false, false, 0, 2);
  const ev4 = run(m, 3);
  const full = gunStats((["pistol", "rifle", "smg", "shotgun"] as const)[g.gun[a.index][s]], g.rarity[a.index][s]).mag;
  check(ev4.some((e) => e.type === "reload" && e.how === "done") && g.mag[a.index][s] === full && g.res[a.index][s] === res - full, "… and fills it from the spare rounds");
  // Walking over ammo and a plate takes them.
  const am = g.pickups.find((x) => x.kind === "ammo" && !x.taken)!;
  const before = g.res[a.index][0];
  put(m, "p0", am.x, am.z);
  run(m, DT * 2);
  check(am.taken && g.res[a.index][0] > before, "walking over ammo takes it");
  const pl = g.pickups.find((x) => x.kind === "plate" && !x.taken)!;
  put(m, "p0", pl.x, pl.z);
  run(m, DT * 2);
  check(pl.taken && g.armour[a.index] === GUNS.armour.plate, `a plate: +${GUNS.armour.plate} armour`);
}

console.log("things that break:");
{
  const m = newMatch(6, bare("find-the-flag"));
  const g = m.module<GunsModule>("guns")!;
  toPlay(m);
  clear(m, ["p0", "p1"]);
  const a = m.get("p0")!;
  const crate = g.breakables.find((b) => b.kind === "crate")!;
  put(m, "p0", crate.x + 5, crate.z);
  const n0 = g.pickups.length;
  const ev: MatchEvent[] = [];
  for (let k = 0; k < 6 && !crate.broken; k++) shoot(m, a, crate.x, crate.h + 0.45, crate.z, ev);
  check(crate.broken && ev.some((e) => e.type === "brk" && e.b === crate.index) && g.pickups.length === n0 + 1, "a crate shot to pieces gives loot");
  // A drum with open ground round it (the city's props can stand between a drum and the spots below).
  const open = (b: { x: number; z: number; h: number }) => m.world.space.lineClear(b.x, b.z, b.x - 1.8, b.z + 0.5, b.h + 0.5) && m.world.space.lineClear(b.x + 9, b.z, b.x, b.z, b.h + 0.5);
  const drum = g.breakables.find((b) => b.kind === "drum" && open(b))!;
  put(m, "p0", drum.x + 9, drum.z);
  const near = put(m, "p1", drum.x - 1.8, drum.z + 0.5);
  g.hp[near.index] = 100;
  const ev2: MatchEvent[] = [];
  for (let k = 0; k < 4 && !drum.broken; k++) shoot(m, a, drum.x, drum.h + 0.5, drum.z, ev2);
  check(drum.broken && g.hp[near.index] < 100 && ev2.some((e) => e.type === "dmg" && e.tg === "p1" && e.by === "p0"), `a fuel drum blows: someone 1.9 m away hurt (${(100 - g.hp[near.index]).toFixed(0)}), on the shooter's count`);
}

console.log("cars and melee:");
{
  const s = settingsOf(def("find-the-flag"));
  delete s.modules.zone;
  delete s.modules.airfall;
  s.time = 900;
  const m = newMatch(7, s);
  const g = m.module<GunsModule>("guns")!;
  const v = m.module<VehiclesModule>("vehicles")!;
  toPlay(m);
  clear(m, ["p0", "p1"]);
  const a = m.get("p0")!;
  const car = v.cars[0];
  check(!!car, "a car on the map");
  if (car) {
    // Stand 8 m off it where nothing is in between.
    let ang = 0;
    for (let k = 0; k < 16; k++) {
      ang = (k / 16) * Math.PI * 2;
      const dx = Math.cos(ang);
      const dz = Math.sin(ang);
      if (space.ray(car.x + dx * 3, 1.6, car.z + dz * 3, dx, 0, dz, 8) >= 8 && space.floorAt(car.x + dx * 8, car.z + dz * 8, 0).h < 0.3) break;
    }
    put(m, "p0", car.x + Math.cos(ang) * 8, car.z + Math.sin(ang) * 8);
    const d0 = car.damage;
    const evc = shoot(m, a, car.x, car.h + 1.0, car.z);
    if (process.env.DBG) console.log(JSON.stringify(evc.filter((e) => e.type === "fire")), car.x, car.z, car.h, car.kind, car.state);
    check(car.damage > d0, "a bullet dents a car (it smokes, burns and blows in the end)");
  }
  // A fist costs health too (once the last shot's facing has passed).
  stop(m, a);
  run(m, 1);
  const b = put(m, "p1", YX + 1.2, YZ);
  put(m, "p0", YX, YZ, Math.PI / 2);
  g.hp[b.index] = 100;
  m.setActions("p0", (1 << 2) | 1, 0);
  const evm = run(m, 1.2);
  if (process.env.DBG) console.log(JSON.stringify(evm.filter((e) => ["swing", "hit", "miss", "dmg"].includes(e.type))));
  check(g.hp[b.index] < 100, `melee is the backup: a landed fist costs ${GUNS.melee.fist}`);
}

console.log("the phone's copy (mirror):");
{
  const srv = newMatch(8, bare("find-the-flag"));
  const ph = new Match({ seed: 8, world, settings: bare("find-the-flag"), countdown: 0.1, contestants: srv.contestants.map((c) => ({ id: c.id, name: c.name, bot: false })), mirror: true });
  const sg = srv.module<GunsModule>("guns")!;
  const pg = ph.module<GunsModule>("guns")!;
  check(pg.pickups.length === sg.pickups.length && pg.breakables.length === sg.breakables.length && pg.pickups.every((p, i) => p.x === sg.pickups[i].x && p.gun === sg.pickups[i].gun && p.rarity === sg.pickups[i].rarity), "the copy places the same loot, crates and drums from the seed");
  const ids = srv.contestants.map((c) => c.id);
  const pass = (list: MatchEvent[]) => {
    for (const e of list) {
      const w = encodeEvent(e, (id) => ids.indexOf(id));
      const d = decodeEvent(JSON.parse(JSON.stringify(w)), (i) => ids[i] ?? null);
      if (d) ph.applyRemote(d);
    }
  };
  pass(toPlay(srv));
  clear(srv, ["p0", "p1"]);
  const a = put(srv, "p0", YX, YZ);
  const b = put(srv, "p1", YX + 7, YZ);
  const p = sg.pickups.find((q) => q.kind === "gun")!;
  put(srv, "p0", p.x + 0.4, p.z);
  srv.setInteract("p0", 1, false);
  pass(run(srv, DT * 2));
  put(srv, "p0", b.x - 7, b.z);
  for (let k = 0; k < 3; k++) pass(shoot(srv, a, b.x, b.h + 1.0, b.z));
  ph.elapsed = srv.elapsed;
  check(pg.gun[a.index][1] === sg.gun[a.index][1] && pg.rarity[a.index][1] === sg.rarity[a.index][1] && pg.pickups[p.index].taken, "the copy knows your new gun and that it was taken");
  check(Math.abs(pg.hp[b.index] - sg.hp[b.index]) < 0.11 && pg.mag[a.index][1] === sg.mag[a.index][1], `the copy has their health (${pg.hp[b.index]}) and your magazine (${pg.mag[a.index][1]})`);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
