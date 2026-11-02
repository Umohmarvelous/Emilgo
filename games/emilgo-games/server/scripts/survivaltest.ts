// Dead Streets (SPEC-V3 Phase 7): Spooky World, its route and obstacles, the
// survival rules, and a run as the server checks it. Headless.
//
//   node server/build-tools.mjs && node server/dist/survivaltest.mjs

import { MOVE } from "../../src/config";
import { Match, type MatchSettings } from "../../src/game/core/match";
import { Space } from "../../src/game/core/space";
import { SURFACE_OF } from "../../src/maps/open/naija";
import { buildSpookyWorld, routeAt, routeProgress, type Obstacle } from "../../src/maps/open/spooky";
import { matchWorldOf } from "../../src/maps/open/matchWorld";

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
function walkRoute(): { ok: boolean; seconds: number; stuck: string } {
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
    if (prog > best + 0.5) {
      best = prog;
      still = 0;
    } else if (++still > 60 * 25) break;
    lastD = prog;
  }
  const done = k >= pts.length && Math.hypot(me.x - run.finish[0], me.z - run.finish[1]) < 8;
  const stuckAt = obs.find((o) => Math.abs(o.d - lastD) < 15);
  for (const g of run.gates) layout.solids[g.solid].y0 = g.kind === "floor" ? -0.3 : 0;
  return { ok: done, seconds: m.elapsed, stuck: done ? "" : `stuck ${best.toFixed(0)} m in at (${me.x.toFixed(1)}, ${me.z.toFixed(1)}, h ${me.h.toFixed(1)})${stuckAt ? ` near #${stuckAt.n} ${stuckAt.name}` : ""}` };
}
const w = walkRoute();
check(w.ok, `a body walks the whole route, every obstacle its own way (${(w.seconds / 60).toFixed(1)} min)${w.stuck ? `: ${w.stuck}` : ""}`);
void MOVE;

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
