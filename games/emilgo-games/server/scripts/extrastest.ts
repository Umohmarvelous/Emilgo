// Free For All's extras (SPEC-V3 Phase 6): the §10 items in the world, and
// (as they're built) modes 6–10, Ranked, the Harmattan, the other extras.
// Headless, on Naija World, as the server runs it.
//
//   node server/build-tools.mjs && node server/dist/extrastest.mjs

import { FEATURES, AIRFALL, BLACKOUT, ECONOMY, FLAGS, GADGETS, HARMATTAN, MELEE, MOVE, POWER, TRAFFIC, ZIPS } from "../../src/config";

const FLAGS_BOUNTY = FLAGS.bounty;
import type { ItemId } from "../../src/content/items";
import { BUILTIN_MANIFEST } from "../../src/content/modes";
import type { Contestant } from "../../src/game/core/body";
import { Match, settingsOf, weeklyMutator, type MatchSettings, type Mutator } from "../../src/game/core/match";
import type { MatchEvent } from "../../src/game/core/module";
import { Space } from "../../src/game/core/space";
import type { GadgetsModule } from "../../src/game/modules/gadgets";
import type { GunsModule } from "../../src/game/modules/guns";
import type { ItemsModule } from "../../src/game/modules/items";
import type { MeleeModule } from "../../src/game/modules/melee";
import type { BlackoutModule } from "../../src/game/modules/blackout";
import type { FlagsModule } from "../../src/game/modules/flags";
import type { EconomyModule } from "../../src/game/modules/economy";
import type { RiddlesModule } from "../../src/game/modules/riddles";
import type { RoomsModule } from "../../src/game/modules/rooms";
import type { HarmattanModule } from "../../src/game/modules/harmattan";
import { RIDDLES, shownLangs } from "../../src/content/riddles";
import type { TagModule } from "../../src/game/modules/tag";
import type { TrafficModule } from "../../src/game/modules/traffic";
import type { ZipsModule } from "../../src/game/modules/zips";
import type { ZoneModule } from "../../src/game/modules/zone";
import type { AirfallModule } from "../../src/game/modules/airfall";
import { matchWorldOf } from "../../src/maps/open/matchWorld";
import { matchXp } from "../../src/rank/xp";
import { FfaGame } from "../src/ffa";
import { buildNaijaWorld, SURFACE_OF } from "../../src/maps/open/naija";

// v6: vehicles are off in every mode (FEATURES.vehicles); this test keeps their code working for when they return.
FEATURES.vehicles = true;

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
  // v7: the Smoke Canister is out, the Med Kit in.
  const extras: ItemId[] = ["med-kit", "decoy-flag", "talking-drum", "aso-ebi"];
  const gone: ItemId[] = ["smoke-pot", "pepper-soup", "iron-wrapper", "banana-peel", "pepper-powder", "megaphone", "slipper", "golden-slipper", "zanku", "shaku", "odogwu", "breakdance"];
  check(extras.every((k) => kinds.has(k)), `all four are scattered (${extras.filter((k) => kinds.has(k)).length}/4 in one match)`);
  check(gone.every((k) => !kinds.has(k)), "v5: the old items aren't (v7: nor the Smoke Canister)");
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
  // v6 max: the decoy works in every mode.
  check(items.packs[0][0] !== "decoy-flag" && gad(noFlags).placed.some((p) => p.kind === "decoy"), "v6 max: in a mode without flags it's set down too");
  // v6 max: whoever springs it is marked for its owner.
  const marked = ev2.some((e) => e.type === "reveal" && e.id === "p0" && e.tg === "p1") && gad(m).reveals.some((x) => x.by === m.get("p0")!.index && x.tg === m.get("p1")!.index);
  check(marked, `and is marked for the decoy's owner for ${GADGETS.decoy.mark} s`);
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
  // v6 max: solo, it's camouflage: off the scanner, until you fire.
  const sg = gad(solo);
  check(it.packs[0][0] !== "aso-ebi" && sg.camo(0) && sg.hidden(solo, 0), "v6 max: with nobody in squads it's camouflage");
  clear(solo, ["p0", "p1", "p2"]);
  put(solo, "p0", YX, YZ);
  put(solo, "p1", YX + 20, YZ);
  put(solo, "p2", YX - 30, YZ);
  const scan = use(solo, "p1", "talking-drum");
  const found = scan.filter((e) => e.type === "reveal" && e.id === "p1").map((e) => (e as { tg: string | null }).tg);
  check(!found.includes("p0") && found.includes("p2"), `the Pulse Scanner finds every rival in range but the camouflaged (${found.join(",")})`);
  solo.emit({ type: "fire", id: "p0", g: 0, x: 0, y: 0, z: 0, hit: 0, mag: 1 } as never);
  runFor(solo, DT * 2);
  check(!sg.camo(0), "firing ends it");
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

console.log("v6 max, the boosters (3.2):");
{
  const m = fresh(31, 4);
  clear(m, ["p0", "p1"]);
  const items = m.module<ItemsModule>("items")!;
  const guns = m.module<GunsModule>("guns")!;
  const me = put(m, "p0", YX, YZ, EAST);
  const rival = put(m, "p1", YX + 6, YZ, -EAST);
  // Walk into a Strength Booster: taken at once, never in the pack, even a full one.
  items.packs[me.index].fill("smoke-pot");
  items.add(m, "strength-booster", YX + 1.2, YZ, me.h, null);
  m.setInput("p0", 1, 0);
  const ev = runFor(m, 0.6);
  m.setInput("p0", 0, 0);
  check(ev.some((e) => e.type === "use" && e.id === "p0" && e.kind === "strength-booster") && !items.packs[me.index].includes("strength-booster"), "walked into, a booster works at once (even with a full backpack)");
  check(m.effect(me, "strength") > 20 && m.effect(me, "rise") > 0, "strength for 25 s, and the rise");
  // The rise: rooted.
  const x0 = me.x;
  m.setInput("p0", 1, 0);
  runFor(m, 0.4);
  m.setInput("p0", 0, 0);
  check(Math.abs(me.x - x0) < 0.05, `rooted while it rises (${(me.x - x0).toFixed(2)} m)`);
  // Harder hits: the same shot, with and without.
  runFor(m, 1.5);
  const hp0 = guns.hp[rival.index];
  guns.hurt(m, rival, 20, me, false, "rifle");
  const hit = hp0 - guns.hp[rival.index];
  check(Math.abs(hit - 20 * POWER.strength.gun) < 0.5 || guns.armour[rival.index] > 0, `a 20-point shot hits for ${hit.toFixed(1)} (×${POWER.strength.gun})`);
  // Taken while rising: little.
  const m2 = fresh(32, 4);
  clear(m2, ["p0", "p1"]);
  const a = put(m2, "p0", YX, YZ);
  const b = put(m2, "p1", YX + 6, YZ);
  const it2 = m2.module<ItemsModule>("items")!;
  const g2 = m2.module<GunsModule>("guns")!;
  it2.add(m2, "speed-booster", YX, YZ, a.h, null);
  runFor(m2, 0.1);
  const h0 = g2.hp[a.index];
  g2.hurt(m2, a, 20, b, false, "rifle");
  check(Math.abs(h0 - g2.hp[a.index] - 20 * POWER.riseTake) < 0.5 || g2.armour[a.index] > 0, `rising, a 20-point shot takes ${(h0 - g2.hp[a.index]).toFixed(1)}`);
  // The Speed Booster: faster, once risen.
  runFor(m2, 1.6);
  const tops: number[] = [];
  runFor(m2, 2, [], () => {
    m2.setInput("p0", 1, 0);
    m2.setButtons("p0", true, 0, 0);
    tops.push(Math.hypot(a.vx, a.vz));
  });
  const top = Math.max(...tops);
  check(top > MOVE.sprint * 1.25, `a Speed Booster's sprint: ${top.toFixed(1)} m/s (plain ${MOVE.sprint})`);
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

console.log("Riddles of the Elders:");
{
  // The drafts in Yoruba, Igbo and Hausa never show until reviewed.
  const drafts = RIDDLES.filter((r) => r.text.yo || r.text.ig || r.text.ha);
  check(drafts.length > 0 && drafts.every((r) => shownLangs(r, ["yo", "ig", "ha", "pcm"]).every((l) => l === "pcm")), `${drafts.length} riddles have Yoruba/Igbo/Hausa drafts: none shows before a fluent speaker reviews it`);
  check(RIDDLES.every((r) => world.named!.some((p) => p.id === r.answer)), `every riddle's answer is a place in Naija World (${RIDDLES.length})`);
  const m = newMatch(51, bare("riddles-elders", (x) => ((x.modules.riddles as Record<string, unknown>).every = 30)), 3);
  runFor(m, 0.1);
  const rd = m.module<RiddlesModule>("riddles")!;
  check(rd.asked.length >= rd.need && rd.tokens.length >= rd.asked.length && !!rd.bench, `${rd.asked.length} riddles, ${rd.tokens.length} kola-nut tokens, the bench`);
  const ev = runFor(m, 30);
  check(ev.some((e) => e.type === "riddle" && e.k === 0) && rd.shown >= 1, "a riddle is asked");
  clear(m, ["p0", "p1"]);
  // A wrong token: locked out for a while.
  const k0 = rd.asked[0].riddle.answer;
  const wrong = rd.tokens.find((tk) => tk.place !== k0 && !rd.asked.slice(0, rd.shown).some((a) => a.riddle.answer === tk.place))!;
  put(m, "p1", wrong.x + 0.5, wrong.z);
  m.setInteract("p1", 1, false);
  const ev2 = runFor(m, 0.1);
  check(ev2.some((e) => e.type === "token" && e.id === "p1" && !e.right) && rd.locked[1] > m.elapsed + rd.wrongCost - 1, `a wrong kola nut: no tokens for ${rd.wrongCost} s`);
  const right = rd.tokens.find((tk) => tk.place === k0)!;
  put(m, "p1", right.x + 0.5, right.z);
  m.setInteract("p1", 2, false);
  runFor(m, 0.1);
  check(rd.count(1) === 0, "… not even the right one");
  // The right token: solved.
  put(m, "p0", right.x + 0.5, right.z);
  m.setInteract("p0", 1, false);
  const ev3 = runFor(m, 0.1);
  check(ev3.some((e) => e.type === "token" && e.id === "p0" && e.right) && rd.count(0) === 1, "the place the riddle points at: solved");
  // Enough solved, back to the bench: won.
  runFor(m, rd.asked[rd.need - 1].at - m.elapsed + 0.1);
  let press = 2;
  for (let k = 1; k < rd.need; k++) {
    const tk = rd.tokens.find((x) => x.place === rd.asked[k].riddle.answer)!;
    put(m, "p0", tk.x + 0.5, tk.z);
    m.setInteract("p0", ++press, false);
    runFor(m, 0.1);
  }
  check(rd.count(0) === rd.need, `${rd.need} solved`);
  put(m, "p0", rd.bench!.x + 1, rd.bench!.z);
  const ev4 = runFor(m, 0.2);
  check(ev4.some((e) => e.type === "won" && e.id === "p0"), "back at the Elders' Bench: won");
}

console.log("Compound Wars:");
{
  const cw = (seed: number, n = 4, squads?: number[]) => {
    const st = settingsOf(def("compound-wars"));
    delete st.modules.zone;
    st.time = 900;
    const w = matchWorldOf(layout, space, "naija-world:compound");
    const mm = new Match({ seed, world: w, settings: st, contestants: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, bot: false, ...(squads ? { squad: squads[i] } : {}) })) });
    runFor(mm, 0.1);
    return mm;
  };
  const m = cw(61, 4, [0, 0, 1, 1]);
  const rm = m.module<RoomsModule>("rooms")!;
  check(rm.rooms.length === 8 && rm.doors.filter((d) => d.locked).length === 2 && rm.keys.length === 2, "8 rooms; the best two locked; two keys in the yard");
  const room = rm.rooms[0];
  check(rm.roomAt(room.x, room.z) === 0 && m.reach.at(room.x, room.z), "a room's inside is ground you can reach");
  // Walk in through the open doorway.
  const out = { x: room.door.x + room.door.nx * 2, z: room.door.z + room.door.nz * 2 };
  const a = put(m, "p0", out.x, out.z);
  for (const c of m.contestants) if (c !== a) put(m, c.id, out.x + room.door.nx * 6 + c.index, out.z + room.door.nz * 6);
  m.setInput("p0", -room.door.nx, -room.door.nz);
  runFor(m, 2);
  m.setInput("p0", 0, 0);
  check(rm.roomAt(a.x, a.z) === 0, "through the open door: inside the Boys' Quarters");
  // Shut it from inside: it scores for your squad.
  put(m, "p0", room.door.x - room.door.nx * 0.8, room.door.z - room.door.nz * 0.8);
  m.setInteract("p0", 1, false);
  const ev = runFor(m, 0.1);
  check(ev.some((e) => e.type === "door" && e.room === 0 && !e.open) && !rm.doors[0].open, "tap at the door: shut");
  put(m, "p0", room.x, room.z);
  const p0 = rm.points[0];
  runFor(m, 3);
  check(rm.holder(m, 0) === 0 && Math.abs(rm.points[0] - p0 - rm.value(0) * 3) < 0.1, `inside, door shut, one squad: ${rm.value(0)} point a second`);
  // A shut door is solid: a rival walks into it and stays out.
  const b = put(m, "p2", out.x, out.z);
  m.setInput("p2", -room.door.nx, -room.door.nz);
  runFor(m, 2);
  m.setInput("p2", 0, 0);
  check(rm.roomAt(b.x, b.z) !== 0, "a rival walking at the shut door: kept out");
  // Two squads inside: nobody scores.
  put(m, "p2", room.x + 0.8, room.z);
  const p1 = rm.points[0];
  runFor(m, 2);
  check(rm.holder(m, 0) === -1 && rm.points[0] === p1, "a rival inside too: contested, no points");
  put(m, "p2", out.x, out.z);
  // Jam: hold inside by the door.
  put(m, "p0", room.door.x - room.door.nx * 0.8, room.door.z - room.door.nz * 0.8);
  m.setInteract("p0", 2, true);
  const ev2 = runFor(m, 2);
  m.setInteract("p0", 2, false);
  check(ev2.some((e) => e.type === "door" && e.room === 0 && e.jam > m.elapsed) && rm.doors[0].jam > m.elapsed, "held inside by the shut door: jammed");
  put(m, "p2", room.door.x + room.door.nx * 0.8, room.door.z + room.door.nz * 0.8);
  m.setInteract("p2", 1, false);
  runFor(m, 0.1);
  check(!rm.doors[0].open, "a rival can't open a jammed door");
  // A locked room: take a key, open it.
  const lockedRoom = rm.doors.findIndex((d) => d.locked);
  const key = rm.keys[0];
  put(m, "p1", key.x, key.z);
  runFor(m, 0.1);
  check(key.holder === m.get("p1")!.index, "walk onto a key: you carry it");
  const lr = rm.rooms[lockedRoom];
  put(m, "p1", lr.door.x + lr.door.nx * 0.8, lr.door.z + lr.door.nz * 0.8);
  m.setInteract("p1", 1, false);
  const ev3 = runFor(m, 0.1);
  check(ev3.some((e) => e.type === "key" && e.how === "use") && !rm.doors[lockedRoom].locked && rm.doors[lockedRoom].open, `the key opens the ${["Boys' Quarters", "Storeroom", "Kitchen", "Children's Room", "Guest Room", "Parlour", "Madam's Room", "Master Bedroom"][lockedRoom]} for good`);
  // The fuse box darkens the room a rival scores most from.
  if (rm.fuseAt) {
    put(m, "p3", rm.fuseAt.x, rm.fuseAt.z);
    m.setInteract("p3", 1, false);
    const ev4 = runFor(m, 0.1);
    check(ev4.some((e) => e.type === "fuse" && e.room === 0) && rm.holder(m, 0) === -1, "the fuse box: the room the rival squad holds goes dark (no points)");
  }
}

console.log("the Harmattan:");
{
  const s = settingsOf(def("hold-the-flag"));
  delete s.modules.airfall;
  delete s.modules.vehicles;
  const m = newMatch(71, s, 4);
  const hm = m.module<HarmattanModule>("harmattan")!;
  check(!!hm && hm.storms.length === 2 && hm.storms.every((x) => x.at >= HARMATTAN.margin && x.until <= s.time - HARMATTAN.margin + 1e-6) && hm.storms[0].until <= hm.storms[1].at, `two sandstorms in an 8-minute match, ${HARMATTAN.long} s each, apart, clear of the start and the end`);
  const ph = new Match({ seed: 71, world, settings: s, contestants: m.contestants.map((c) => ({ id: c.id, name: c.name, bot: false })), mirror: true });
  const hp = ph.module<HarmattanModule>("harmattan")!;
  check(JSON.stringify(hp.storms) === JSON.stringify(hm.storms), "a phone's copy knows them without being told (the seed)");
  runFor(m, hm.storms[0].at - m.elapsed - 1);
  clear(m, ["p0"]);
  const a = put(m, "p0", YX, YZ);
  runFor(m, 3);
  const st = hm.storms[0];
  const moved = (a.x - YX) * st.wx + (a.z - YZ) * st.wz;
  check(!!hm.now(m) && moved < 0.01, `in the storm, standing still: not pushed (${moved.toFixed(2)} m in 2 s; the rework: haze only)`);
  const duel = new Match({ seed: 72, world: matchWorldOf(layout, space, "naija-world:market"), settings: settingsOf(def("flag-duel")), contestants: [{ id: "a", name: "A", bot: false }, { id: "b", name: "B", bot: false }] });
  check((duel.module<HarmattanModule>("harmattan")?.storms.length ?? 0) === 0, "none in the staked duel (part of the city)");
}

console.log("the extras (§10):");
{
  // §10.8: a squad mate helps you up (half the Daze left).
  const m = newMatch(81, bare("hold-the-flag"), 4, [0, 0, 1, 1]);
  runFor(m, 0.1);
  clear(m, ["p0", "p1", "p2"]);
  const mel = m.module<MeleeModule>("melee")!;
  const a = put(m, "p0", YX, YZ);
  put(m, "p1", YX + 1, YZ);
  mel.knockdown(m, a, MELEE.daze, "daze", null);
  runFor(m, 0.1);
  const left = mel.down[a.index] - m.elapsed;
  m.setInteract("p1", 1, false);
  const ev = runFor(m, 0.05);
  const after = mel.down[a.index] - m.elapsed;
  check(ev.some((e) => e.type === "helpup" && e.id === "p1" && e.how === "up") && Math.abs(after - left * MELEE.help.cut) < 0.1, `a squad mate taps: the Daze left halves (${left.toFixed(1)} → ${after.toFixed(1)} s)`);
  // A rival can't.
  const b = put(m, "p2", YX + 20, YZ);
  put(m, "p0", YX + 21, YZ);
  mel.knockdown(m, b, MELEE.daze, "daze", null);
  runFor(m, 0.1);
  check(!mel.mateFor(m, m.get("p0")!), "a rival down: no help from you");
  // §10.20: pulled out of a gutter.
  check(layout.gutters.length === 0, "v5: no gutters in the city");
}
{
  // §10.10: Hold the Flag's bounty on the leader.
  const m = newMatch(82, bare("hold-the-flag"), 3);
  runFor(m, 0.1);
  clear(m, ["p0", "p1"]);
  const f = m.module<FlagsModule>("flags")!;
  f.held[0] = 30;
  f.held[1] = 4;
  const lead = put(m, "p0", YX, YZ);
  m.module<MeleeModule>("melee")!.knockdown(m, lead, 1, "daze", m.get("p1")!);
  const ev = runFor(m, 0.05);
  check(ev.some((e) => e.type === "bounty" && e.id === "p1") && f.held[1] === 4 + FLAGS_BOUNTY && f.held[0] === 30 - FLAGS_BOUNTY, `Daze the leader in Hold the Flag: ${FLAGS_BOUNTY} of their seconds are yours`);
}

{
  // §10.13: the weekly mutators.
  const peak = (mu?: Mutator) => {
    const m = newMatch(90, bare("find-the-flag", (s) => (s.mutator = mu)), 2);
    runFor(m, 0.1);
    clear(m, ["p0"]);
    const c = put(m, "p0", YX, YZ);
    c.inJump++;
    let top = 0;
    runFor(m, 1.5, [], () => (top = Math.max(top, c.y)));
    return top;
  };
  const p0 = peak();
  const pj = peak("juju");
  check(pj > p0 * 1.5, `Juju Day: the jump goes higher (${p0.toFixed(2)} → ${pj.toFixed(2)} m)`);
  const slide = (mu?: Mutator) => {
    const m = newMatch(91, bare("find-the-flag", (s) => (s.mutator = mu)), 2);
    runFor(m, 0.1);
    clear(m, ["p0"]);
    const c = put(m, "p0", YX, YZ, EAST);
    c.inX = 1;
    runFor(m, 1.5);
    const x0 = c.x;
    c.inX = 0;
    runFor(m, 1.5);
    return c.x - x0;
  };
  const s0 = slide();
  const sr = slide("rainy");
  check(sr > s0 * 1.5, `Rainy Season: let go and you slide on (${s0.toFixed(2)} → ${sr.toFixed(2)} m)`);
  const dens = (mu?: Mutator) => Number(settingsOf(def("find-the-flag"), false, mu).modules.items?.density ?? 1);
  check(dens("market") === Math.min(2, dens() * 2), `Market Day: twice the items (${dens()} → ${dens("market")})`);
  const count = (mu?: Mutator) => {
    const m = new Match({ seed: 92, world, settings: settingsOf(def("find-the-flag"), false, mu), contestants: [{ id: "a", name: "A", bot: false }, { id: "b", name: "B", bot: false }] });
    runFor(m, 0.1);
    return m.module<ItemsModule>("items")!.items.length;
  };
  check(count("market") > count() * 1.6, `Market Day on the ground: ${count()} → ${count("market")} items`);
  const wk = 7 * 86_400_000;
  const seen = new Set(Array.from({ length: 4 }, (_, i) => weeklyMutator(Date.UTC(2026, 10, 2) + i * wk)));
  check(seen.size === 4 && seen.has(undefined) && weeklyMutator(Date.UTC(2026, 10, 2)) === weeklyMutator(Date.UTC(2026, 10, 8, 23)), "four weeks, four turns (one plain week); Monday to Sunday holds its mutator");
  const roster = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
  const now = weeklyMutator(Date.now());
  const g = new FfaGame(def("find-the-flag"), 5, roster, [0, 1]);
  check(g.start.mu === now && g.match.settings.mutator === now, `the start message carries this week's mutator (${now ?? "none"})`);
  const st = new FfaGame(def("flag-duel"), 5, roster, [0, 1]);
  check(!st.start.mu && !st.match.settings.mutator, "a staked match: no mutator, ever");
}

{
  // §10.14: the danfo traffic hazard.
  const mk = (seed: number) => {
    const st = settingsOf(def("find-the-flag"));
    st.time = 600;
    return newMatch(seed, st, 4);
  };
  const m = mk(95);
  runFor(m, 0.1);
  const tr = m.module<TrafficModule>("traffic")!;
  const twin = mk(95);
  runFor(twin, 0.1);
  const tw = twin.module<TrafficModule>("traffic")!;
  check(!!tr && tr.runs.length >= 5 && tr.runs.every((r, i) => Math.abs(r.at - tw.runs[i].at) < 1e-9), `a danfo runs the main road ${tr?.runs.length} times a 10-minute match, on the seed's schedule (a phone knows it too)`);
  const noCars = newMatch(95, bare("find-the-flag", (s) => (s.modules.zone = settingsOf(def("find-the-flag")).modules.zone)), 2);
  runFor(noCars, 0.1);
  check(!noCars.module("traffic"), "no cars in the mode: no danfo");
  const duel = newMatch(96, settingsOf(def("flag-duel")), 2);
  check(!duel.module<TrafficModule>("traffic")?.runs.length, "the staked duel's market: no danfo");
  // Stand in its way.
  const r0 = tr.runs[0];
  runFor(m, r0.at - m.elapsed + 1);
  const b = tr.bus(m)!;
  const ahead = 6;
  const vic = m.contestants[0];
  const ev: MatchEvent[] = [];
  const keep = () => {
    for (const c of m.contestants) if (c !== vic) put(m, c.id, 60 + c.index * 8, 160);
  };
  keep();
  put(m, vic.id, b.x + Math.sin(b.hd) * ahead, b.z + Math.cos(b.hd) * ahead);
  runFor(m, 1.2, ev, keep);
  const hit = ev.find((e) => e.type === "danfo" && e.tg === vic.id);
  const nb = tr.bus(m)!;
  const lx = (vic.x - nb.x) * Math.cos(nb.hd) - (vic.z - nb.z) * Math.sin(nb.hd);
  check(!!hit && Math.abs(lx) > TRAFFIC.wid / 2, `in its way: shoved aside (${Math.abs(lx).toFixed(1)} m off its middle)`);
  check(!m.contestants.some((c) => c.status !== "alive"), "it never hurts anyone");
}

{
  // §10.21: rooftop zip-lines.
  const zips = world.zips ?? [];
  console.log("   lines:", zips.map((z) => `(${z.x0.toFixed(0)},${z.z0.toFixed(0)},${z.h0.toFixed(1)})→(${z.x1.toFixed(0)},${z.z1.toFixed(0)}) ${Math.hypot(z.x1 - z.x0, z.z1 - z.z0).toFixed(0)} m`).join("  "));
  check(zips.length === ZIPS.count && zips.every((z) => z.h0 > z.h1 + 3) && Math.hypot(zips[0].x0 - zips[1].x0, zips[0].z0 - zips[1].z0) >= ZIPS.apart, `${ZIPS.count} lines, each roof to street, ${ZIPS.apart} m apart at least`);
  const z = zips[0];
  const st = settingsOf(def("find-the-flag"));
  delete st.modules.airfall;
  delete st.modules.vehicles;
  st.time = 900;
  const m = newMatch(97, st, 2);
  runFor(m, 0.1);
  const zm = m.module<ZipsModule>("zips")!;
  clear(m, ["p0"]);
  const roofH = z.roof;
  const c = put(m, "p0", z.x0 + 0.8, z.z0);
  c.h = roofH;
  check(Math.abs(space.floorAt(c.x, c.z, 1e3).h - roofH) < 0.05, `the anchor stands on a roof (${roofH.toFixed(1)} m up)`);
  m.setInteract("p0", 1, false);
  const ev = runFor(m, 0.1);
  check(ev.some((e) => e.type === "zip" && e.how === "on" && e.id === "p0") && zm.riding(m, c) === z, "tap by the anchor: you're on the line");
  const len = Math.hypot(z.x1 - z.x0, z.z1 - z.z0);
  let lowest = 99;
  const ev2 = runFor(m, len / ZIPS.speed + 0.5, [], () => {
    if (zm.riding(m, c) && Math.hypot(c.x - z.x1, c.z - z.z1) > 1.5) lowest = Math.min(lowest, c.h - space.topNear(c.x, c.z, MOVE.radius));
  });
  check(ev2.some((e) => e.type === "zip" && e.how === "off") && Math.hypot(c.x - z.x1, c.z - z.z1) < 4 && c.h < 0.5 && c.status === "alive", `down ${len.toFixed(0)} m in ${(len / ZIPS.speed).toFixed(1)} s, off at the foot on the street`);
  check(lowest > 0.3, `never through anything on the way (${lowest.toFixed(1)} m clear at the lowest)`);
  // From the street: no ride up (one way).
  m.setInteract("p0", 2, false);
  check(!runFor(m, 0.1).some((e) => e.type === "zip"), "at the foot: no ride back up");
  // Outside the zone: shut.
  const zone = m.module<ZoneModule>("zone")!;
  const put2 = put(m, "p0", z.x0 + 0.8, z.z0);
  put2.h = roofH;
  zone.now.x = z.x0 + 500;
  zone.now.z = z.z0;
  zone.now.r = 10;
  check(!zm.reachFor(m, put2), "outside the zone: the line is shut (no escape on it)");
}

{
  // §10.2: the power-emote cards.
  const m = fresh(98, 6, [0, 0, 1, 1, 2, 2]);
  clear(m, ["p0", "p2", "p4"]);
  put(m, "p0", YX, YZ);
  const watch = put(m, "p2", YX + 3, YZ, -EAST);
  const away = put(m, "p4", YX - 3, YZ, -EAST);
  runFor(m, 0.1);
  const ev = use(m, "p0", "zanku");
  check(ev.some((e) => e.type === "gadget" && e.kind === "zanku") && m.effect(watch, "bait") > 0 && m.effect(away, "bait") === 0, "Zanku Bait: the rival watching is baited, the one looking away isn't");
  const dancer = m.get("p0")!;
  const x0 = dancer.x;
  dancer.inX = 1;
  runFor(m, 1);
  dancer.inX = 0;
  check(Math.abs(dancer.x - x0) < 0.05, "while you dance you can't move");
  // A baited body wobbles 20% more from the same shove … from melee's hit (the same multiplier is in shove-free hits).
  check(Math.abs(m.effectValue(watch, "bait") - GADGETS.zanku.more) < 1e-9, `baited: ×${GADGETS.zanku.more} wobble from hits for ${GADGETS.zanku.s} s`);
}
{
  const m = fresh(99, 4);
  clear(m, ["p0"]);
  const c = put(m, "p0", YX, YZ);
  runFor(m, 0.1);
  use(m, "p0", "shaku");
  mel(m).shove(m, c, 1, 0, 3, 0.5, 0);
  check(Math.hypot(c.vx, c.vz) < 0.01, "Shaku Shield: a shove doesn't move you");
  runFor(m, GADGETS.shaku.s + 0.1);
  c.inZ = 1;
  const z0 = c.z;
  runFor(m, 1);
  const slowRun = c.z - z0;
  runFor(m, GADGETS.shaku.slow);
  const z1 = c.z;
  runFor(m, 1);
  c.inZ = 0;
  check(slowRun < (c.z - z1) * 0.7, `then slowed for ${GADGETS.shaku.slow} s (${slowRun.toFixed(1)} m in a second vs ${(c.z - z1).toFixed(1)} m after)`);
}
{
  const m = fresh(100, 4, [0, 0, 1, 1]);
  clear(m, ["p0", "p1"]);
  put(m, "p0", YX, YZ);
  put(m, "p1", YX + 3, YZ);
  runFor(m, 0.1);
  const g = gad(m);
  const before = g.boost(m, 0, YX, YZ);
  use(m, "p1", "odogwu");
  check(before === 1 && g.boost(m, 0, YX, YZ) === GADGETS.odogwu.more && g.boost(m, 1, YX, YZ) === 1 && g.boost(m, 0, YX + 40, YZ) === 1, `Odogwu Pose: your squad's objective near you counts ×${GADGETS.odogwu.more}; not a rival's, not far away`);
  runFor(m, GADGETS.odogwu.s + 0.1);
  check(g.boost(m, 0, YX, YZ) === 1, `for ${GADGETS.odogwu.s} s`);
}
{
  const m = fresh(101, 6);
  clear(m, ["p0", "p1", "p2", "p3", "p4"]);
  put(m, "p0", YX, YZ);
  put(m, "p1", YX + 1.2, YZ);
  const hop = put(m, "p2", YX - 1.2, YZ);
  put(m, "p3", YX, YZ + 1.2);
  put(m, "p4", YX, YZ - 4);
  m.setBrace("p3", true);
  runFor(m, 0.15);
  hop.y = 0.4;
  hop.vy = 1;
  const ev = use(m, "p0", "breakdance");
  const downs = ev.filter((e) => e.type === "down").map((e) => (e as { id: string }).id);
  check(downs.includes("p1") && !downs.includes("p2") && !downs.includes("p3") && !downs.includes("p4"), "Breakdance Sweep: trips the one beside you; a jump, a brace or standing back beats it");
  check(downs.includes("p0") && mel(m).isDown(0), "and leaves you Dazed");
}

{
  // §10.6: spectators vote where the next Airfall lands.
  const st = settingsOf(def("scarcity"));
  const m = newMatch(102, st, 6);
  runFor(m, 0.1);
  const air = m.module<AirfallModule>("airfall")!;
  const t0 = air.times[0];
  const ev: MatchEvent[] = [];
  runFor(m, t0 - AIRFALL.flare - AIRFALL.vote + 0.5 - m.elapsed, ev);
  const v = ev.find((e) => e.type === "vote") as Extract<MatchEvent, { type: "vote" }> | undefined;
  check(!!v && v.xs.length === AIRFALL.options && !!air.ballot, `${AIRFALL.vote} s before the flare: ${AIRFALL.options} spots to vote on`);
  const alive = m.contestants[0];
  check(!air.vote(m, alive, 0), "someone still playing can't vote");
  const outs = m.contestants.slice(1, 4);
  for (const c of outs) c.status = "eliminated";
  check(air.vote(m, outs[0], 2) && !air.vote(m, outs[0], 1), "a spectator votes once");
  air.vote(m, outs[1], 2);
  air.vote(m, outs[2], 0);
  const ev2: MatchEvent[] = [];
  runFor(m, t0 - AIRFALL.flare + 0.2 - m.elapsed, ev2);
  const f = ev2.find((e) => e.type === "flare") as Extract<MatchEvent, { type: "flare" }> | undefined;
  check(!!f && Math.hypot(f.x - v!.xs[2], f.z - v!.zs[2]) < 0.01 && f.votes?.[2] === 2, "the flare goes up on the spot with the most votes (2 of 3)");
}

console.log("v7, the Med Kit:");
{
  const m = newMatch(77, settingsOf(def("treasure-hunt")), 4);
  runFor(m, 0.1);
  const g = m.module<GunsModule>("guns")!;
  const items = m.module<ItemsModule>("items")!;
  const c = put(m, "p0", YX, YZ);
  clear(m, ["p0"]);
  g.hp[c.index] = 100;
  const full = use(m, "p0", "med-kit");
  check(!full.some((e) => e.type === "use") && items.packs[c.index][0] === "med-kit", "at full health it stays in the pack");
  g.hp[c.index] = 30;
  const ev = use(m, "p0", "med-kit");
  check(ev.some((e) => e.type === "use" && e.kind === "med-kit") && m.effect(c, "heal") > 2.5, "hurt: used, 3 s of healing");
  runFor(m, 3.2);
  check(g.hp[c.index] >= 89 && g.hp[c.index] <= 100, `+60 over 3 s (30 → ${g.hp[c.index].toFixed(0)})`);
  // Two at most in the pack: a third on the ground stays there.
  items.packs[c.index].fill(null);
  items.packs[c.index][0] = items.packs[c.index][1] = "med-kit";
  const it = items.add(m, "med-kit", c.x + 0.4, c.z, c.h, null);
  runFor(m, 0.3);
  check(!it.taken && items.packs[c.index].filter((k) => k === "med-kit").length === 2, "two in the pack: a third is left on the ground");
}

console.log("v7, near death:");
{
  const m = newMatch(78, settingsOf(def("treasure-hunt")), 4);
  runFor(m, 0.1);
  const g = m.module<GunsModule>("guns")!;
  const c = put(m, "p0", YX, YZ);
  clear(m, ["p0"]);
  const pace = (hp: number) => {
    put(m, "p0", YX, YZ);
    g.hp[c.index] = hp;
    m.setInput("p0", 0, -1);
    runFor(m, 1.5, [], () => (g.hp[c.index] = hp));
    m.setInput("p0", 0, 0);
    return Math.hypot(c.x - YX, c.z - YZ);
  };
  const healthy = pace(100);
  const weak = pace(5);
  check(g.weakShare(c.index) < 0.7 && weak < healthy * 0.8, `at 5 health she runs slower (${weak.toFixed(1)} m against ${healthy.toFixed(1)} m in 1.5 s)`);
  check(g.weakness(c.index) > 0.8, "and the breath and heart follow it (weakness > 0.8)");
}

console.log("v7, the backpedal:");
{
  const m = newMatch(79, settingsOf(def("treasure-hunt")), 4);
  runFor(m, 0.1);
  const c = put(m, "p0", YX, YZ, 0);
  clear(m, ["p0"]);
  // The camera looks along +z (the body faces +z: aim yaw = face − π); the stick pulls back (−z).
  m.setAim("p0", -Math.PI, 0, false, false, 0, 0);
  m.setInput("p0", 0, -1);
  m.setButtons("p0", true, 0, 0);
  runFor(m, 1.2);
  const sp = Math.hypot(c.vx, c.vz);
  const facing = Math.atan2(Math.sin(c.heading), Math.cos(c.heading));
  check(c.z < YZ - 2 && Math.abs(facing) < 0.15, `back: she steps back (${(YZ - c.z).toFixed(1)} m) still facing the camera's way (heading ${facing.toFixed(2)})`);
  check(Math.abs(sp - MOVE.run * MOVE.back) < 0.3 && !c.sprinting, `at ${MOVE.back} of the run, never sprinting (${sp.toFixed(1)} m/s)`);
  m.setInput("p0", 1, 0);
  runFor(m, 1.2);
  check(Math.abs(Math.atan2(Math.sin(c.heading - Math.PI / 2), Math.cos(c.heading - Math.PI / 2))) < 0.2, "sideways: she turns and runs that way as before");
  m.setInput("p0", 0, 0);
}

void MELEE;
void MOVE;
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
