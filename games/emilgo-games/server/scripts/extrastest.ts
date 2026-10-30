// Free For All's extras (SPEC-V3 Phase 6): the §10 items in the world, and
// (as they're built) modes 6–10, Ranked, the Harmattan, the other extras.
// Headless, on Naija World, as the server runs it.
//
//   node server/build-tools.mjs && node server/dist/extrastest.mjs

import { BLACKOUT, ECONOMY, GADGETS, MELEE, MOVE } from "../../src/config";
import type { ItemId } from "../../src/content/items";
import { BUILTIN_MANIFEST } from "../../src/content/modes";
import type { Contestant } from "../../src/game/core/body";
import { Match, settingsOf, type MatchSettings } from "../../src/game/core/match";
import type { MatchEvent } from "../../src/game/core/module";
import { Space } from "../../src/game/core/space";
import type { GadgetsModule } from "../../src/game/modules/gadgets";
import type { ItemsModule } from "../../src/game/modules/items";
import type { MeleeModule } from "../../src/game/modules/melee";
import type { BlackoutModule } from "../../src/game/modules/blackout";
import type { EconomyModule } from "../../src/game/modules/economy";
import type { TagModule } from "../../src/game/modules/tag";
import { matchWorldOf } from "../../src/maps/open/matchWorld";
import { matchXp } from "../../src/rank/xp";
import { FfaGame } from "../src/ffa";
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

/** No zone, no Airfall, no cars, a long clock: the bodies and the modules under test. */
function bare(id = "find-the-flag", extra: (s: MatchSettings) => void = () => {}): MatchSettings {
  const s = settingsOf(def(id));
  delete s.modules.zone;
  delete s.modules.airfall;
  delete s.modules.vehicles;
  s.time = 900;
  extra(s);
  return s;
}
function newMatch(seed: number, settings: MatchSettings, n = 6, squads?: number[]): Match {
  return new Match({ seed, world, settings, contestants: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, bot: false, ...(squads ? { squad: squads[i] } : {}) })) });
}
function runFor(m: Match, s: number, out: MatchEvent[] = [], each?: () => void): MatchEvent[] {
  let g = 0;
  while (m.phase !== "play" && g++ < 1e5) {
    m.step(DT);
    out.push(...m.drain());
  }
  const end = m.elapsed + s;
  while (m.elapsed < end - 1e-9 && !m.over && g++ < 2e6) {
    each?.();
    m.step(DT);
    out.push(...m.drain());
  }
  return out;
}
/** The quiet bush by the cassava farm: open, flat, clear for 10 m round. */
const [YX, YZ] = [-168, -176];
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
let packN = 0;
/** Put `kind` in c's first slot and use it. */
function use(m: Match, id: string, kind: ItemId): MatchEvent[] {
  const items = m.module<ItemsModule>("items")!;
  const c = m.get(id)!;
  items.packs[c.index][0] = kind;
  m.setPack(id, ((++packN & 511) << 5) | 0);
  return runFor(m, DT * 2);
}
let atk = 0;
const swing = (m: Match, id: string, kind: 1 | 2 | 3) => m.setActions(id, ((++atk & 63) << 2) | kind, m.get(id)!.inGrab);
const gad = (m: Match) => m.module<GadgetsModule>("gadgets")!;
const mel = (m: Match) => m.module<MeleeModule>("melee")!;
const fresh = (seed: number, n = 6, squads?: number[], id = "find-the-flag") => {
  const m = newMatch(seed, bare(id), n, squads);
  runFor(m, 0.1);
  return m;
};

console.log("the §10 items:");
{
  // Every one of them can be found now.
  const m = newMatch(1, settingsOf(def("find-the-flag")), 12);
  const kinds = new Set(m.module<ItemsModule>("items")!.items.map((it) => it.kind));
  const extras: ItemId[] = ["smoke-pot", "banana-peel", "pepper-powder", "megaphone", "decoy-flag", "talking-drum", "aso-ebi"];
  check(extras.every((k) => kinds.has(k)), `all seven are scattered (${extras.filter((k) => kinds.has(k)).length}/7 in one match)`);
}
{
  // The Smoke Pot: a cloud; the Talking Drum can't find you in it.
  const m = fresh(2);
  clear(m, ["p0", "p1", "p2"]);
  put(m, "p0", YX, YZ);
  put(m, "p1", YX + 30, YZ);
  put(m, "p2", YX - 20, YZ);
  const ev = use(m, "p1", "smoke-pot");
  const g = gad(m);
  check(ev.some((e) => e.type === "gadget" && e.kind === "smoke") && g.inSmoke(m, YX + 30, YZ) && !g.inSmoke(m, YX, YZ), `a Smoke Pot: a cloud ${GADGETS.smoke.r * 2} m across where you stand`);
  const ev2 = use(m, "p0", "talking-drum");
  const r = ev2.find((e) => e.type === "reveal") as Extract<MatchEvent, { type: "reveal" }> | undefined;
  check(r?.tg === "p2", `a Talking Drum finds the nearest rival not in smoke (p2 at 20 m, not p1 hiding at 30 m: ${r?.tg})`);
  runFor(m, GADGETS.smoke.s);
  check(!g.inSmoke(m, YX + 30, YZ) && g.reveals.length === 0, `the cloud clears after ${GADGETS.smoke.s} s; the drum's find after ${GADGETS.drum.s}`);
}
{
  // The Banana Peel: dropped behind; running over it trips you, walking doesn't.
  const m = fresh(3);
  clear(m, ["p0", "p1", "p2"]);
  const a = put(m, "p0", YX, YZ, EAST);
  const ev = use(m, "p0", "banana-peel");
  const peel = gad(m).placed.find((p) => p.kind === "peel")!;
  check(!!peel && peel.x < a.x - 0.5, "a Banana Peel: dropped behind you");
  // A walker over it: nothing.
  put(m, "p2", peel.x - 3, peel.z, EAST);
  m.setInput("p2", 0.4, 0);
  runFor(m, 2.5);
  m.setInput("p2", 0, 0);
  check(!mel(m).isDown(m.get("p2")!.index), "walked over: nothing");
  // A runner: down.
  put(m, "p1", peel.x - 4, peel.z, EAST);
  m.setInput("p1", 1, 0);
  const ev2 = runFor(m, 1.5);
  check(ev2.some((e) => e.type === "gadget" && e.kind === "slip" && e.id === "p1") && ev2.some((e) => e.type === "down" && e.id === "p1"), "run over: tripped");
  check(ev.length > 0 && peel.until <= m.elapsed, "and it's gone");
}
{
  // Pepper Powder: a cone in front.
  const m = fresh(4);
  clear(m, ["p0", "p1", "p2", "p3"]);
  put(m, "p0", YX, YZ, EAST);
  const front = put(m, "p1", YX + 2.5, YZ);
  const behind = put(m, "p2", YX - 2.5, YZ);
  const braced = put(m, "p3", YX + 2.5, YZ + 1);
  m.setBrace("p3", true);
  runFor(m, 0.1);
  const ev = use(m, "p0", "pepper-powder");
  const sneezed = ev.filter((e) => e.type === "gadget" && e.kind === "sneeze").map((e) => (e as { id: string }).id);
  check(sneezed.includes("p1") && !sneezed.includes("p2"), "Pepper Powder: the one in front sneezes, the one behind doesn't");
  check(mel(m).wobble[front.index] > mel(m).wobble[braced.index] && mel(m).wobble[braced.index] > 0 && mel(m).wobble[behind.index] === 0, `bracing halves it (${mel(m).wobble[front.index].toFixed(2)} vs ${mel(m).wobble[braced.index].toFixed(2)})`);
}
{
  // The Megaphone: a wind-up, then everyone near pushed away.
  const m = fresh(5);
  clear(m, ["p0", "p1", "p2"]);
  put(m, "p0", YX, YZ);
  const a = put(m, "p1", YX + 3, YZ);
  const b = put(m, "p2", YX - 4, YZ + 1);
  const ev = use(m, "p0", "megaphone");
  check(ev.some((e) => e.type === "gadget" && e.kind === "wave-up") && Math.hypot(a.x - (YX + 3), a.z - YZ) < 0.01, "the Megaphone: a wind-up first");
  const ev2 = runFor(m, GADGETS.wave.windup + 0.6);
  check(ev2.some((e) => e.type === "gadget" && e.kind === "wave") && a.x > YX + 4 && b.x < YX - 5, `then the wave: both pushed away (${(a.x - YX).toFixed(1)} m, ${(YX - b.x).toFixed(1)} m)`);
  // Hit during the wind-up: lost.
  const m2 = fresh(6);
  clear(m2, ["p0", "p1"]);
  put(m2, "p0", YX, YZ, EAST);
  const c = put(m2, "p1", YX + 1.2, YZ, -EAST);
  use(m2, "p1", "megaphone");
  swing(m2, "p0", 2);
  const ev3 = runFor(m2, GADGETS.wave.windup + 0.3);
  check(ev3.some((e) => e.type === "gadget" && e.kind === "lost") && !ev3.some((e) => e.type === "gadget" && e.kind === "wave") && c.status === "alive", "slapped while it winds up: the wave is lost");
}
{
  // The Decoy Flag: a rival who grabs it is stunned.
  const m = fresh(7);
  clear(m, ["p0", "p1"]);
  put(m, "p0", YX, YZ);
  const ev = use(m, "p0", "decoy-flag");
  check(ev.some((e) => e.type === "gadget" && e.kind === "decoy"), "a Decoy Flag at your feet");
  put(m, "p0", YX + 6, YZ);
  const r = put(m, "p1", YX - 2, YZ, EAST);
  m.setInput("p1", 1, 0);
  const ev2 = runFor(m, 0.8);
  check(ev2.some((e) => e.type === "gadget" && e.kind === "pop" && e.id === "p1") && r.stun > 0, "a rival runs onto it: it pops, they're stunned");
  const noFlags = newMatch(8, bare("squad-rally"), 8, [0, 0, 0, 0, 1, 1, 1, 1]);
  runFor(noFlags, 0.1);
  const items = noFlags.module<ItemsModule>("items")!;
  items.packs[0][0] = "decoy-flag";
  noFlags.setPack("p0", ((++packN & 511) << 5) | 0);
  runFor(noFlags, DT * 2);
  check(items.packs[0][0] === "decoy-flag", "in a mode without flags it stays in the pack");
}
{
  // Aso-ebi: wear a rival squad's colour; it ends when you swing.
  const m = fresh(9, 8, [0, 0, 0, 0, 1, 1, 1, 1], "squad-rally");
  clear(m, ["p0", "p4"]);
  put(m, "p0", YX, YZ, EAST);
  put(m, "p4", YX + 8, YZ);
  const g = gad(m);
  const ev = use(m, "p0", "aso-ebi");
  check(ev.some((e) => e.type === "disguise" && e.id === "p0" && e.squad === 1) && g.shownSquad(m, 0) === 1, "Aso-ebi: you show as the rival squad");
  swing(m, "p0", 2);
  const ev2 = runFor(m, 0.2);
  check(ev2.some((e) => e.type === "disguise" && e.id === "p0" && e.squad === -1) && g.shownSquad(m, 0) === 0, "a swing ends it");
  use(m, "p0", "aso-ebi");
  runFor(m, GADGETS.disguise.s + 0.2);
  check(g.shownSquad(m, 0) === 0, `it wears off after ${GADGETS.disguise.s} s`);
  const solo = fresh(10);
  const it = solo.module<ItemsModule>("items")!;
  it.packs[0][0] = "aso-ebi";
  solo.setPack("p0", ((++packN & 511) << 5) | 0);
  runFor(solo, DT * 2);
  check(it.packs[0][0] === "aso-ebi", "with nobody in squads it stays in the pack");
}
{
  // The phone's copy agrees.
  const s = bare("hold-the-flag");
  const srv = newMatch(11, s, 8);
  const ph = new Match({ seed: 11, world, settings: s, contestants: srv.contestants.map((c) => ({ id: c.id, name: c.name, bot: false })), mirror: true });
  for (const e of srv.drain()) ph.applyRemote(e);
  ph.drain();
  runFor(srv, 0.1);
  const items = srv.module<ItemsModule>("items")!;
  const kinds: ItemId[] = ["smoke-pot", "banana-peel", "decoy-flag", "talking-drum", "pepper-powder", "megaphone"];
  let n = 0;
  for (let f = 0; f < 60 * 30; f++) {
    for (const c of srv.contestants) {
      if (f % 50 === c.index) srv.setInput(c.id, Math.sin(f * 0.01 + c.index), Math.cos(f * 0.02 + c.index));
      if (f % 240 === c.index * 9) {
        items.packs[c.index][0] = kinds[(f + c.index) % kinds.length];
        srv.setPack(c.id, ((++packN & 511) << 5) | 0);
      }
    }
    srv.step(DT);
    ph.phase = srv.phase;
    ph.elapsed = srv.elapsed;
    for (const c of srv.contestants) Object.assign(ph.contestants[c.index], { x: c.x, z: c.z, h: c.h, heading: c.heading });
    for (const e of srv.drain()) {
      ph.applyRemote(e);
      n++;
    }
    ph.step(DT);
    ph.drain();
  }
  const a = gad(srv);
  const b = gad(ph);
  const same = a.placed.length === b.placed.length && a.placed.every((p, i) => b.placed[i] && p.kind === b.placed[i].kind && Math.abs(p.x - b.placed[i].x) < 1e-3 && (p.until <= srv.elapsed) === (b.placed[i].until <= srv.elapsed + 0.05));
  check(same && a.placed.length > 4, `30 s of 8 people using them: the copy agrees on every cloud, peel and decoy (${a.placed.length}, ${n} events)`);
}

console.log("Ranked:");
{
  const d = def("find-the-flag");
  const roster = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const casual = new FfaGame(d, 5, roster, roster.map((_, i) => i));
  const ranked = new FfaGame(d, 5, roster, roster.map((_, i) => i), true);
  const z = (g: FfaGame) => (g.match.settings.modules.zone as { scale?: number }).scale ?? 1;
  check(ranked.start.rk === 1 && !casual.start.rk, "a ranked match says so in its start (the phones apply the same rules)");
  check(!ranked.match.settings.respawn.on && casual.match.settings.respawn.on && z(ranked) < z(casual), `harder: no respawns, the zone ${Math.round((1 - z(ranked)) * 100)}% smaller`);
  const fc = casual.facts("p0")!;
  const fr = ranked.facts("p0")!;
  check(fr.ranked === true && matchXp({ ...fr, seconds: 480 }) === 2 * matchXp({ ...fc, seconds: 480 }), `double XP (${matchXp({ ...fc, seconds: 480 })} → ${matchXp({ ...fr, seconds: 480 })})`);
}

console.log("Chase & Reverse:");
{
  const s = bare("chase-reverse", (x) => {
    (x.modules.tag as Record<string, unknown>).curesAt = 4;
  });
  const m = newMatch(21, s, 6);
  const ev0 = m.drain();
  const tag = m.module<TagModule>("tag")!;
  const first = ev0.filter((e) => e.type === "turn" && e.ojuju);
  check(first.length === 1 && m.contestants.filter((c) => tag.isOjuju(c.index)).length === 1, "one Ojuju to start, announced");
  runFor(m, 0.1);
  const oj = m.contestants.find((c) => tag.isOjuju(c.index))!;
  const hu = m.contestants.find((c) => !tag.isOjuju(c.index))!;
  clear(m, [oj.id, hu.id]);
  // Faster: both run east for 3 s side by side.
  put(m, oj.id, YX, YZ, EAST);
  put(m, hu.id, YX, YZ + 6, EAST);
  m.setInput(oj.id, 1, 0);
  m.setInput(hu.id, 1, 0);
  runFor(m, 3);
  m.setInput(oj.id, 0, 0);
  m.setInput(hu.id, 0, 0);
  check(oj.x - YX > (hu.x - YX) * 1.05, `the Ojuju are faster (${(oj.x - YX).toFixed(1)} m vs ${(hu.x - YX).toFixed(1)} m in 3 s)`);
  // Can't use items.
  const items = m.module<ItemsModule>("items")!;
  items.packs[oj.index][0] = "kola";
  m.setPack(oj.id, ((++packN & 511) << 5) | 0);
  runFor(m, DT * 2);
  check(items.packs[oj.index][0] === "kola", "the Ojuju can't use items");
  // A touch turns a human.
  runFor(m, 1.5);
  put(m, oj.id, YX, YZ);
  put(m, hu.id, YX + 0.7, YZ);
  const ev = runFor(m, 0.1);
  check(ev.some((e) => e.type === "turn" && e.id === hu.id && e.ojuju) && tag.isOjuju(hu.index) && tag.turned[oj.index] === 1, "an Ojuju touches a human: they turn");
  // The charms come; a human carrying one cures an Ojuju.
  runFor(m, Math.max(0, 4.2 - m.elapsed));
  check(tag.charms.length === 2, `at ${4} s (3:00 in the mode) two Reverse charms appear`);
  const h2 = m.contestants.find((c) => !tag.isOjuju(c.index))!;
  const ch = tag.charms[0];
  clear(m, [h2.id, hu.id]);
  put(m, h2.id, ch.x, ch.z);
  runFor(m, 0.1);
  check(ch.holder === h2.index, "a human walks onto one: they carry it");
  put(m, hu.id, h2.x + 0.6, h2.z);
  const ev2 = runFor(m, 0.1);
  check(ev2.some((e) => e.type === "charm" && e.how === "use") && !tag.isOjuju(hu.index) && ch.spent, "and touching an Ojuju cures them");
  // Last human standing wins.
  const m2 = newMatch(22, bare("chase-reverse"), 3);
  runFor(m2, 0.1);
  const t2 = m2.module<TagModule>("tag")!;
  const [o2] = m2.contestants.filter((c) => t2.isOjuju(c.index));
  const humans = m2.contestants.filter((c) => !t2.isOjuju(c.index));
  clear(m2, m2.contestants.map((c) => c.id));
  put(m2, o2.id, YX, YZ);
  put(m2, humans[0].id, YX + 0.6, YZ);
  put(m2, humans[1].id, YX + 30, YZ);
  const ev3 = runFor(m2, 0.2);
  check(ev3.some((e) => e.type === "won" && e.id === humans[1].id) && m2.over, "one human left: they win");
}

console.log("Lights Out:");
{
  const m = newMatch(31, bare("lights-out"), 4);
  runFor(m, 0.1);
  const bo = m.module<BlackoutModule>("blackout")!;
  const gaps = bo.cuts.map((c, i) => c[0] - (i ? bo.cuts[i - 1][1] : 0));
  check(bo.cuts.length >= 3 && gaps.every((g) => g >= 60 - 1e-6 && g <= 90 + 1e-6) && bo.cuts.every(([a, b]) => b - a === BLACKOUT.cut), `power cuts every 60–90 s, ${BLACKOUT.cut} s each (${bo.cuts.length} in the match)`);
  clear(m, ["p0", "p1", "p2"]);
  // In front, in reach, in sight: found after findHold.
  put(m, "p0", YX, YZ, EAST);
  const b = put(m, "p1", YX + 6, YZ);
  const behind = put(m, "p2", YX - 6, YZ + 1);
  const ev = runFor(m, bo.findHold * 0.5);
  check(b.status === "alive" && !ev.some((e) => e.type === "found"), "a rival in your light: not yet …");
  const ev2 = runFor(m, bo.findHold);
  check(ev2.some((e) => e.type === "found" && e.id === "p0" && e.tg === "p1") && b.status === "eliminated" && b.cause === "found", `… ${bo.findHold} s in your light: found, out`);
  check(behind.status === "alive", "the one behind you: never");
  // A wall between: no.
  // A building narrow enough that both sides are within a lamp's reach.
  const wall = layout.solids.find((so) => so.kind === "box" && so.y0 <= 0 && so.y1 > 2.5 && so.hx > 1.5 && so.hx < 4 && so.hz > 1.5 && Math.abs(so.x) < 150 && Math.abs(so.z) < 150)!;
  const m2 = newMatch(32, bare("lights-out"), 3);
  runFor(m2, 0.1);
  clear(m2, ["p0", "p1"]);
  const ux = Math.cos(wall.rot);
  const uz = -Math.sin(wall.rot);
  const ax = wall.x - ux * (wall.hx + 1.2);
  const az = wall.z - uz * (wall.hx + 1.2);
  const bx = wall.x + ux * (wall.hx + 1.2);
  const bz = wall.z + uz * (wall.hx + 1.2);
  const near = Math.hypot(bx - ax, bz - az) <= BLACKOUT.reach;
  put(m2, "p0", ax, az, Math.atan2(bx - ax, bz - az));
  const hid = put(m2, "p1", bx, bz);
  runFor(m2, bo.findHold * 2);
  check(near && hid.status === "alive", `a building between you: not found (${Math.hypot(bx - ax, bz - az).toFixed(1)} m apart, within reach)`);
  // Smoke between: no.
  const m3 = newMatch(33, bare("lights-out"), 3);
  runFor(m3, 0.1);
  clear(m3, ["p0", "p1"]);
  put(m3, "p0", YX, YZ, EAST);
  const sm = put(m3, "p1", YX + 6, YZ);
  use(m3, "p1", "smoke-pot");
  runFor(m3, bo.findHold * 2);
  check(sm.status === "alive", "in a smoke cloud: not found");
  // In a power cut, crouching halves the reach that finds you.
  const m4 = newMatch(34, bare("lights-out"), 3);
  runFor(m4, 0.1);
  const b4 = m4.module<BlackoutModule>("blackout")!;
  runFor(m4, b4.cuts[0][0] - m4.elapsed + 0.5);
  check(b4.cut(m4), "the power goes");
  clear(m4, ["p0", "p1"]);
  const gens = world.generators ?? [];
  const lone = (x: number, z: number) => gens.every((g) => Math.hypot(g.x - x, g.z - z) > BLACKOUT.genLight + 2);
  check(lone(YX, YZ) && lone(YX + 6, YZ), "(no generator by the test spot)");
  put(m4, "p0", YX, YZ, EAST);
  const cr = put(m4, "p1", YX + BLACKOUT.cutReach * 0.7, YZ);
  m4.setButtons("p1", false, 1, cr.inJump);
  runFor(m4, 0.6);
  check(cr.stance === 1 && !b4.sees(m4, m4.get("p0")!, cr), `crouched in the dark at ${(BLACKOUT.cutReach * 0.7).toFixed(1)} m: your glow is hidden`);
  m4.setButtons("p1", false, 0, cr.inJump);
  runFor(m4, 0.6);
  check(b4.sees(m4, m4.get("p0")!, cr), "standing up, it shows");
  // A running generator shocks whoever touches it.
  if (gens.length) {
    const g = gens[0];
    const sh = put(m4, "p1", g.x + 0.8, g.z);
    const ev5 = runFor(m4, 0.1);
    check(ev5.some((e) => e.type === "shock" && e.id === "p1") && sh.stun > 0, "in a cut, touching a running generator: a shock");
  }
  // The last one not found wins.
  const m5 = newMatch(35, bare("lights-out"), 2);
  runFor(m5, 0.1);
  clear(m5, ["p0", "p1"]);
  put(m5, "p0", YX, YZ, EAST);
  put(m5, "p1", YX + 5, YZ);
  const ev6 = runFor(m5, 2);
  check(ev6.some((e) => e.type === "won" && e.id === "p0") && m5.over, "the last one not found wins");
}

console.log("Hustle:");
{
  const m = newMatch(41, bare("hustle"), 6);
  runFor(m, 0.1);
  const eco = m.module<EconomyModule>("economy")!;
  const kinds = new Set(eco.stations.map((x) => x.kind));
  const drops = eco.stations.filter((x) => x.to).map((x) => Math.hypot(x.to!.x - x.x, x.to!.z - x.z));
  check(eco.stations.length >= 10 && kinds.size === 5 && eco.banks.length === ECONOMY.banks, `${eco.stations.length} stations of all 5 jobs, ${eco.banks.length} Esusu boxes`);
  check(drops.length > 0 && drops.every((d) => d >= ECONOMY.dropFrom[0] - 6 && d <= ECONOMY.dropFrom[1] + 6), `deliveries go ${Math.round(Math.min(...drops))}–${Math.round(Math.max(...drops))} m`);
  clear(m, ["p0", "p1"]);
  // A hold-job: let go early, nothing; hold it out, paid.
  const water = eco.stations.find((x) => x.kind === "water")!;
  put(m, "p0", water.x + 0.8, water.z);
  m.setInteract("p0", 1, true);
  runFor(m, ECONOMY.jobs.water.hold * 0.5);
  m.setInteract("p0", 1, false);
  runFor(m, 0.2);
  check(eco.carried[0] === 0 && eco.work[0] === 0, "let go early: no pay");
  m.setInteract("p0", 2, true);
  const ev = runFor(m, ECONOMY.jobs.water.hold + 0.2);
  m.setInteract("p0", 2, false);
  check(ev.some((e) => e.type === "job" && e.how === "done") && eco.carried[0] === ECONOMY.jobs.water.pay, `held ${ECONOMY.jobs.water.hold} s at the water stall: +${ECONOMY.jobs.water.pay} Owo`);
  check(m.elapsed < water.until, "then the station rests");
  // Sabotage: p1 taps while p0 works the wash.
  const wash = eco.stations.find((x) => x.kind === "wash")!;
  put(m, "p0", wash.x + 0.8, wash.z);
  m.setInteract("p0", 3, true);
  runFor(m, 1);
  put(m, "p1", wash.x - 0.8, wash.z);
  m.setInteract("p1", 1, false);
  const ev2 = runFor(m, 0.2);
  check(ev2.some((e) => e.type === "job" && e.how === "sabotage" && e.id === "p1") && wash.broken && eco.work[0] === 0, "a rival taps the station you're working: your work is lost, it's broken");
  m.setInteract("p0", 3, false);
  // A carry-job: take it, deliver it.
  const load = eco.stations.find((x) => x.kind === "load")!;
  put(m, "p0", load.x + 0.8, load.z);
  m.setInteract("p0", 4, false);
  runFor(m, 0.1);
  check(eco.job[0] === load.index, "tap at the load: you carry it");
  // Slower with a load.
  put(m, "p0", -168, -176, EAST);
  m.setInput("p0", 1, 0);
  runFor(m, 2);
  m.setInput("p0", 0, 0);
  const went = m.get("p0")!.x + 168;
  check(went < MOVE.run * 2 * 0.9, `a load slows you (${went.toFixed(1)} m in 2 s)`);
  runFor(m, 0.5);
  put(m, "p0", load.to!.x, load.to!.z);
  const before = eco.carried[0];
  const ev3 = runFor(m, 0.1);
  check(ev3.some((e) => e.type === "job" && e.how === "deliver") && eco.carried[0] === before + ECONOMY.jobs.load.pay && eco.job[0] < 0, `at the drop: +${ECONOMY.jobs.load.pay} Owo`);
  // Bank it.
  const box = eco.banks[0];
  put(m, "p0", box.x + 0.8, box.z);
  m.setInteract("p0", 5, false);
  runFor(m, 0.1);
  check(eco.banked[0] === before + ECONOMY.jobs.load.pay && eco.carried[0] === 0, `at an Esusu box: banked (${eco.banked[0]})`);
  check(m.objective(0) === eco.banked[0], "the measure is what's banked");
  // Dazed with Owo: half spills, anyone scoops it.
  eco.carried[1] = 100;
  const p1 = put(m, "p1", -168, -176);
  m.module<MeleeModule>("melee")!.knockdown(m, p1, 1, "daze", null);
  const ev4 = runFor(m, 0.05);
  const spill = ev4.find((e) => e.type === "spill") as Extract<MatchEvent, { type: "spill" }> | undefined;
  check(!!spill && spill.owo === 50 && eco.carried[1] === 50, "Dazed with 100 Owo: 50 spills");
  put(m, "p0", spill!.x + 0.5, spill!.z);
  runFor(m, 0.1);
  check(eco.carried[0] === 50, "walk over it: it's yours");
  // The leader shows on the map every leaderPing seconds.
  const ev5 = runFor(m, eco.leaderPing);
  check(ev5.some((e) => e.type === "ping" && e.id === "p0"), `the leader shows on everyone's map every ${eco.leaderPing} s`);
  // The bounty: Daze the leader, take from their pocket.
  const lead = m.get("p0")!;
  eco.carried[0] = 60;
  m.module<MeleeModule>("melee")!.knockdown(m, lead, 1, "daze", m.get("p1")!);
  runFor(m, 0.05);
  check(eco.carried[1] >= 50 + ECONOMY.bounty, `Daze the leader: a bounty of ${ECONOMY.bounty} Owo`);
}
{
  // Time up: most banked wins.
  const m = newMatch(42, bare("hustle", (x) => (x.time = 3)), 3);
  runFor(m, 0.1);
  const eco = m.module<EconomyModule>("economy")!;
  eco.banked[2] = 40;
  eco.banked[1] = 10;
  const ev = runFor(m, 4);
  check(ev.some((e) => e.type === "won" && e.id === "p2"), "time up: the most Owo banked wins");
}

void MELEE;
void MOVE;
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
