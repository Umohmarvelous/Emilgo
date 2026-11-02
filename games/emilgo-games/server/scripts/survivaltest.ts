// Dead Streets (SPEC-V3 Phase 7): Spooky World, its route and obstacles, the
// survival rules, and a run as the server checks it. Headless.
//
//   node server/build-tools.mjs && node server/dist/survivaltest.mjs

import { MOVE, SURVIVAL } from "../../src/config";
import { BUILTIN_MANIFEST } from "../../src/content/modes";
import { Match, settingsOf, type MatchSettings } from "../../src/game/core/match";
import type { MatchEvent } from "../../src/game/core/module";
import { dailySeed, medalOf, runMutator, type SurvivalModule } from "../../src/game/modules/survival";
import { Space } from "../../src/game/core/space";
import { SURFACE_OF } from "../../src/maps/open/naija";
import { buildSpookyWorld, routeAt, routeProgress, type Obstacle } from "../../src/maps/open/spooky";
import { matchWorldOf } from "../../src/maps/open/matchWorld";
import { verifyRun } from "../src/runs";
import { WebSocket } from "ws";
import { NET } from "../../src/config";
import type { ServerMsg } from "../../src/net/protocol";

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures++;
}
const DT = 1 / 60;

console.log("Spooky World:");
const t0 = performance.now();
const layout = buildSpookyWorld();
const space = new Space(layout.solids, { x0: -layout.half, z0: -layout.half, x1: layout.half, z1: layout.half }, (x, z) => SURFACE_OF[layout.groundAt(x, z)]);
const run = layout.run;
console.log(`   built in ${(performance.now() - t0).toFixed(0)} ms: ${layout.placements.length} buildings, ${layout.solids.length} solids`);
check(layout.half * 2 === 320, "320 × 320 m");
check(run.length > 1300 && run.length < 1600, `a winding route of ${(run.length / 1000).toFixed(2)} km`);
check(layout.landmarks.length === 12, "twelve districts");
const ns = new Set(run.obstacles.map((o) => o.n));
check(ns.size === 30 && [...ns].every((n) => n >= 1 && n <= 30), "all thirty obstacles on the route");
check(run.obstacles.filter((o) => o.tricky).length === 5, "five of them deliberately confusing (✦)");
const fixedNear = layout.landmarks.filter((l) => layout.placements.some((p) => Math.hypot(p.x - l.x, p.z - l.z) < 22)).length;
check(fixedNear === 12, `every district has its buildings (${fixedNear}/12)`);
check(run.sanctuaries.length >= 2, `${run.sanctuaries.length} sanctuaries (churches and mosques)`);

/** Walk the whole route, as a player would: each obstacle by its hint. Gates opened as the rules would. */
function walkRoute(): { ok: boolean; seconds: number; stuck: string; trace: number[] } {
  const world = matchWorldOf(layout, space);
  const settings: MatchSettings = { time: 3600, respawn: { on: false, delay: 6 }, modules: {} };
  const m = new Match({ seed: 1, world, settings, contestants: [{ id: "me", name: "Me", bot: false }], countdown: 0 });
  while (m.phase !== "play") m.step(DT);
  const me = m.get("me")!;
  me.x = run.start[0];
  me.z = run.start[1];
  me.h = space.floorAt(me.x, me.z, 0).h;
  // Waypoints: the route's corners, with each obstacle's own way through spliced in.
  type W = { x: number; z: number; ob?: Obstacle };
  const pts: W[] = [];
  const obs = [...run.obstacles].sort((a, b) => a.d - b.d);
  let oi = 0;
  for (let d = 2; d <= run.length; d += 2) {
    while (oi < obs.length && obs[oi].d - 14 <= d) {
      const o = obs[oi++];
      if (o.path) for (const [x, z] of o.path) pts.push({ x, z, ob: o });
      else for (let e = -12; e <= 12; e += 2) {
        const p = routeAt(run, o.d + e);
        pts.push({ x: p.x, z: p.z, ob: o });
      }
      d = o.d + 14;
    }
    const p = routeAt(run, d);
    pts.push({ x: p.x, z: p.z });
  }
  for (const g of run.gates) if (g.kind !== "floor") layout.solids[g.solid].y0 = 99;
  let k = 0;
  let jumpN = 0;
  let best = 0;
  let still = 0;
  let lastD = 0;
  const end = 1200;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const trace: number[] = [0, r1(me.x), r1(me.z), r1(me.h)];
  let traceAt = 1;
  while (m.elapsed < end && k < pts.length) {
    const p = pts[k];
    const dx = p.x - me.x;
    const dz = p.z - me.z;
    const dist = Math.hypot(dx, dz);
    if (dist < (p.ob?.path ? 0.7 : 1.4)) {
      k++;
      continue;
    }
    const prog = routeProgress(run, me.x, me.z).d;
    const near = obs.find((o) => Math.abs(o.d - prog) < 9);
    const prone = near?.how === "prone";
    m.setButtons("me", near?.how === "jump", prone ? 2 : 0, jumpN);
    if (near?.how === "jump" && near.jumpAt !== undefined && prog >= near.jumpAt && prog < near.jumpAt + 1 && me.y === 0) m.setButtons("me", true, 0, ++jumpN);
    m.setInput("me", dx / dist, dz / dist);
    m.step(DT);
    if (m.elapsed >= traceAt) {
      traceAt += 1;
      trace.push(r1(m.elapsed), r1(me.x), r1(me.z), r1(me.h));
    }
    if (prog > best + 0.5) {
      best = prog;
      still = 0;
    } else if (++still > 60 * 25) break;
    lastD = prog;
  }
  const done = k >= pts.length && Math.hypot(me.x - run.finish[0], me.z - run.finish[1]) < 8;
  const stuckAt = obs.find((o) => Math.abs(o.d - lastD) < 15);
  for (const g of run.gates) [layout.solids[g.solid].y0, layout.solids[g.solid].y1] = g.shut;
  trace.push(r1(m.elapsed), r1(me.x), r1(me.z), r1(me.h));
  return { trace, ok: done, seconds: m.elapsed, stuck: done ? "" : `stuck ${best.toFixed(0)} m in at (${me.x.toFixed(1)}, ${me.z.toFixed(1)}, h ${me.h.toFixed(1)})${stuckAt ? ` near #${stuckAt.n} ${stuckAt.name}` : ""}` };
}
const w = walkRoute();
check(w.ok, `a body walks the whole route, every obstacle its own way (${(w.seconds / 60).toFixed(1)} min)${w.stuck ? `: ${w.stuck}` : ""}`);

console.log("\nthe run's rules:");
const DS = BUILTIN_MANIFEST.modes.find((d) => d.id === "dead-streets")!;
const world = matchWorldOf(layout, space);
function newRun(seed: number, extra: Record<string, unknown> = {}, items = false): { m: Match; sv: SurvivalModule; me: ReturnType<Match["get"]> & object } {
  const st = settingsOf(DS);
  if (!items) delete st.modules.items;
  st.modules.survival = { ...st.modules.survival, ...extra };
  const m = new Match({ seed, world, settings: st, contestants: [{ id: "me", name: "Me", bot: false }, ...Array.from({ length: SURVIVAL.cap }, (_, i) => ({ id: `z${i}`, name: "Zombie", bot: true, squad: 1 }))], countdown: 0 });
  while (m.phase !== "play") m.step(DT);
  return { m, sv: m.module<SurvivalModule>("survival")!, me: m.get("me")! };
}
function runFor(m: Match, s: number, out: MatchEvent[] = [], each?: () => void): MatchEvent[] {
  const end = m.elapsed + s;
  while (m.elapsed < end - 1e-9 && !m.over) {
    each?.();
    m.step(DT);
    out.push(...m.drain());
  }
  return out;
}
const put = (m: Match, id: string, x: number, z: number, hd = 0) => {
  const c = m.get(id)!;
  c.x = x;
  c.z = z;
  c.h = space.floorAt(x, z, 0).h;
  c.vx = c.vz = c.y = 0;
  c.heading = hd;
  return c;
};
/** A stretch of street with no obstacle within 25 m, from about `d` metres in. */
function clearAt(d: number): ReturnType<typeof routeAt> {
  for (let e = d; e < run.length; e += 3) {
    const leg = routeAt(run, e).leg;
    if (e - run.at[leg] > 14 && run.at[leg + 1] - e > 14 && !run.obstacles.some((o) => Math.abs(o.d - e) < 25)) return routeAt(run, e);
  }
  return routeAt(run, d);
}
let atkN = 0;
const swing = (m: Match, kind: 1 | 2 | 3) => m.setActions("me", ((++atkN & 63) << 2) | kind, 0);
{
  const { m, sv, me } = newRun(11);
  check(Math.hypot(me.x - run.start[0], me.z - run.start[1]) < 1 && m.contestants.slice(1).every((z) => z.status !== "alive"), "you start at the Motor Park; the zombies sleep in the pool");
  const ev = runFor(m, 45);
  const rises = ev.filter((e) => e.type === "zrise") as Extract<MatchEvent, { type: "zrise" }>[];
  const seen = rises.filter((r) => space.lineClear(me.x, me.z, r.x, r.z, me.h + 1.6)).length;
  const far = Math.max(...rises.map((r) => Math.hypot(r.x - run.start[0], r.z - run.start[1])));
  check(rises.length >= 4 && far <= SURVIVAL.spawn.far + 4, `the director raises ${rises.length} in 45 s, 16–34 m off (the furthest ${far.toFixed(0)} m)`);
  check(seen <= Math.ceil(rises.length * 0.25), `mostly out of your sight (${seen} of ${rises.length} in view)`);
  const hp0 = sv.hp;
  const claws = ev.filter((e) => e.type === "claw").length;
  check(claws > 0 && sv.hp < hp0 + 1, `standing still, they reach you and claw (${claws} claws, health ${Math.round(sv.hp)})`);
}
{
  // A zombie behind a building finds its way round (the flow field).
  const { m, me } = newRun(12);
  const p = routeAt(run, 300);
  put(m, "me", p.x, p.z);
  const z = m.get("z0")!;
  // A free cell 20 m off with no straight line to you.
  let spot: [number, number] | null = null;
  for (let a = 0; a < 64 && !spot; a++) {
    const x = p.x + Math.sin(a) * 18;
    const zz = p.z + Math.cos(a) * 18;
    const k = m.reach.cell(x, zz);
    if (k >= 0 && m.reach.free[k] && !space.lineClear(p.x, p.z, x, zz, 1.4)) spot = [x, zz];
  }
  const sv = m.module<SurvivalModule>("survival")!;
  (sv as unknown as { rise(m: Match, z: object, x: number, zz: number): void }).rise(m, z, spot![0], spot![1]);
  const d0 = Math.hypot(z.x - me.x, z.z - me.z);
  runFor(m, 20, [], () => { me.inX = me.inZ = 0; });
  const d1 = Math.hypot(z.x - me.x, z.z - me.z);
  check(!!spot && d1 < 2.5, `a zombie out of sight ${d0.toFixed(0)} m off, round the walls, reaches you (${d1.toFixed(1)} m)`);
}
{
  // The gun: two body shots or one head; the cutlass; a shove.
  const { m, sv } = newRun(13);
  const p = clearAt(520);
  put(m, "me", p.x, p.z, Math.atan2(p.ux, p.uz));
  const z = m.get("z1")!;
  (sv as unknown as { rise(m: Match, z: object, x: number, zz: number): void }).rise(m, z, p.x + p.ux * 10, p.z + p.uz * 10);
  runFor(m, SURVIVAL.rise + 0.1, [], () => { z.inX = z.inZ = 0; });
  const ammo0 = sv.ammo;
  sv.hp = 100;
  const ev: MatchEvent[] = [];
  for (let k = 0; k < 3 && z.status === "alive"; k++) {
    swing(m, 2);
    runFor(m, 0.4, ev);
  }
  const shots = ev.filter((e) => e.type === "shot") as Extract<MatchEvent, { type: "shot" }>[];
  check(shots.length >= 1 && shots.length <= 2 && z.status !== "alive" && sv.ammo === ammo0 - shots.length && sv.tally.kills === 1, `the gun: down in ${shots.length} shot${shots.length > 1 ? "s" : ""}${shots.some((s) => s.head) ? " (a head shot)" : ""}, ${shots.length} rounds gone`);
  const z2 = m.get("z2")!;
  (sv as unknown as { rise(m: Match, z: object, x: number, zz: number): void }).rise(m, z2, p.x + p.ux * 1.4, p.z + p.uz * 1.4);
  runFor(m, SURVIVAL.rise + 0.05);
  const ev2: MatchEvent[] = [];
  for (let k = 0; k < 8 && z2.status === "alive"; k++) {
    swing(m, 1);
    runFor(m, 0.6, ev2);
  }
  check(z2.status !== "alive" && ev2.filter((e) => e.type === "blow" && e.tg === "z2").length === 3, "the cutlass: three blows that land put one down");
  // Out of ammo: no shot.
  sv.ammo = 0;
  const ev3 = runFor(m, 0.4, [], () => {});
  swing(m, 2);
  runFor(m, 0.4, ev3);
  check(!ev3.some((e) => e.type === "shot"), "no rounds: the gun clicks (no shot)");
}
{
  // The gates: three blows, a key, the generator, the floor.
  const { m, sv, me } = newRun(14);
  const byKind = (k: string) => run.gates.find((g) => g.kind === k)!;
  const bar = byKind("barricade");
  put(m, "me", bar.x, bar.z);
  const s = layout.solids[bar.solid];
  me.x -= Math.sin(s.rot) * 1.4;
  me.z -= Math.cos(s.rot) * 1.4;
  const ev: MatchEvent[] = [];
  for (let k = 0; k < 3; k++) {
    swing(m, 1);
    runFor(m, 0.6, ev);
  }
  check(sv.open.has(bar.id) && s.y0 > 50, "a barricaded door: three blows and it's open");
  const kg = byKind("key");
  put(m, "me", kg.key![0], kg.key![1]);
  runFor(m, 0.1);
  put(m, "me", kg.x - Math.sin(layout.solids[kg.solid].rot) * 1.3, kg.z - Math.cos(layout.solids[kg.solid].rot) * 1.3);
  m.setInteract("me", 1, false);
  runFor(m, 0.1);
  check(sv.keys.has(kg.id) && sv.open.has(kg.id), "the gateman's gate: his keys from the post, then it opens");
  const gg = byKind("generator");
  put(m, "me", gg.sw![0], gg.sw![1]);
  m.setInteract("me", 2, false);
  runFor(m, 0.1);
  const shut = !sv.open.has(gg.id);
  put(m, "me", gg.fuel![0], gg.fuel![1]);
  runFor(m, 0.1);
  put(m, "me", gg.sw![0], gg.sw![1]);
  m.setInteract("me", 3, false);
  runFor(m, 0.1);
  check(shut && sv.fuel.has(gg.id) && sv.open.has(gg.id), "the generator gate: the switch does nothing until the fuel is in");
  const fl = byKind("floor");
  put(m, "me", fl.x, fl.z);
  runFor(m, 0.5);
  check(sv.open.has(fl.id) && me.h < -2, `the floor gives way: down to the basement (${me.h.toFixed(1)} m)`);
}
{
  // Hazards, sanctuary, bleed, the laser, the Mast.
  const { m, sv, me } = newRun(15);
  const spark = run.hazards.find((h) => h.kind === "spark")!;
  put(m, "me", spark.x, spark.z);
  const ev = runFor(m, spark.period + 0.2, [], () => { me.inX = me.inZ = 0; });
  check(ev.some((e) => e.type === "hazard" && e.hz === spark.id), `a live power line catches you on its beat (health ${Math.round(sv.hp)})`);
  const sa = run.sanctuaries[0];
  put(m, "me", sa.x, sa.z);
  sv.hp = 50;
  const ev2 = runFor(m, 12, [], () => { me.inX = me.inZ = 0; });
  check(sv.hp > 60 && sv.hp <= 50 + SURVIVAL.heal.most + 0.01 && !ev2.some((e) => e.type === "claw"), `a sanctuary: quiet, health back (${Math.round(sv.hp)}), no claws`);
  swing(m, 2);
  check(!runFor(m, 0.2).some((e) => e.type === "shot"), "no weapons in a sanctuary");
}
{
  const { m, sv, me } = newRun(16);
  const p = routeAt(run, 200);
  put(m, "me", p.x, p.z);
  // Time on to the bleed (the zombies held off).
  const zs = m.contestants.slice(1);
  runFor(m, 725, [], () => {
    for (const z of zs) if (z.status === "alive") { z.status = "eliminated"; }
    sv.hp = Math.max(sv.hp, 100);
  });
  const h0 = sv.hp;
  runFor(m, 5, [], () => { for (const z of zs) z.status = "eliminated"; });
  check(h0 - sv.hp > 4 && h0 - sv.hp < 6, `after 12:00 the bleed: ${(h0 - sv.hp).toFixed(1)}% in 5 s`);
  sv.hp = 0.5;
  const ev = runFor(m, 3);
  check(ev.some((e) => e.type === "laser") && me.status === "eliminated" && m.over && !sv.tally.finished, "at 0 health the sky laser, and the run is over");
}
{
  const { m, sv } = newRun(17);
  put(m, "me", run.finish[0] - 3, run.finish[1]);
  const ev = runFor(m, 0.2, [], () => (sv.hp = 100));
  check(ev.some((e) => e.type === "stand") && !m.over, "at the Mast: the Last Stand begins (the gate grinds open)");
  const ev2 = runFor(m, SURVIVAL.stand.s + 0.5, [], () => {
    sv.hp = 100;
    // Hold the ground (a shove can move you a little).
    put(m, "me", run.finish[0] - 3, run.finish[1]);
  });
  const rose = ev2.filter((e) => e.type === "zrise").length;
  check(ev2.some((e) => e.type === "won") && sv.tally.finished && m.over, `held ${SURVIVAL.stand.s} s (${rose} came for you): the run is won`);
}
{
  const { m, sv } = newRun(18);
  const p = routeAt(run, 600);
  put(m, "me", p.x, p.z);
  runFor(m, 60, [], () => (sv.hp = 100));
  const t1 = performance.now();
  runFor(m, 10, [], () => (sv.hp = 100));
  const us = ((performance.now() - t1) / 600) * 1000;
  const awake = m.contestants.slice(1).filter((z) => z.status === "alive").length;
  check(us < 400, `a step with ${awake} awake: ${us.toFixed(0)} µs`);
}

console.log("\nDead Streets' extras (Phase 8):");
type Riser = { rise(m: Match, z: object, x: number, zz: number, kind?: string): void };
{
  // Torch stun on a Runner; a Masked only falls to a head shot.
  const { m, sv, me } = newRun(21);
  const p = clearAt(400);
  put(m, "me", p.x, p.z, Math.atan2(p.ux, p.uz));
  const r = m.get("z0")!;
  (sv as unknown as Riser).rise(m, r, p.x + p.ux * 8, p.z + p.uz * 8, "runner");
  const ev = runFor(m, SURVIVAL.rise + SURVIVAL.beam.hold + 0.3, [], () => { me.inX = me.inZ = 0; sv.hp = 100; });
  check(ev.some((e) => e.type === "beam" && e.id === "z0"), "the torch held on a Runner's face staggers it");
  const mk = m.get("z1")!;
  (sv as unknown as Riser).rise(m, mk, p.x + p.ux * 1.5, p.z + p.uz * 1.5, "masked");
  runFor(m, SURVIVAL.rise + 0.1, [], () => (sv.hp = 100));
  for (let k = 0; k < 5; k++) {
    swing(m, 1);
    runFor(m, 0.6, [], () => (sv.hp = 100));
  }
  check(mk.status === "alive" && sv.zhp[mk.index] === SURVIVAL.kinds.masked.hp, "the Masked: a blade staggers it, never kills it");
}
{
  // A Bloater bursts into gas; a Screamer brings more; a Lurker grabs you in the pool.
  const { m, sv, me } = newRun(22);
  const p = clearAt(600);
  put(m, "me", p.x, p.z, Math.atan2(p.ux, p.uz));
  const b = m.get("z0")!;
  (sv as unknown as Riser).rise(m, b, p.x + p.ux * 1.5, p.z + p.uz * 1.5, "bloater");
  runFor(m, SURVIVAL.rise + 0.1, [], () => (sv.hp = 100));
  const ev: MatchEvent[] = [];
  for (let k = 0; k < 3 && b.status === "alive"; k++) {
    swing(m, 1);
    runFor(m, 0.6, ev, () => (sv.hp = 100));
  }
  check(ev.some((e) => e.type === "gas") && sv.gasUntil > m.elapsed, "a Bloater cut down up close: the pepper gas slows you");
  const sc = m.get("z2")!;
  (sv as unknown as Riser).rise(m, sc, p.x - p.ux * 12, p.z - p.uz * 12, "screamer");
  const ev2 = runFor(m, SURVIVAL.rise + SURVIVAL.scream.after + 2, [], () => { sv.hp = 100; me.inX = me.inZ = 0; });
  check(ev2.some((e) => e.type === "scream") && ev2.filter((e) => e.type === "zrise").length >= 1, "a Screamer left alone screams, and more come");
  const pool = run.hazards.find((h) => h.kind === "pool")!;
  const { m: m2, sv: sv2, me: me2 } = newRun(23);
  put(m2, "me", pool.x, pool.z);
  const lk = m2.get("z0")!;
  (sv2 as unknown as Riser).rise(m2, lk, pool.x + 0.8, pool.z, "lurker");
  const ev3 = runFor(m2, SURVIVAL.rise + 2, [], () => { sv2.hp = 100; me2.inX = me2.inZ = 0; });
  const held = sv2.heldBy === lk.index && ev3.some((e) => e.type === "grabbed");
  swing(m2, 1);
  runFor(m2, 0.3, [], () => (sv2.hp = 100));
  check(held && sv2.heldBy < 0, "a Pool Lurker grabs your legs in the water; a blow frees you");
}
{
  // A Brute charges; side-step and it runs on into the wall behind you, stunned.
  const { m, sv, me } = newRun(24);
  const p = clearAt(800);
  const nx = p.uz;
  const nz = -p.ux;
  put(m, "me", p.x + nx * 3.3, p.z + nz * 3.3);
  const br = m.get("z0")!;
  (sv as unknown as Riser).rise(m, br, p.x - nx * 3.6, p.z - nz * 3.6, "brute");
  runFor(m, SURVIVAL.rise + 0.05, [], () => { sv.hp = 100; me.inX = me.inZ = 0; });
  // Out of the way the moment it charges (along the street).
  br.x = p.x - nx * 3.6 - p.ux * 6;
  br.z = p.z - nz * 3.6 - p.uz * 6;
  let charged = false;
  const ev = runFor(m, 5, [], () => {
    sv.hp = 100;
    me.inX = me.inZ = 0;
    if (!charged && (sv as unknown as { charge: Float64Array }).charge[br.index] >= 0) {
      charged = true;
      me.x += p.ux * 4;
      me.z += p.uz * 4;
    }
  });
  check(charged && ev.some((e) => e.type === "charge"), "a Brute charges in a straight line");
  check(ev.some((e) => e.type === "beam" && e.id === "z0"), "side-step and it runs on into the wall: stunned");
}
{
  // Finds: lore underfoot, a cache by its chalk mark, the bounty's gold key and the vault.
  const { m, sv, me } = newRun(25, {}, true);
  check(sv.finds.filter((f) => f.kind === "cache").length >= 6 && sv.finds.filter((f) => f.kind === "lore").length >= 20 && sv.finds.some((f) => f.kind === "vault"), `${sv.finds.filter((f) => f.kind === "cache").length} caches, ${sv.finds.filter((f) => f.kind === "lore").length} pieces of lore and the vault beside the route`);
  const lore = sv.finds.find((f) => f.kind === "lore")!;
  put(m, "me", lore.x, lore.z);
  const ev = runFor(m, 0.2, [], () => (sv.hp = 100));
  check(ev.some((e) => e.type === "find" && e.kind === "lore") && sv.tally.lore === 1, "lore: walk over it and it's read");
  const cache = sv.finds.find((f) => f.kind === "cache")!;
  put(m, "me", cache.x, cache.z);
  m.setInteract("me", 1, false);
  const ev2 = runFor(m, 0.2, [], () => (sv.hp = 100));
  const got = ev2.find((e) => e.type === "find" && e.kind === "cache") as Extract<MatchEvent, { type: "find" }> | undefined;
  check(!!got && got.items.length === 2 && sv.tally.caches === 1, `Grandma's tin box: ${got?.items.join(", ")}`);
  const vault = sv.finds.find((f) => f.kind === "vault")!;
  put(m, "me", vault.x, vault.z);
  m.setInteract("me", 2, false);
  const shut = !runFor(m, 0.2, [], () => (sv.hp = 100)).some((e) => e.type === "find");
  sv.tally.route = 0.4;
  const bz = m.get("z3")!;
  (sv as unknown as Riser).rise(m, bz, me.x + 1.4, me.z, "shambler");
  const isBounty = sv.bounty === bz.index;
  runFor(m, SURVIVAL.rise + 0.1, [], () => (sv.hp = 100));
  me.heading = Math.atan2(bz.x - me.x, bz.z - me.z);
  for (let k = 0; k < 10 && bz.status === "alive"; k++) {
    me.heading = Math.atan2(bz.x - me.x, bz.z - me.z);
    swing(m, 1);
    runFor(m, 0.6, [], () => (sv.hp = 100));
  }
  m.setInteract("me", 3, false);
  const ev3 = runFor(m, 0.2, [], () => (sv.hp = 100));
  check(shut && isBounty && sv.goldKey && ev3.some((e) => e.type === "find" && e.kind === "vault"), "the vault is shut until the bounty zombie's gold key opens it");
}
{
  // The broken doll in the toy shop: the beam on her eyes three times opens the secret room.
  const { m, sv, me } = newRun(30, {}, true);
  const egg = sv.finds.find((f) => f.kind === "egg")!;
  const ev: MatchEvent[] = [];
  for (let k = 0; k < 3; k++) {
    put(m, "me", egg.x + 4, egg.z, Math.atan2(-4, 0));
    runFor(m, 1.2, ev, () => { sv.hp = 100; me.inX = me.inZ = 0; me.heading = Math.atan2(egg.x - me.x, egg.z - me.z); });
    me.heading += Math.PI;
    runFor(m, 0.2, ev, () => { sv.hp = 100; me.inX = me.inZ = 0; });
  }
  put(m, "me", egg.x + 0.5, egg.z);
  m.setInteract("me", 9, false);
  runFor(m, 0.2, ev, () => (sv.hp = 100));
  check(sv.eggHits === 3 && ev.some((e) => e.type === "find" && e.kind === "egg" && e.items.length > 0), "the broken doll: her eyes in the beam three times, and the secret room opens");
}
{
  // Perks, charms, weapons, mutators, the daily seed, medals.
  const b = newRun(26, { perks: ["breath"] });
  b.sv.hp = 0;
  runFor(b.m, 0.2);
  check(b.sv.hp === 30 && b.me.status === "alive" && b.sv.breathed, "Second Breath: up again once at 30%");
  const c = newRun(27, { charms: ["melee", "notorch"] });
  c.sv.tally.seconds = 0;
  swing(c.m, 2);
  const noShot = !runFor(c.m, 0.3).some((e) => e.type === "shot");
  check(noShot && c.sv.torch === 0 && Math.abs(c.sv.tally.charm - 1.2 * 1.15) < 1e-9, `juju charms: melee only, no torch (×${c.sv.tally.charm.toFixed(2)} XP)`);
  const o = newRun(28, { mutator: "onebullet" });
  check(o.sv.ammo === 1, "One Bullet week: one round");
  const d = newRun(29, { weapon: "dane" });
  const p = clearAt(400);
  put(d.m, "me", p.x, p.z, Math.atan2(p.ux, p.uz));
  const zs = [d.m.get("z0")!, d.m.get("z1")!, d.m.get("z2")!];
  zs.forEach((z, k) => (d.sv as unknown as Riser).rise(d.m, z, p.x + p.ux * 4 + p.uz * (k - 1) * 0.8, p.z + p.uz * 4 - p.ux * (k - 1) * 0.8));
  runFor(d.m, SURVIVAL.rise + 0.1, [], () => { d.sv.hp = 100; for (const z of zs) z.inX = z.inZ = 0; });
  swing(d.m, 2);
  runFor(d.m, 0.2, [], () => (d.sv.hp = 100));
  swing(d.m, 2);
  runFor(d.m, SURVIVAL.dane.every + 0.1, [], () => (d.sv.hp = 100));
  swing(d.m, 2);
  runFor(d.m, 0.2, [], () => (d.sv.hp = 100));
  check(zs.filter((z) => z.status !== "alive").length >= 2 && d.sv.ammo === SURVIVAL.you.ammo - 2 * SURVIVAL.dane.rounds, `the Dane gun: a spread takes ${zs.filter((z) => z.status !== "alive").length} at once, slow to reload`);
  check(dailySeed("2026-11-02") === dailySeed("2026-11-02") && dailySeed("2026-11-02") !== dailySeed("2026-11-03"), "the Daily Run: one seed a day, the same for everyone");
  const weeks = new Set(Array.from({ length: 5 }, (_, i) => runMutator(Date.UTC(2026, 10, 2) + i * 7 * 86_400_000)));
  check(weeks.size === 5, "the run's weekly mutators: five weeks, five turns (one plain)");
  check(medalOf({ finished: true, seconds: 500 }) === "gold" && medalOf({ finished: true, seconds: 700 }) === "bronze" && medalOf({ finished: false, seconds: 100 }) === null, "medals by time");
}

console.log("\nthe server's check of a run:");
{
  const tr = w.trace;
  const secs = tr[tr.length - 4];
  const claim = { secs, fin: true, kills: 20, heads: 5, route: 1 };
  const v = verifyRun(tr, claim, secs + 10);
  check(v.ok, `an honest run passes (${(secs / 60).toFixed(1)} min, ${tr.length / 4} samples)${v.ok ? "" : `: ${v.why}`}`);
  check(!verifyRun(tr, claim, secs - 30).ok, "finished quicker than the wall clock allows: refused");
  const tele = tr.slice();
  const k = Math.floor(tele.length / 8) * 4;
  tele[k + 1] += 40;
  check(!verifyRun(tele, claim, secs + 10).ok, "a jump of 40 m between samples: refused");
  const cut = tr.slice(0, 4).concat(tr.slice(-40));
  check(!verifyRun(cut, claim, secs + 10).ok, "straight to the Mast (skipping the checkpoints): refused");
  // Through the walls: the same times, a straight line from start to finish.
  const n = tr.length / 4;
  const ghost: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    ghost.push(tr[i * 4], tr[1] + (run.finish[0] - tr[1]) * u, tr[2] + (run.finish[1] - tr[2]) * u, 0);
  }
  check(!verifyRun(ghost, claim, secs + 10).ok, "a ghost through the walls: refused");
  check(!verifyRun(tr, { ...claim, kills: 5000 }, secs + 10).ok, "5,000 kills in one run: refused");
}

const GAME = process.env.GAME;
if (GAME) {
  console.log("\nonline: a run asked for, sent, checked:");
  const ws = new WebSocket(GAME);
  const got: ServerMsg[] = [];
  const wait = (t: ServerMsg["t"], ms = 5000) => new Promise<ServerMsg | null>((res) => {
    const t0 = Date.now();
    const tick = () => {
      const m = got.find((x) => x.t === t);
      if (m) return res(m);
      if (Date.now() - t0 > ms) return res(null);
      setTimeout(tick, 30);
    };
    tick();
  });
  ws.on("message", (d) => got.push(JSON.parse(String(d))));
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ t: "hello", v: NET.protocol, name: "Runner" }));
  await wait("welcome");
  ws.send(JSON.stringify({ t: "runstart" }));
  const tok = (await wait("runtok")) as Extract<ServerMsg, { t: "runtok" }> | null;
  check(!!tok && tok.seed > 0, "the server hands out a run (an id and a seed)");
  // The server's clock must allow the run: wait as long as a short trace (the first 40 s of the honest one).
  const part = w.trace.slice(0, 4 * 41);
  await new Promise((r) => setTimeout(r, 1000));
  for (let i = 0; i < part.length; i += 540) ws.send(JSON.stringify({ t: "runpart", id: tok!.id, pts: part.slice(i, i + 540) }));
  ws.send(JSON.stringify({ t: "runend", id: tok!.id, secs: part[part.length - 4], fin: false, kills: 1, heads: 0, route: 0.05 }));
  const res = (await wait("runres")) as Extract<ServerMsg, { t: "runres" }> | null;
  check(!!res && !res.ok && res.why === "clock", `40 s of running sent after 1 s: refused by the clock (${res?.why})`);
  got.length = 0;
  ws.send(JSON.stringify({ t: "runstart" }));
  const tok2 = (await wait("runtok")) as Extract<ServerMsg, { t: "runtok" }> | null;
  const short = w.trace.slice(0, 4 * 4);
  await new Promise((r) => setTimeout(r, 3200));
  ws.send(JSON.stringify({ t: "runpart", id: tok2!.id, pts: short }));
  ws.send(JSON.stringify({ t: "runend", id: tok2!.id, secs: short[short.length - 4], fin: false, kills: 0, heads: 0, route: 0.01 }));
  const res2 = (await wait("runres")) as Extract<ServerMsg, { t: "runres" }> | null;
  const rank = got.find((x) => x.t === "rank") as Extract<ServerMsg, { t: "rank" }> | undefined;
  check(!!res2?.ok && (res2.gain ?? 0) > 0 && !!rank, `an honest start, checked: +${res2?.gain} XP${res2?.ok ? "" : ` (${res2?.why})`}`);
  ws.close();
}

void MOVE;

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
