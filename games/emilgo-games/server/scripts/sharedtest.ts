// Shared gameplay (SPEC-V3 Phase 3): the match core and its first modules —
// the zone, items and the backpack, Airfall — on Naija World, headless, as
// the server will run them. Same seed, same match; every rule the spec gives
// numbers for, checked against those numbers.
//
//   node server/build-tools.mjs && node server/dist/sharedtest.mjs

import { AIRFALL, LOOT, MOVE, RULES, ZONE } from "../../src/config";
import { builtLoot, ITEM_DEFS, type ItemId } from "../../src/content/items";
import { BUILTIN_MANIFEST } from "../../src/content/modes";
import { Match, settingsOf, type MatchSettings, type MatchWorld } from "../../src/game/core/match";
import type { MatchEvent } from "../../src/game/core/module";
import { reachOf } from "../../src/game/core/reach";
import { Space, STEP } from "../../src/game/core/space";
import type { AirfallModule } from "../../src/game/modules/airfall";
import type { ItemsModule } from "../../src/game/modules/items";
import type { ZoneModule } from "../../src/game/modules/zone";
import type { GunsModule } from "../../src/game/modules/guns";
import { buildNaijaWorld, SURFACE_OF } from "../../src/maps/open/naija";
import { Rng } from "../../src/core/rng";

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures++;
}

const DT = 1 / 60;
const layout = buildNaijaWorld();
const space = new Space(layout.solids, { x0: -layout.half, z0: -layout.half, x1: layout.half, z1: layout.half }, (x, z) => SURFACE_OF[layout.groundAt(x, z)]);
const world: MatchWorld = {
  space,
  spawns: layout.spawns,
  places: [...layout.landmarks.map((l) => ({ x: l.x, z: l.z, r: 18 })), ...layout.areas.map((a) => ({ x: a.x, z: a.z, r: a.r }))],
};
const ftf = BUILTIN_MANIFEST.modes.find((m) => m.id === "find-the-flag")!;
/** Find the Flag's shared modules (its own — flags, melee, vehicles — wait for their phases). */
function shared(ranked = false): MatchSettings {
  const s = settingsOf(ftf, ranked);
  s.modules = { zone: s.modules.zone, items: s.modules.items, airfall: s.modules.airfall };
  // v5: the launch modes' numbers are for the big world; these tests run on the small city, so city-sized ones.
  s.modules.zone = { ...s.modules.zone, phases: [[60, 180, 40, 1.0], [180, 110, 40, 1.5], [300, 60, 40, 2.5], [420, 25, 40, 4]] };
  if (!ranked) s.modules.items = { ...s.modules.items, density: 0.8 };
  return s;
}
function newMatch(seed: number, n = 12, settings = shared()): Match {
  return new Match({ seed, world, settings, contestants: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, bot: false })) });
}
/** Step until `t` seconds of play (the countdown first), collecting events. */
function runTo(m: Match, t: number, out: MatchEvent[] = [], each?: () => void): MatchEvent[] {
  let guard = 0;
  while ((m.phase !== "play" || m.elapsed < t - 1e-9) && !m.over && guard++ < 2e6) {
    each?.();
    m.step(DT);
    out.push(...m.drain());
  }
  return out;
}
/** Put a body somewhere and keep it still. */
function put(m: Match, id: string, x: number, z: number): void {
  const c = m.get(id)!;
  c.x = x;
  c.z = z;
  c.vx = c.vz = 0;
  c.inX = c.inZ = 0;
  c.h = space.floorAt(x, z, 0).h;
  c.y = c.vy = 0;
}

// ── The walk grid ──
console.log("the walk grid:");
const t0 = performance.now();
const reach = reachOf(space, layout.spawns[0]);
const reachMs = performance.now() - t0;
let okCells = 0;
for (const v of reach.ok) okCells += v;
check(reachMs < 1500, `built in ${reachMs.toFixed(0)} ms, once per world (${okCells} walkable cells, ${reach.open.length} of them open ground)`);
check(reachOf(space, [0, 0]) === reach, "kept: the second ask is the same grid");
check(layout.spawns.every(([x, z]) => reach.at(x, z)), "every start is on it");

// ── The core ──
console.log("the match core:");
{
  const m = newMatch(11);
  check(m.missing.length === 0 && m.modules.map((x) => x.id).join() === "zone,items,gadgets,airfall", `the modules run in order: ${m.modules.map((x) => x.id).join(", ")}`);
  const ids = new Set(m.contestants.map((c) => `${Math.round(c.x)},${Math.round(c.z)}`));
  check(ids.size === 12, "12 players start on 12 different starts");
  m.setInput("p0", 1, 0);
  const x0 = m.get("p0")!.x;
  for (let i = 0; i < Math.round((RULES.countdown - 0.5) * 60); i++) m.step(DT);
  check(m.phase === "countdown" && m.get("p0")!.x === x0, "nobody moves in the countdown");
  for (let i = 0; i < 60; i++) m.step(DT);
  check(m.phase === "play" && m.get("p0")!.x !== x0, "play starts after it, and bodies move");
  const r = settingsOf(ftf, true);
  check(r.respawn.on === false && r.modules.zone?.scale === 0.85 && r.modules.items?.density === 0.6 && r.modules.flags?.claimHold === 20, "Ranked: no respawns, the zone at 85%, fewer items, a 20 s claim");
  const plain = settingsOf(ftf, false);
  check(plain.respawn.on === true && plain.respawn.delay === 6 && plain.modules.zone?.scale === undefined, "not Ranked: the mode as written (and the definition is left untouched)");
}
{
  // Same seed, same inputs: the same match, event for event.
  const script = (m: Match, rng: Rng) => () => {
    for (const c of m.contestants) {
      if (rng.chance(0.02)) {
        const a = rng.range(0, Math.PI * 2);
        m.setInput(c.id, Math.cos(a), Math.sin(a));
        m.setButtons(c.id, rng.chance(0.5), rng.chance(0.1) ? 1 : 0, c.inJump + (rng.chance(0.1) ? 1 : 0));
      }
      if (rng.chance(0.01)) m.setInteract(c.id, (Math.floor(m.elapsed * 3) & 255), false);
    }
  };
  const a = newMatch(77);
  const b = newMatch(77);
  const ea = runTo(a, 300, [], script(a, new Rng(5)));
  const eb = runTo(b, 300, [], script(b, new Rng(5)));
  const state = (m: Match) => JSON.stringify(m.contestants.map((c) => [c.x.toFixed(4), c.z.toFixed(4), c.status]));
  check(JSON.stringify(ea) === JSON.stringify(eb) && state(a) === state(b), `same seed, same inputs: the same 5 minutes (${ea.length} events, ${ea.filter((e) => e.type === "take").length} pick-ups, ${ea.filter((e) => e.type === "eliminated").length} lasered)`);
  const c = newMatch(78);
  const ec = runTo(c, 300, [], script(c, new Rng(5)));
  check(JSON.stringify(ec) !== JSON.stringify(ea), "another seed: another match");
}
{
  // A crowd in one spot: the spatial hash keeps them apart, and out of the walls.
  const m = newMatch(5, 24);
  runTo(m, 0.01);
  const [sx, sz] = layout.spawns[3];
  for (const c of m.contestants) put(m, c.id, sx + (c.index % 5) * 0.2, sz + Math.floor(c.index / 5) * 0.2);
  for (const c of m.contestants) m.setInput(c.id, sx - c.x, sz - c.z);
  for (let i = 0; i < 120; i++) m.step(DT);
  let closest = Infinity;
  for (const a of m.contestants) for (const b of m.contestants) if (a.index < b.index) closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
  check(closest > MOVE.radius * 2 * 0.8, `24 pushing into one spot stay apart (closest ${closest.toFixed(2)} m; bodies are ${(MOVE.radius * 2).toFixed(2)} m wide)`);
  let inside = 0;
  for (const c of m.contestants) {
    const feet = c.h + c.y;
    for (const i of space.near(c.x, c.z, 0)) {
      const s = space.solids[i];
      if (s.kind !== "box" || s.y0 > feet + 0.05 || s.y1 <= feet + STEP) continue;
      const cs = Math.cos(s.rot);
      const sn = Math.sin(s.rot);
      const lx = (c.x - s.x) * cs - (c.z - s.z) * sn;
      const lz = (c.x - s.x) * sn + (c.z - s.z) * cs;
      if (Math.abs(lx) < s.hx - 0.05 && Math.abs(lz) < s.hz - 0.05) inside++;
    }
  }
  check(inside === 0, "and nobody is pushed into a wall");
}

// ── The zone ──
console.log("the zone:");
{
  const m = newMatch(21);
  const zone = m.module<ZoneModule>("zone")!;
  const ph = zone.phases;
  check(ph.length === 4 && zone.circles.length === 5, "Find the Flag's 4 phases, each with its circle");
  let nested = true;
  for (let k = 1; k < zone.circles.length; k++) {
    const a = zone.circles[k - 1];
    const b = zone.circles[k];
    if (Math.hypot(a.x - b.x, a.z - b.z) + b.r > a.r + 1e-6) nested = false;
  }
  check(nested, `each circle lies inside the one before (${zone.circles.slice(1).map((c) => `${Math.round(c.r)} m`).join(" → ")})`);
  check(zone.circles.slice(1).every((c) => reach.at(c.x, c.z)), "every centre is ground you can walk to");
  const ranked = newMatch(21, 12, shared(true)).module<ZoneModule>("zone")!;
  check(ranked.phases.every((p, i) => Math.abs(p.r - ph[i].r * 0.85) < 1e-9), "Ranked circles are 85% the size");
  check(JSON.stringify(newMatch(21).module<ZoneModule>("zone")!.circles) === JSON.stringify(zone.circles) && JSON.stringify(newMatch(22).module<ZoneModule>("zone")!.circles) !== JSON.stringify(zone.circles), "same seed, same circles; another seed, others");

  const ev: MatchEvent[] = [];
  runTo(m, ph[0].start - ZONE.warn - 0.5, ev);
  check(!ev.some((e) => e.type === "zone"), "nothing announced before its time");
  runTo(m, ph[0].start - ZONE.warn + 0.05, ev);
  const z0 = ev.find((e) => e.type === "zone");
  check(!!z0 && z0.type === "zone" && z0.phase === 0 && z0.at === ph[0].start && Math.round(z0.r) === Math.round(ph[0].r), `the first circle shows ${ZONE.warn} s before it closes`);
  runTo(m, ph[0].start + ph[0].over / 2);
  const mid = (zone.circles[0].r + zone.circles[1].r) / 2;
  check(Math.abs(zone.now.r - mid) < 1, `halfway through closing, halfway there (${zone.now.r.toFixed(0)} m, ${mid.toFixed(0)} expected)`);
  runTo(m, ph[0].start + ph[0].over + 1);
  check(Math.abs(zone.now.r - ph[0].r) < 1e-6, "closed: the circle is the phase's");

  // Outside: a long grace; then the laser; ZONE.laser later, out.
  let far = reach.open[0];
  let farD = 0;
  for (const k of reach.open) {
    const [x, z] = reach.centre(k);
    const d = Math.hypot(x - zone.now.x, z - zone.now.z);
    if (d > farD) {
      farD = d;
      far = k;
    }
  }
  const [fx, fz] = reach.centre(far);
  const c = m.get("p0")!;
  const t1 = m.elapsed;
  const evs: MatchEvent[] = [];
  runTo(m, t1 + 4, evs, () => put(m, "p0", fx, fz));
  // v5: a long grace first, then health falls slowly, and only the last of it brings the laser.
  const want = 4 / ZONE.grace;
  check(Math.abs(zone.exposureOf(0) - want) < 0.01, `outside: ${ZONE.grace} s of grace (${(zone.exposureOf(0) * 100).toFixed(1)}% after 4 s)`);
  m.setEffect(c, "shield", 2);
  const before = zone.exposureOf(0);
  runTo(m, t1 + 6, evs, () => put(m, "p0", fx, fz));
  check(Math.abs(zone.exposureOf(0) - before) < 0.01, "a Zone Shield: no exposure while it lasts");
  const fullAt = t1 + 6 + (1 - zone.exposureOf(0)) * ZONE.grace;
  runTo(m, fullAt - 1, evs, () => put(m, "p0", fx, fz));
  check(c.status === "alive" && !evs.some((e) => e.type === "laser" && e.id === "p0"), "nothing happens before the grace ends");
  const bleed = m.module("guns") ? 0 : ZONE.bleed;
  runTo(m, fullAt + bleed + 0.5, evs, () => put(m, "p0", fx, fz));
  const laser = evs.find((e) => e.type === "laser" && e.id === "p0");
  check(!!laser && laser.type === "laser", `the laser after the grace and the slow loss (at ${fullAt.toFixed(1)} + ${bleed} s)`);
  check(c.status === "alive" && zone.doomed(0), `it takes ${ZONE.laser} s to come down`);
  const hitAt = laser && laser.type === "laser" ? laser.hitAt : fullAt;
  runTo(m, hitAt + 0.1, evs, () => c.status === "alive" && put(m, "p0", fx, fz));
  const out = evs.find((e) => e.type === "eliminated" && e.id === "p0");
  check(!!out && c.status === "eliminated" && c.cause === "zone", "then hits: out, by the zone");
  const back = evs.length;
  runTo(m, hitAt + 6.2, evs);
  const re = evs.slice(back).find((e) => e.type === "respawn" && e.id === "p0");
  const safe = zone.safe();
  check(!!re && c.status === "alive" && Math.hypot(c.x - safe.x, c.z - safe.z) <= safe.r * 0.9 && zone.exposureOf(0) === 0, `back ${ftf.respawn.delay} s later, inside the zone, the meter empty`);

  // Inside: it drains; a Zobo Flask takes 40% off.
  const m2 = newMatch(21);
  const z2 = m2.module<ZoneModule>("zone")!;
  runTo(m2, ph[0].start + ph[0].over + 1);
  runTo(m2, m2.elapsed + 6, [], () => put(m2, "p1", fx, fz));
  const e6 = z2.exposureOf(1);
  const [ix, iz] = [z2.now.x, z2.now.z];
  const ic = reach.cell(ix, iz);
  const [sx, sz] = ic >= 0 && reach.ground[ic] ? [ix, iz] : reach.centre(reach.open.find((k) => Math.hypot(reach.centre(k)[0] - ix, reach.centre(k)[1] - iz) < 20)!);
  runTo(m2, m2.elapsed + 2, [], () => put(m2, "p1", sx, sz));
  check(Math.abs(z2.exposureOf(1) - Math.max(0, e6 - (2 * ZONE.forget) / ZONE.grace)) < 0.01, `inside: it empties in ${ZONE.grace / ZONE.forget} s`);
  const items = m2.module<ItemsModule>("items")!;
  items.packs[1][0] = "zobo";
  const ez = z2.exposureOf(1);
  m2.setPack("p1", (1 << 5) | 0);
  m2.step(DT);
  check(Math.abs(z2.exposureOf(1) - Math.max(0, ez - 0.4 - DT * ZONE.drain)) < 0.01 && items.packs[1][0] === null, "a Zobo Flask takes 40% off the meter, and is gone");
}
{
  // v6, COD-style with health: after the warning the gas takes ZONE.dps a second through armour; at 0 you're out at once.
  const s3 = shared();
  s3.modules.guns = {};
  const m3 = newMatch(31, 12, s3);
  const z3 = m3.module<ZoneModule>("zone")!;
  const g3 = m3.module<GunsModule>("guns")!;
  // The first circle closed: there's an outside to stand in.
  runTo(m3, z3.phases[0].start + z3.phases[0].over + 1);
  let far = reach.open[0];
  let farD = 0;
  for (const k of reach.open) {
    const [x, z] = reach.centre(k);
    const d = Math.hypot(x - z3.now.x, z - z3.now.z);
    if (d > farD) {
      farD = d;
      far = k;
    }
  }
  const [gx, gz] = reach.centre(far);
  const c3 = m3.get("p2")!;
  g3.armour[c3.index] = 50;
  const ev3: MatchEvent[] = [];
  // The warning first (the meter may already be part full), with health topped up.
  runTo(m3, m3.elapsed + ZONE.grace + 0.5, ev3, () => put(m3, "p2", gx, gz));
  g3.hp[c3.index] = 100;
  runTo(m3, m3.elapsed + 3, ev3, () => put(m3, "p2", gx, gz));
  const lost = 100 - g3.hp[c3.index];
  const dps = z3.dps(m3.elapsed);
  check(lost >= 2 * dps - 0.01 && lost <= 4 * dps + 0.01 && g3.armour[c3.index] === 50, `after ${ZONE.grace} s of warning the gas takes ${dps} a second here, through armour (lost ${lost.toFixed(0)} in 3 s)`);
  g3.hp[c3.index] = 2;
  runTo(m3, m3.elapsed + 1.1, ev3, () => c3.status === "alive" && put(m3, "p2", gx, gz));
  check(c3.status === "eliminated" && c3.cause === "zone" && !ev3.some((e) => e.type === "laser"), "at 0 health: out at once, by the zone, no laser to wait for");
  check(z3.dps(0) === ZONE.dps[0] && z3.dps(1e6) === ZONE.dps[Math.min(z3.phases.length, ZONE.dps.length - 1)] && z3.dps(1e6) > z3.dps(0), "it bites harder each circle");
}

// ── Items ──
console.log("items and the backpack:");
{
  const m = newMatch(31);
  const items = m.module<ItemsModule>("items")!;
  const want = Math.round((LOOT.perHectare * 400 * 400 * 0.8) / 10000);
  check(items.items.length >= want * 0.95 && items.items.length <= want, `${items.items.length} scattered (${LOOT.perHectare} a hectare × density 0.8 = ${want})`);
  const built = new Set(builtLoot("ffa-core").map(([id]) => id));
  check(items.items.every((it) => built.has(it.kind)), `only items that work: ${[...built].join(", ")}`);
  check(items.items.every((it) => reach.ground[reach.cell(it.x, it.z)] === 1), "every one on open ground you can walk to");
  let gap = Infinity;
  for (const a of items.items) for (const b of items.items) if (a.index < b.index) gap = Math.min(gap, Math.hypot(a.x - b.x, a.z - b.z));
  check(gap >= LOOT.spacing, `never closer than ${LOOT.spacing} m (${gap.toFixed(1)})`);
  const atPlaces = items.items.filter((it) => world.places.some((p) => Math.hypot(it.x - p.x, it.z - p.z) <= p.r + 8)).length / items.items.length;
  check(atPlaces >= LOOT.atPlaces * 0.9, `${(atPlaces * 100).toFixed(0)}% at the named places (${Math.round(LOOT.atPlaces * 100)}% aimed, plus the luck of the rest)`);
  const again = newMatch(31).module<ItemsModule>("items")!;
  const other = newMatch(32).module<ItemsModule>("items")!;
  check(JSON.stringify(again.items) === JSON.stringify(items.items) && JSON.stringify(other.items) !== JSON.stringify(items.items), "same seed, same scatter; every match another");
  const ranked = newMatch(31, 12, shared(true)).module<ItemsModule>("items")!;
  check(ranked.items.length < items.items.length * 0.8, `Ranked scatters fewer (${ranked.items.length})`);

  runTo(m, 1);
  const it = items.items.find((x) => x.h === 0 && reach.at(x.x + 1.2, x.z))!;
  const ev: MatchEvent[] = [];
  const c = m.get("p0")!;
  put(m, "p0", it.x + LOOT.reach + 0.3, it.z);
  m.setInteract("p0", 1, false);
  runTo(m, m.elapsed + DT, ev);
  check(!ev.some((e) => e.type === "take") && !it.taken, `a tap out of reach takes nothing (${(LOOT.reach + 0.3).toFixed(1)} m)`);
  put(m, "p0", it.x + 1.2, it.z);
  m.setInteract("p0", 2, false);
  runTo(m, m.elapsed + DT, ev);
  const take = ev.find((e) => e.type === "take");
  check(!!take && take.type === "take" && take.item === it.index && it.taken && items.packs[0][0] === it.kind, `a tap within ${LOOT.reach} m: into the backpack (${ITEM_DEFS[it.kind].name.en})`);
  m.setInteract("p0", 2, false);
  runTo(m, m.elapsed + 0.2, ev);
  check(ev.filter((e) => e.type === "take").length === 1, "holding the same tap takes nothing more");

  // Full.
  for (let i = 0; i < LOOT.slots; i++) items.packs[0][i] = "zobo";
  const it2 = items.items.find((x) => !x.taken && x.h === 0 && reach.at(x.x + 1, x.z))!;
  put(m, "p0", it2.x + 1, it2.z);
  m.setInteract("p0", 3, false);
  runTo(m, m.elapsed + DT, ev);
  check(ev.some((e) => e.type === "full") && !it2.taken, `${LOOT.slots} slots: a full backpack leaves it where it is`);

  // Big Bag: two more slots, once a life.
  items.packs[0][0] = "big-bag";
  items.packs[0][1] = "big-bag";
  m.setPack("p0", (1 << 5) | 0);
  runTo(m, m.elapsed + DT, ev);
  m.setPack("p0", (2 << 5) | 1);
  runTo(m, m.elapsed + DT, ev);
  check(items.packs[0].length === LOOT.slots + 2 && items.packs[0][1] === "big-bag", `a Big Bag: ${LOOT.slots + 2} slots (a second one stays in the bag)`);

  // Drop: in front of you, and it can be taken again.
  const dropped = ev.length;
  m.setPack("p0", (3 << 5) | 16 | 2);
  runTo(m, m.elapsed + DT, ev);
  const d = ev.slice(dropped).find((e) => e.type === "drop");
  check(!!d && d.type === "drop" && d.kind === "zobo" && items.packs[0][2] === null && Math.hypot(d.x - c.x, d.z - c.z) < 1.2, "drop: on the ground in front of you");

  // Death: the backpack becomes a loot bag; someone else takes what fits.
  const kinds = items.packs[0].filter((k) => k).length;
  m.eliminate(c, "hazard");
  const evs = m.drain();
  const bag = evs.find((e) => e.type === "bag");
  check(!!bag && bag.type === "bag" && bag.kinds.length === kinds && items.packs[0].every((k) => k === null) && items.packs[0].length === LOOT.slots, `out: the ${kinds} items drop as a loot bag; the backpack is empty (and back to ${LOOT.slots} slots)`);
  for (let i = 0; i < LOOT.slots - 3; i++) items.packs[1][i] = "kola";
  // Beside the bag, on the side away from the item just dropped (the nearest is taken).
  const bg = items.bags[0];
  const away = d && d.type === "drop" ? Math.atan2(bg.x - d.x, bg.z - d.z) : 0;
  put(m, "p1", bg.x + Math.sin(away) * 0.5, bg.z + Math.cos(away) * 0.5);
  m.setInteract("p1", 1, false);
  m.step(DT);
  const loot = m.drain().find((e) => e.type === "loot");
  check(!!loot && loot.type === "loot" && loot.kinds.length === 3 && loot.left === kinds - 3, `the loot bag: 3 fit, ${kinds - 3} stay in the bag`);

  // Kola Rush: 15% faster for 10 s.
  const m3 = newMatch(41);
  runTo(m3, 1);
  const k = m3.get("p0")!;
  put(m3, "p0", -30, 0);
  m3.setInput("p0", 1, 0);
  runTo(m3, m3.elapsed + 1);
  const v0 = Math.hypot(k.vx, k.vz);
  m3.module<ItemsModule>("items")!.packs[0][0] = "kola";
  m3.setPack("p0", 1 << 5);
  runTo(m3, m3.elapsed + 1);
  const v1 = Math.hypot(k.vx, k.vz);
  put(m3, "p0", -30, 0);
  m3.setInput("p0", 1, 0);
  runTo(m3, m3.elapsed + 10);
  const v2 = Math.hypot(k.vx, k.vz);
  check(Math.abs(v0 - MOVE.run) < 0.01 && Math.abs(v1 - MOVE.run * 1.15) < 0.01 && Math.abs(v2 - MOVE.run) < 0.01, `Kola Rush: ${v0.toFixed(2)} → ${v1.toFixed(2)} m/s, back to ${v2.toFixed(2)} after 10 s`);
}

// ── Airfall ──
console.log("Airfall:");
{
  const m = newMatch(51);
  const air = m.module<AirfallModule>("airfall")!;
  const zone = m.module<ZoneModule>("zone")!;
  const gaps = air.times.map((t, i) => t - (i ? air.times[i - 1] : 0));
  check(air.times.length >= 1 && air.times.length <= 3 && gaps.every((g) => g >= 180 && g <= 240) && air.times.every((t) => t <= ftf.time - AIRFALL.minLeft), `${air.times.length} drops, ${gaps.map((g) => `${g.toFixed(0)} s`).join(", ")} apart (3 at most, 180–240 s)`);
  const ev: MatchEvent[] = [];
  const land = air.times[0];
  runTo(m, land - AIRFALL.flare - 0.1, ev);
  check(!ev.some((e) => e.type === "flare"), "no flare before its time");
  runTo(m, land - AIRFALL.flare + 0.05, ev);
  const flare = ev.find((e) => e.type === "flare");
  const safe = zone.safe();
  check(!!flare && flare.type === "flare" && Math.abs(flare.land - land) < 1e-9, `the flare goes up ${AIRFALL.flare} s before it lands`);
  const crate = air.crates[0];
  check(reach.ground[reach.cell(crate.x, crate.z)] === 1 && Math.hypot(crate.x - safe.x, crate.z - safe.z) <= safe.r * 0.7 + 1, "where it lands: open ground, inside the circle the zone is closing to");
  put(m, "p2", crate.x + 1, crate.z);
  m.setInteract("p2", 0, true);
  runTo(m, land - 1, ev, () => put(m, "p2", crate.x + 1, crate.z));
  check(air.opening(2) === 0 && !crate.opened, "it can't be opened in the air");
  runTo(m, land + 0.05, ev, () => put(m, "p2", crate.x + 1, crate.z));
  check(ev.some((e) => e.type === "landed"), "it lands");
  runTo(m, land + 2.5, ev, () => put(m, "p2", crate.x + 1, crate.z));
  check(Math.abs(air.opening(2) - (2.5 - 0.05) / AIRFALL.open) < 0.05 && !crate.opened, `holding: ${(air.opening(2) * 100).toFixed(0)}% open`);
  m.setInteract("p2", 0, false);
  runTo(m, m.elapsed + DT, ev);
  check(air.opening(2) === 0, "let go: it starts again");
  m.setInteract("p2", 0, true);
  runTo(m, m.elapsed + 1.5, ev, () => put(m, "p2", crate.x + 1, crate.z));
  runTo(m, m.elapsed + DT, ev, () => put(m, "p2", crate.x + AIRFALL.reach + 1, crate.z));
  check(air.opening(2) === 0, "walk off: it starts again");
  // p3 starts first, p2 joins a second later: p3 gets there first.
  m.setInteract("p2", 0, false);
  put(m, "p3", crate.x - 1, crate.z);
  m.setInteract("p3", 0, true);
  runTo(m, m.elapsed + 1, ev, () => put(m, "p3", crate.x - 1, crate.z));
  m.setInteract("p2", 0, true);
  const from = ev.length;
  runTo(m, m.elapsed + AIRFALL.open - 0.9, ev, () => {
    put(m, "p2", crate.x + 1, crate.z);
    put(m, "p3", crate.x - 1, crate.z);
  });
  const open = ev.slice(from).find((e) => e.type === "open");
  const rare = new Set(builtLoot("airfall").map(([id]) => id));
  const core = new Set(builtLoot("ffa-core").map(([id]) => id));
  check(!!open && open.type === "open" && open.id === "p3" && crate.opened && air.opening(2) === 0, `held ${AIRFALL.open} s: open, by the first to start (the other's hold ends with it)`);
  const got = open && open.type === "open" ? open.kinds : [];
  check(got.length === AIRFALL.rare + AIRFALL.core && rare.has(got[0]) && got.slice(1).every((k) => core.has(k as ItemId)), `inside: ${got.map((k) => ITEM_DEFS[k].name.en).join(", ")} (${AIRFALL.rare} rare, ${AIRFALL.core} core)`);
  const pack = m.module<ItemsModule>("items")!.packs[3];
  check(got.every((k) => pack.includes(k)), "straight into the backpack");
}

// ── Cost ──
{
  const m = newMatch(61);
  runTo(m, 1);
  const rng = new Rng(9);
  const t = performance.now();
  let steps = 0;
  for (let f = 0; f < 60 * 60; f++) {
    if (f % 30 === 0) for (const c of m.contestants) m.setInput(c.id, rng.range(-1, 1), rng.range(-1, 1));
    m.step(DT);
    m.drain();
    steps++;
  }
  const ms = (performance.now() - t) / steps;
  check(ms < 0.5, `a 12-player step with the zone, items and Airfall costs ${(ms * 1000).toFixed(0)} µs (a 60 Hz tick has 16,667)`);
}

// ── v6: walk-through pickup ──
console.log("walk-through pickup:");
{
  const m4 = newMatch(41);
  runTo(m4, 1);
  const it4 = m4.module<ItemsModule>("items")!;
  const c4 = m4.get("p4")!;
  const g4 = it4.items.find((x) => !x.taken && reach.at(x.x + 0.5, x.z))!;
  const ev4: MatchEvent[] = [];
  runTo(m4, m4.elapsed + 0.2, ev4, () => put(m4, "p4", g4.x + 0.5, g4.z));
  check(g4.taken && it4.packs[c4.index].includes(g4.kind) && ev4.some((e) => e.type === "take" && e.id === "p4"), "walk onto an item: it's in the backpack, no tap");
  const slot = it4.packs[c4.index].indexOf(g4.kind);
  m4.setPack("p4", (1 << 5) | 16 | slot);
  const ev5: MatchEvent[] = [];
  runTo(m4, m4.elapsed + 1, ev5, () => put(m4, "p4", g4.x + 0.5, g4.z));
  const dropped = ev5.find((e) => e.type === "drop" && e.id === "p4");
  const back = dropped && dropped.type === "drop" ? it4.items[dropped.item] : null;
  check(!!back && !back.taken, "your own drop stays on the ground while you stand by it");
  // Away: 6 m off, wherever there's ground (the item may lie by the world's edge).
  const away = ([[6, 0], [-6, 0], [0, 6], [0, -6]] as const).find(([dx, dz]) => reach.at(g4.x + dx, g4.z + dz)) ?? [6, 0];
  runTo(m4, m4.elapsed + 0.2, [], () => put(m4, "p4", g4.x + away[0], g4.z + away[1]));
  runTo(m4, m4.elapsed + 0.2, [], () => put(m4, "p4", back ? back.x : g4.x, back ? back.z : g4.z));
  check(!!back && back.taken, "walk away and back: it's picked up again");
  // A full backpack leaves it, silently (no "full" every step).
  const full = it4.items.find((x) => !x.taken && x !== back && reach.at(x.x + 0.5, x.z))!;
  it4.packs[c4.index].fill("smoke-pot");
  const ev6: MatchEvent[] = [];
  runTo(m4, m4.elapsed + 0.5, ev6, () => put(m4, "p4", full.x + 0.5, full.z));
  check(!full.taken && !ev6.some((e) => e.type === "full"), "a full backpack walks past it, without a word");
}

// ── v6: the tactical sprint ──
console.log("the tactical sprint:");
{
  // A Free For All match (they all run melee: that's what brings the burst).
  const s5 = shared();
  s5.modules.melee = { set: "gidigbo", props: 0 };
  const m5 = newMatch(51, 12, s5);
  runTo(m5, 1);
  const c5 = m5.get("p5")!;
  const at = reach.centre(reach.open[Math.floor(reach.open.length / 2)]);
  c5.x = at[0];
  c5.z = at[1];
  c5.stamina = 1;
  // v6 max: the burst needs the double push (inTac); a plain sprint has none.
  const plain: number[] = [];
  runTo(m5, m5.elapsed + 1.5, [], () => {
    m5.setInput("p5", 0, -1);
    m5.setButtons("p5", true, 0, 0);
    plain.push(Math.hypot(c5.vx, c5.vz));
  });
  check(Math.max(...plain) <= MOVE.sprint + 0.01, `a plain sprint has no burst (${Math.max(...plain).toFixed(1)} m/s)`);
  // Stop, rest, then the double push.
  runTo(m5, m5.elapsed + 4, [], () => {
    m5.setInput("p5", 0, 0);
    m5.setButtons("p5", false, 0, 0);
  });
  c5.stamina = 1;
  const speeds: number[] = [];
  runTo(m5, m5.elapsed + 3, [], () => {
    m5.setInput("p5", 0, 1);
    m5.setButtons("p5", true, 0, 0, true);
    speeds.push(Math.hypot(c5.vx, c5.vz));
  });
  const early = Math.max(...speeds.slice(30, 90));
  const late = Math.max(...speeds.slice(140, 170));
  check(early > MOVE.sprint + 0.5 && early <= MOVE.tac + 0.01, `a double push opens with the burst (${early.toFixed(1)} m/s)`);
  check(Math.abs(late - MOVE.sprint) < 0.3, `then runs on at a sprint (${late.toFixed(1)} m/s)`);
  // Without Free For All's modules (Ball Haunt, Dead Streets): no burst.
  const m6 = newMatch(52);
  runTo(m6, 1);
  const c6 = m6.get("p5")!;
  c6.x = at[0];
  c6.z = at[1];
  c6.stamina = 1;
  let top6 = 0;
  runTo(m6, m6.elapsed + 1.5, [], () => {
    m6.setInput("p5", 0, -1);
    m6.setButtons("p5", true, 0, 0);
    top6 = Math.max(top6, Math.hypot(c6.vx, c6.vz));
  });
  check(top6 <= MOVE.sprint + 0.01, `elsewhere a sprint is a sprint (${top6.toFixed(1)} m/s)`);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
