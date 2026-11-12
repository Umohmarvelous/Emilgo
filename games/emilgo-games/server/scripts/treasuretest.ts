// Treasure Hunt (v5, the owner's first Free For All game): the boxes spread
// over every place, the machine on open ground, a box opened by holding, the
// treasures dropped by a body and taken by whoever walks over them, the upload
// (all five, in the ring, the leader only; leaving it starts again), the time
// up, a squad's hand-over, the phone's copy, and the XP lines adding up.
//
//   node server/build-tools.mjs && node server/dist/treasuretest.mjs

import { GROWTH, GUNS, TREASURE } from "../../src/config";
import { BUILTIN_MANIFEST, type ModeDef } from "../../src/content/modes";
import { Match, settingsOf } from "../../src/game/core/match";
import type { MatchEvent } from "../../src/game/core/module";
import { RING_MIN, type TreasureModule } from "../../src/game/modules/treasure";
import type { ZoneModule } from "../../src/game/modules/zone";
import type { ItemsModule } from "../../src/game/modules/items";
import type { GunsModule } from "../../src/game/modules/guns";
import { builtLoot, ITEM_DEFS, LOOT_TABLES, type ItemId } from "../../src/content/items";
import type { GadgetsModule } from "../../src/game/modules/gadgets";
import { KILL_XP, KILL_XP_CAP, matchXp, xpParts, type MatchFacts } from "../../src/rank/xp";
import { worldFor } from "../src/ffa";

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures++;
}

const DT = 1 / 60;
const live = BUILTIN_MANIFEST.modes.find((d) => d.id === "treasure-hunt")!;
// v7 (12 Nov): the live mode keeps the v6 rules with its chests gathered round the machine (its own section at the
// end); most of this file tests the rules on the v5 definition (44 chests over the whole world).
const def: ModeDef = { ...live, time: 720, modules: { ...live.modules, treasure: { need: 5, boxes: 44, upload: 12 } } };
const world = worldFor(def.map);

function fresh(seed: number, n: number, squads?: number[], secret = 99, mirror = false, d: ModeDef = def): Match {
  const m = new Match({
    seed,
    world,
    settings: settingsOf(d),
    countdown: 0.1,
    secret,
    mirror,
    contestants: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, bot: false, ...(squads ? { squad: squads[i] } : {}) })),
  });
  if (!mirror) while (m.phase !== "play") m.step(DT);
  return m;
}
const tmOf = (m: Match) => m.module<TreasureModule>("treasure")!;
const run = (m: Match, s: number, out?: MatchEvent[]) => {
  for (let k = 0; k < Math.round(s / DT); k++) {
    m.step(DT);
    const ev = m.drain();
    out?.push(...ev);
  }
};
const put = (m: Match, id: string, x: number, z: number, h: number) => {
  const c = m.get(id)!;
  c.x = x;
  c.z = z;
  c.h = h;
  c.vx = c.vz = 0;
  m.setInput(id, 0, 0);
};
let press = 0;
const hold = (m: Match, id: string, on: boolean) => m.setInteract(id, ++press & 255, on);

console.log("the boxes and the machine:");
{
  const m = fresh(5, 4);
  const tm = tmOf(m);
  const b = tm.boxes;
  let apart = Infinity;
  for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) apart = Math.min(apart, Math.hypot(b[i].x - b[j].x, b[i].z - b[j].z));
  check(b.length === TREASURE.boxes, `${b.length} boxes`);
  check(apart >= TREASURE.apart - 0.01, `at least ${TREASURE.apart} m apart (closest ${apart.toFixed(0)} m)`);
  check(b.every((x) => m.reach.at(x.x, x.z)), "every box stands on ground you can walk to");
  const named = m.world.named ?? [];
  const covered = named.filter((p) => b.some((x) => Math.hypot(x.x - p.x, x.z - p.z) <= Math.max(p.r, 30) + 4));
  check(named.length > 0 && covered.length >= Math.ceil(named.length * 0.9), `boxes in ${covered.length} of ${named.length} places`);
  check(tm.treasures.length === 5 && new Set(tm.treasures.map((t) => t.box)).size === 5 && tm.treasures.every((t) => t.box >= 0 && t.holder < 0), "five treasures, each in its own box");
  const p = tm.machine!;
  check(!!p && m.reach.at(p.x, p.z) && m.world.space.near(p.x, p.z, TREASURE.field).length === 0, `one machine, on open ground with nothing within ${TREASURE.field} m`);
  const again = fresh(5, 4);
  const other = fresh(5, 4, undefined, 1234);
  check(tmOf(again).boxes.every((x, i) => x.x === b[i].x && x.z === b[i].z) && tmOf(again).machine!.x === p.x, "the same seed: the same boxes and machine (a phone's copy agrees)");
  check(tmOf(other).treasures.some((t, i) => t.box !== tm.treasures[i].box), "which boxes are real comes from the server's secret");
  const ph = fresh(5, 4, undefined, 99, true);
  check(tmOf(ph).treasures.every((t) => t.box === -2), "the phone's copy doesn't know which boxes are real");
}

console.log("opening, dropping, taking:");
{
  const m = fresh(6, 4);
  const tm = tmOf(m);
  const real = new Set(tm.treasures.map((t) => t.box));
  const empty = tm.boxes.find((b) => !real.has(b.index))!;
  put(m, "p0", empty.x + 0.6, empty.z, empty.h);
  hold(m, "p0", true);
  run(m, TREASURE.open * 0.5);
  check(!empty.opened && tm.opening(0) > 0.3, "holding: it opens slowly");
  hold(m, "p0", false);
  run(m, 0.1);
  check(tm.opening(0) === 0, "let go: it starts again");
  hold(m, "p0", true);
  const ev: MatchEvent[] = [];
  run(m, TREASURE.open + 0.1, ev);
  check(empty.opened && tm.count[0] === 0 && ev.some((e) => e.type === "tbox" && e.found === -1), "an empty box: opened, nothing in it");
  for (const tr of tm.treasures) {
    const b = tm.boxes[tr.box];
    put(m, "p0", b.x + 0.6, b.z, b.h);
    hold(m, "p0", true);
    run(m, TREASURE.open + 0.1);
  }
  hold(m, "p0", false);
  check(tm.count[0] === 5 && tm.treasures.every((t) => t.holder === 0 && t.box === -1), "the five found: P0 carries them all");
  const c0 = m.get("p0")!;
  m.eliminate(c0, "shot");
  run(m, DT);
  check(tm.count[0] === 0 && tm.treasures.every((t) => t.holder < 0 && Math.hypot(t.x - c0.x, t.z - c0.z) < 1.5), "P0 shot: all five fall where they died");
  for (const tr of tm.treasures) {
    put(m, "p1", tr.x, tr.z, tr.h);
    run(m, DT * 2);
  }
  check(tm.count[1] === 5 && tm.treasures.every((t) => t.holder === 1), "P1 walks over them: they're P1's");

  console.log("the upload:");
  const p = tm.machine!;
  put(m, "p2", p.x + 3, p.z, p.h);
  run(m, 0.2);
  check(tm.uploader < 0, "with none: nothing uploads");
  put(m, "p1", p.x + 3, p.z + 1, p.h);
  run(m, 0.2);
  check(tm.uploader === 1, "P1 in the ring with all five: the upload starts");
  run(m, tm.uploadTime * 0.5);
  put(m, "p1", p.x + TREASURE.ring + 4, p.z, p.h);
  run(m, 0.1);
  check(tm.uploader < 0 && tm.uploaded === 0 && !m.over, "out of the ring: it stops, and starts again from nothing");
  put(m, "p1", p.x, p.z + 0.2, p.h);
  run(m, DT);
  check(Math.hypot(m.get("p1")!.x - p.x, m.get("p1")!.z - p.z) >= 0.79, "the machine is solid: nobody stands in it");
  run(m, tm.uploadTime + 0.3);
  check(m.over && m.winner?.id === "p1", "the whole upload: P1 wins");
}

console.log("dying in the ring:");
{
  const m = fresh(7, 3);
  const tm = tmOf(m);
  for (const tr of tm.treasures) {
    const b = tm.boxes[tr.box];
    put(m, "p0", b.x + 0.6, b.z, b.h);
    hold(m, "p0", true);
    run(m, TREASURE.open + 0.1);
  }
  hold(m, "p0", false);
  const p = tm.machine!;
  put(m, "p0", p.x + 2, p.z, p.h);
  run(m, 3);
  m.eliminate(m.get("p0")!, "shot");
  run(m, 0.2);
  check(tm.uploader < 0 && tm.count[0] === 0 && !m.over && tm.treasures.every((t) => t.holder < 0), "shot while uploading: the upload stops and all five drop");
}

console.log("squads:");
{
  const m = fresh(8, 4, [0, 0, 1, 1]);
  const tm = tmOf(m);
  check(tm.leaderOf(m, 0) === 0 && tm.leaderOf(m, 1) === 2, "each squad's leader: its first seat");
  const tr = tm.treasures[0];
  const b = tm.boxes[tr.box];
  put(m, "p0", b.x + 40, b.z, b.h);
  put(m, "p1", b.x + 0.6, b.z, b.h);
  hold(m, "p1", true);
  run(m, TREASURE.open + 0.1);
  hold(m, "p1", false);
  check(tm.count[1] === 1, "a mate finds one");
  const c1 = m.get("p1")!;
  put(m, "p0", c1.x + 2, c1.z, c1.h);
  run(m, DT * 2);
  check(tm.count[1] === 0 && tm.count[0] === 1 && tr.holder === 0, "they meet: it goes to the leader");
  // A mate can't upload: give P1 all five, keep the leader far, stand P1 in the ring.
  for (const x of tm.treasures) {
    if (x.holder >= 0) tm.count[x.holder]--;
    x.box = -1;
    x.holder = 1;
  }
  tm.count[1] = 5;
  const p = tm.machine!;
  put(m, "p0", p.x + 80, p.z, p.h);
  put(m, "p1", p.x + 2, p.z, p.h);
  run(m, 0.3);
  check(tm.uploader < 0, "only the leader uploads");
  m.eliminate(m.get("p0")!, "shot");
  run(m, 0.3);
  check(tm.leaderOf(m, 0) === 1 && tm.uploader === 1, "the leader down for good: the next one leads, and uploads");
}

console.log("time up:");
{
  const m = fresh(9, 4);
  const tm = tmOf(m);
  tm.count[2] = 3;
  tm.count[0] = 1;
  tm.timeUp(m);
  check(m.winner?.id === "p2", "the most treasures wins");
  const n = fresh(9, 4);
  const tn = tmOf(n);
  tn.count[1] = 2;
  tn.count[3] = 2;
  tn.timeUp(n);
  check(!n.winner, "a tie: nobody");
  // v7 (question 7): a tie goes to the one still standing.
  const s2 = fresh(9, 4);
  const ts2 = tmOf(s2);
  ts2.count[1] = 2;
  ts2.count[3] = 2;
  s2.contestants[1].status = "eliminated";
  ts2.timeUp(s2);
  check(s2.winner?.id === "p3", "a tie in treasures: the one still standing wins");
  const z = fresh(9, 4);
  tmOf(z).timeUp(z);
  check(!z.winner, "none found: nobody");
}

console.log("the phone's copy:");
{
  const srv = fresh(10, 3);
  const ph = fresh(10, 3, undefined, 0, true);
  const tm = tmOf(srv);
  const tp = tmOf(ph);
  for (const e of srv.drain()) ph.applyRemote(e);
  const sync = () => {
    ph.phase = srv.phase;
    ph.elapsed = srv.elapsed;
    for (const c of srv.contestants) Object.assign(ph.contestants[c.index], { x: c.x, z: c.z, h: c.h, status: c.status });
    for (const e of srv.drain()) ph.applyRemote(e);
    ph.step(DT);
    ph.drain();
  };
  const go = (s: number) => {
    for (let k = 0; k < Math.round(s / DT); k++) {
      srv.step(DT);
      sync();
    }
  };
  for (const tr of tm.treasures.slice(0, 3)) {
    const b = tm.boxes[tr.box];
    put(srv, "p0", b.x + 0.6, b.z, b.h);
    hold(srv, "p0", true);
    go(TREASURE.open + 0.1);
  }
  hold(srv, "p0", false);
  check(tp.count[0] === 3 && tp.treasures.filter((t) => t.holder === 0).length === 3, "it sees P0 find three");
  srv.eliminate(srv.get("p0")!, "shot");
  go(0.1);
  const loose = tp.treasures.filter((t) => t.holder < 0 && t.box === -1);
  check(tp.count[0] === 0 && loose.length === 3 && loose.every((t) => tm.treasures[t.index].x === t.x && tm.treasures[t.index].z === t.z), "it sees them fall, at the same spots");
  for (const t of loose) {
    put(srv, "p2", t.x, t.z, t.h);
    go(DT * 3);
  }
  check(tp.count[2] === 3 && tm.count[2] === 3, "and P2 take them");
  check(tp.boxes.every((b, i) => b.opened === tm.boxes[i].opened), "the same boxes open");
}

console.log("growth and the Map Print:");
{
  const m = fresh(12, 3);
  const items = m.module<ItemsModule>("items")!;
  const guns = m.module<GunsModule>("guns")!;
  const [a, b] = [m.get("p0")!, m.get("p1")!];
  let packN = 0;
  const use = (id: string, kind: ItemId) => {
    const c = m.get(id)!;
    items.packs[c.index][0] = kind;
    m.setPack(id, ((++packN & 511) << 5) | 0);
    run(m, DT * 2);
  };
  const hit = (c: typeof a) => {
    guns.hp[c.index] = GUNS.hp;
    guns.armour[c.index] = 0;
    guns.hurt(m, c, 40, b, false, "shot");
    return GUNS.hp - guns.hp[c.index];
  };
  const plain = hit(a);
  use("p0", "titan-serum");
  check(items.growth[0] === 1 && Math.abs(hit(a) - plain * GROWTH.take[1]) < 0.01, `Titan Serum: level 1, a 40 hit takes ${(plain * GROWTH.take[1]).toFixed(0)}`);
  use("p0", "titan-serum");
  use("p0", "titan-serum");
  use("p0", "titan-serum");
  check(items.growth[0] === GROWTH.max && items.packs[0][0] === "titan-serum" && Math.abs(hit(a) - plain * GROWTH.take[GROWTH.max]) < 0.01, "at the most: half of every hit, and another dose stays in the pack");
  m.eliminate(a, "shot");
  run(m, DT);
  check(items.growth[0] === 0, "down: the growth is gone");
  const ev: MatchEvent[] = [];
  m.whispering = true;
  items.packs[1][0] = "map-print";
  m.setPack("p1", ((++packN & 511) << 5) | 0);
  run(m, DT * 2, ev);
  const w = m.whispers.splice(0);
  check(m.effects(b).some((e) => e.key === "print" && e.left > 19) && items.printed[1] === 1, "a Map Print: 20 s of the whole map");
  check(w.length === 1 && w[0].id === "p1" && w[0].e.type === "tmap" && !ev.some((e) => e.type === "tmap"), "where the treasures hide goes to its user alone, never in the events everyone hears");
  items.packs[1][0] = "map-print";
  m.setPack("p1", ((++packN & 511) << 5) | 0);
  run(m, DT * 2);
  check(items.packs[1][0] === "map-print" && !m.whispers.length, "a second one: once a match, it stays in the pack");
  // The phone's copy: it learns the boxes from its own whisper only.
  const ph = fresh(12, 3, undefined, 0, true);
  const tp = tmOf(ph);
  const e = w[0].e;
  ph.applyRemote(e);
  check(tp.treasures.every((t, i) => t.box === tmOf(m).treasures[i].box), "the user's phone, told, knows which chests hold them");
}

console.log("XP, line by line:");
{
  const cases: MatchFacts[] = [
    { players: 12, place: 1, won: true, stayed: true, objective: 5, objectiveTop: 5, kills: 4, seconds: 600 },
    { players: 12, place: 7, won: false, stayed: true, objective: 1, objectiveTop: 5, kills: 30, seconds: 200, ranked: true, firstToday: true },
    { players: 1, place: 1, won: false, stayed: true, objective: 0, objectiveTop: 0 },
  ];
  check(cases.every((f) => Math.round(xpParts(f).reduce((a, p) => a + p.xp, 0)) === matchXp(f)), "the rewards screen's lines add up to the XP the server pays");
  const k = xpParts(cases[1]).find((p) => p.label === "Kills");
  check(!!k && k.xp === KILL_XP_CAP && k.note === "×30", `kills pay ${KILL_XP} XP each, up to ${KILL_XP_CAP}`);
  check(matchXp({ ...cases[0], kills: 0 }) < matchXp(cases[0]), "kills are rewarded");
}

console.log("v7, 12 Nov, the live mode (the v6 rules, the chests round the machine, the zone the clock):");
{
  const m = fresh(11, 6, undefined, 99, false, live);
  const tm = tmOf(m);
  const c = tm.machine!;
  check(!!c && tm.need === 5 && tm.area > 0, "a machine, all 5 to find");
  check(tm.boxes.length >= 24 && tm.boxes.every((b) => Math.hypot(b.x - c.x, b.z - c.z) <= tm.area + 0.01), `${tm.boxes.length} boxes, every one within ${tm.area} m of the machine`);
  check(tm.treasures.length === 5 && tm.treasures.every((t) => Math.hypot(tm.boxes[t.box].x - c.x, tm.boxes[t.box].z - c.z) <= TREASURE.core + 0.01), `5 real, all within ${TREASURE.core} m of it`);
  const zone = m.module<ZoneModule>("zone")!;
  check(zone.clock, "the zone is the clock");
  check(zone.circles.slice(1, 4).every((q) => Math.hypot(q.x - c.x, q.z - c.z) <= q.r * 0.3 + 1), "the first three circles keep the machine within 0.3 of their radius");
  const last = zone.phases[zone.phases.length - 1];
  check(Math.abs(last.start + last.over - m.settings.time) < 1, `the match ends as the last circle shuts (${m.settings.time} s)`);
  // A find is carried, not a win.
  const first = tm.boxes[tm.treasures[2].box];
  put(m, "p3", first.x + 0.6, first.z, first.h);
  hold(m, "p3", true);
  const ev: MatchEvent[] = [];
  run(m, TREASURE.open + 0.1, ev);
  hold(m, "p3", false);
  check(!m.over && tm.count[3] === 1 && tm.treasures[2].holder === 3, "a real box: P3 carries the treasure, the hunt goes on");
  check(ev.some((e) => e.type === "tbox" && e.found === 2) && ev.some((e) => e.type === "tre" && e.how === "find" && e.t === 2), "the find told (the box, then the treasure taken)");
  // Ranked: no respawn, the longer upload.
  const r = settingsOf(live, true);
  check(r.respawn.on === false && r.modules.treasure?.upload === 18 && r.modules.treasure?.need === 5, "Ranked: no respawn, 18 s to upload, still all 5");
}

console.log("v7 (H4), heavy loot:");
{
  const m = fresh(12, 6, undefined, 99, false, live);
  const tm = tmOf(m);
  check(tm.heavy === 0.03 && tm.heavyAt === 4, "3% a treasure, no sprint from 4");
  const c = tm.machine!;
  // Carry n of the five (the module's own books: who holds which).
  const carry = (i: number, n: number) => {
    tm.count[i] = n;
    tm.treasures.forEach((t, j) => j < n && (t.holder = i));
  };
  const runOff = (n: number, crouch = false) => {
    for (const t of tm.treasures) t.holder = -1;
    tm.count.fill(0);
    carry(3, n);
    put(m, "p3", c.x, c.z + 1.5, c.h);
    m.setInput("p3", 0, -1);
    m.setButtons("p3", true, 0, 0);
    run(m, 0.6);
    if (crouch) {
      m.setButtons("p3", true, 1, 0);
      run(m, 0.1);
    }
    const p = m.get("p3")!;
    const out = { speed: Math.hypot(p.vx, p.vz), sprinting: p.sprinting, slide: p.slide };
    m.setButtons("p3", false, 0, 0);
    m.setInput("p3", 0, 0);
    run(m, 0.5);
    return out;
  };
  const free = runOff(0);
  const two = runOff(2);
  const four = runOff(4);
  const five = runOff(5);
  check(free.sprinting && two.sprinting, "with 0 or 2 carried you can sprint");
  check(Math.abs(two.speed / free.speed - 0.94) < 0.02, `2 carried: 94% of the sprint (${(two.speed / free.speed).toFixed(3)})`);
  check(!four.sprinting && !five.sprinting, "4 or 5 carried: no sprint");
  check(five.speed < four.speed && five.speed < free.speed * 0.7, `5 carried: a run at 85% (${five.speed.toFixed(2)} m/s, free sprint ${free.speed.toFixed(2)})`);
  const slid = runOff(1, true);
  const stuck = runOff(4, true);
  check(slid.slide > 0, "1 carried: sprint then crouch slides");
  check(stuck.slide === 0, "4 carried: no slide");
}

console.log("v7 (H5), trapped chests:");
{
  const m = fresh(13, 6, undefined, 99, false, live);
  const tm = tmOf(m);
  const real = new Set(tm.treasures.map((t) => t.box));
  const empty = tm.boxes.filter((b) => !real.has(b.index));
  const trapped = empty.filter((b) => tm.isTrapped(b.index));
  check(tm.traps === 0.25 && trapped.length === Math.round(empty.length * 0.25), `one empty chest in four is trapped (${trapped.length} of ${empty.length})`);
  check(tm.boxes.every((b) => !real.has(b.index) || !tm.isTrapped(b.index)), "a chest with a treasure is never trapped");
  // Another secret: other traps; the same secret: the same.
  const again = tmOf(fresh(13, 6, undefined, 99, false, live));
  const other = tmOf(fresh(13, 6, undefined, 7, false, live));
  const key = (t: TreasureModule) => t.boxes.filter((b) => t.isTrapped(b.index)).map((b) => b.index).join(",");
  check(key(again) === key(tm) && key(other) !== key(tm), "the traps come from the server's secret, the same each time for it");
  // The phone's copy knows none until one goes off.
  const copy = fresh(13, 6, undefined, 99, true, live);
  check(tmOf(copy).boxes.every((b) => !tmOf(copy).isTrapped(b.index)), "the phone's copy doesn't know which are trapped");
  // Opening one: the event says so.
  const b = trapped[0];
  put(m, "p2", b.x + 0.6, b.z, b.h);
  hold(m, "p2", true);
  const ev: MatchEvent[] = [];
  run(m, TREASURE.open + 0.1, ev);
  hold(m, "p2", false);
  const box = ev.find((e) => e.type === "tbox" && e.box === b.index);
  check(!!box && box.type === "tbox" && box.trap === true && box.found === -1, "opened, the trapped chest goes off (the event says so)");
  const plain = empty.find((x) => !tm.isTrapped(x.index))!;
  put(m, "p2", plain.x + 0.6, plain.z, plain.h);
  hold(m, "p2", true);
  const ev2: MatchEvent[] = [];
  run(m, TREASURE.open + 0.1, ev2);
  hold(m, "p2", false);
  const box2 = ev2.find((e) => e.type === "tbox" && e.box === plain.index);
  check(!!box2 && box2.type === "tbox" && !box2.trap, "an empty, untrapped chest is just empty");
  if (box) tmOf(copy).apply(copy, box);
  check(tmOf(copy).isTrapped(b.index), "the copy learns the trap as it goes off");
}

console.log("v7 (H6), the upload alarm and the narrowing ring:");
{
  const m = fresh(14, 6, undefined, 99, false, live);
  const tm = tmOf(m);
  const zone = m.module<ZoneModule>("zone")!;
  check(tm.ringShrink, "the live mode's ring narrows with the zone");
  check(tm.ringAt(m) === TREASURE.ring, "early on: the full ring");
  const c = tm.machine!;
  const at = (t: number) => {
    m.elapsed = t;
    return tm.ringAt(m);
  };
  const late = at(2000);
  check(zone.at(2000, { x: 0, z: 0, r: 0 }).r <= 60 && Math.abs(late - RING_MIN) < 1e-6, `the last circle: the ring down to ${late.toFixed(1)} m (never under ${RING_MIN})`);
  check(late >= RING_MIN && late < TREASURE.ring, "narrower, but room to stand and fight");
  let prev = Infinity;
  let mono = true;
  for (let t = 0; t <= 2000; t += 10) {
    const r = at(t);
    if (r > prev + 1e-9) mono = false;
    prev = r;
  }
  check(mono, "it only ever narrows");
  m.elapsed = 2000;
  put(m, "p2", c.x + late + 1, c.z, c.h);
  check(!tm.inRing(m, m.get("p2")!), "a step outside the narrowed ring: out");
  put(m, "p2", c.x + late - 0.5, c.z, c.h);
  check(tm.inRing(m, m.get("p2")!), "inside it: in");
  const off = fresh(14, 6);
  off.elapsed = 2000;
  check(tmOf(off).ringAt(off) === TREASURE.ring, "without ringShrink the ring stays");
}

console.log("v7 (H7), pickpocket:");
{
  const m = fresh(15, 6, undefined, 99, false, live);
  const tm = tmOf(m);
  check(tm.pickpocket, "the live mode: a hit from behind knocks one loose");
  const c = tm.machine!;
  let n = 0;
  const give = (i: number, k: number) => {
    for (const t of tm.treasures) if (t.holder === i) t.holder = -1;
    tm.count[i] = 0;
    for (const t of tm.treasures) {
      if (tm.count[i] >= k) break;
      if (t.holder >= 0) continue;
      t.holder = i;
      t.box = -1;
      tm.count[i]++;
    }
  };
  // P2 faces +z; the thief stands `behind` (true: at its back; false: in front of it, face to face).
  const stage = (behind: boolean) => {
    put(m, "p2", c.x + 4, c.z, c.h);
    m.get("p2")!.heading = 0;
    put(m, "p1", c.x + 4, c.z + (behind ? -1 : 1), c.h);
    m.get("p1")!.heading = behind ? 0 : Math.PI;
  };
  const swing = (ev: MatchEvent[]) => {
    m.setActions("p1", (++n << 2) | 2, 0);
    run(m, 0.7, ev);
  };
  const loose = (ev: MatchEvent[]) => ev.filter((e) => e.type === "tre" && e.how === "loose");
  give(2, 2);
  stage(true);
  const ev: MatchEvent[] = [];
  swing(ev);
  const hit = ev.some((e) => e.type === "hit" && e.id === "p1" && e.tg === "p2");
  const l = loose(ev);
  check(hit && l.length === 1 && tm.count[2] === 1, "hit from behind: one of P2's two knocked loose, no kill");
  check(l[0]?.type === "tre" && l[0].by === "p1" && l[0].id === "p2", "the event names the thief and the carrier");
  check(tm.count[1] === 1 && m.get("p2")!.status === "alive", "it lands at the thief's feet: P1 has it on the run");
  // Again at once: one a body every 2 s.
  stage(true);
  const ev2: MatchEvent[] = [];
  swing(ev2);
  check(ev2.some((e) => e.type === "hit") && !loose(ev2).length && tm.count[2] === 1, "a second hit within 2 s: nothing more comes loose");
  // Face to face: a hit, nothing loose.
  run(m, 2);
  stage(false);
  const ev3: MatchEvent[] = [];
  swing(ev3);
  check(ev3.some((e) => e.type === "hit" && e.tg === "p2") && !loose(ev3).length && tm.count[2] === 1, "from the front: a hit, but nothing loose");
  // The phone's copy follows the event.
  const copy = fresh(15, 6, undefined, 99, true, live);
  const ct = tmOf(copy);
  if (l[0]?.type === "tre") {
    ct.treasures[l[0].t].holder = 2;
    ct.count[2] = 1;
    ct.apply(copy, l[0]);
  }
  check(!!l[0] && ct.treasures[(l[0] as { t: number }).t].holder === -1 && ct.count[2] === 0, "the copy drops it too");
  // Off in a mode without it.
  const off = fresh(15, 6);
  check(!tmOf(off).pickpocket, "without pickpocket, a hit is just a hit");
}

console.log("v7 (H8), Fool's Gold:");
{
  const m = fresh(16, 6, [0, 0, 1, 1, 2, 2], 99, false, live);
  const tm = tmOf(m);
  const items = m.module<ItemsModule>("items")!;
  const gad = m.module<GadgetsModule>("gadgets")!;
  const c = tm.machine!;
  check(LOOT_TABLES["ffa-core"].some(([k]) => k === "fools-gold") && ITEM_DEFS["fools-gold"].rare === true, "a rare item in the loot");
  check(builtLoot("ffa-core", (id) => id !== "treasure").every(([k]) => k !== "fools-gold"), "only where there are treasures");
  put(m, "p0", c.x + 5, c.z, c.h);
  put(m, "p2", c.x - 6, c.z, c.h);
  put(m, "p1", c.x, c.z + 6, c.h);
  items.packs[0][0] = "fools-gold";
  const ev: MatchEvent[] = [];
  m.setPack("p0", (1 << 5) | 0);
  run(m, DT * 2, ev);
  const fool = gad.placed.find((p) => p.kind === "fool");
  const drop = ev.find((e) => e.type === "gadget" && e.kind === "fool");
  check(!!fool && items.packs[0][0] === null && Math.hypot(fool.x - (c.x + 5), fool.z - c.z) < 0.5, "used: a fake treasure lies at P0's feet");
  check(!!fool && fool.look !== undefined && tm.treasures[fool.look].box >= 0 && drop?.type === "gadget" && drop.k === fool.look, "it copies a treasure still hidden (the event says which)");
  run(m, 2);
  check(!!fool && fool.until > m.elapsed, "its owner walks on it: nothing");
  put(m, "p1", fool!.x, fool!.z, fool!.h);
  run(m, 0.2);
  check(fool!.until > m.elapsed && m.get("p1")!.stun <= 0, "a squad mate knows it: nothing");
  const ev2: MatchEvent[] = [];
  put(m, "p2", fool!.x + 0.5, fool!.z, fool!.h);
  run(m, DT * 2, ev2);
  const p2 = m.get("p2")!;
  check(ev2.some((e) => e.type === "gadget" && e.kind === "fooled" && e.id === "p2") && p2.stun > 1.3, "a rival grabs it: stunned 1.5 s");
  check(ev2.some((e) => e.type === "reveal" && e.all === true && e.tg === "p2") && gad.reveals.some((r) => r.by === -1 && r.tg === p2.index && Math.abs(r.until - m.elapsed - 3) < 0.1), "and on every map for 3 s");
  check(tm.count[p2.index] === 0 && fool!.until <= m.elapsed, "no treasure: the fake is gone");
  // The phone's copy.
  const copy = fresh(16, 6, [0, 0, 1, 1, 2, 2], 99, true, live);
  const cg = copy.module<GadgetsModule>("gadgets")!;
  for (const e of [...ev, ...ev2]) for (const md of copy.modules) md.apply?.(copy, e);
  check(cg.placed.some((p) => p.kind === "fool" && p.look === fool!.look) && cg.reveals.some((r) => r.by === -1 && r.tg === p2.index), "the copy draws it and sees the ping");
}

console.log("v7 (H9), the carriers' pulse:");
{
  const m = fresh(17, 6, undefined, 99, false, live);
  const tm = tmOf(m);
  check(tm.pulse === 90 && tm.pulseAt === 3, "every 90 s, carriers of 3 or more");
  const give = (i: number, k: number) => {
    for (const t of tm.treasures) if (t.holder === i) t.holder = -1;
    tm.count[i] = 0;
    for (const t of tm.treasures) {
      if (tm.count[i] >= k) break;
      if (t.holder >= 0) continue;
      t.holder = i;
      t.box = -1;
      tm.count[i]++;
    }
  };
  give(1, 3);
  give(2, 2);
  const c = tm.machine!;
  put(m, "p1", c.x + 5, c.z, c.h);
  put(m, "p2", c.x - 5, c.z, c.h);
  const ev: MatchEvent[] = [];
  m.elapsed = 89.9;
  run(m, 0.2, ev);
  const p = ev.filter((e) => e.type === "tpulse");
  check(p.length === 1, "at 90 s: one pulse");
  const e = p[0];
  check(e?.type === "tpulse" && e.ids.length === 1 && e.ids[0] === "p1" && Math.abs(e.x[0] - m.get("p1")!.x) < 0.5, "it shows P1 (3 carried) where P1 is, not P2 (2)");
  check(e?.type === "tpulse" && !("box" in e) && tm.pulsed.until > m.elapsed && tm.pulsed.until - m.elapsed <= 2, "players only, never chests; on the map 2 s");
  const ev2: MatchEvent[] = [];
  run(m, 5, ev2);
  check(!ev2.some((x) => x.type === "tpulse"), "nothing more until the next 90 s");
  const copy = fresh(17, 6, undefined, 99, true, live);
  if (e) tmOf(copy).apply(copy, e);
  check(tmOf(copy).pulsed.who[0] === 1 && tmOf(copy).pulsed.until > copy.elapsed, "the copy shows it");
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
