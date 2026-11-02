// Naija Max (v4 Phase 7): the big world builds the same every time, its walk
// grid is quick, its places are reachable, the city in it is Naija World's
// own, and the Royale ends with the last squad standing.
//
//   node server/build-tools.mjs && node server/dist/maxtest.mjs

import { BUILTIN_MANIFEST } from "../../src/content/modes";
import { Match, settingsOf } from "../../src/game/core/match";
import { reachOf } from "../../src/game/core/reach";
import { Space } from "../../src/game/core/space";
import type { GunsModule } from "../../src/game/modules/guns";
import { buildMaxWorld, MAX_HALF } from "../../src/maps/open/max";
import { matchWorldOf } from "../../src/maps/open/matchWorld";
import { buildNaijaWorld, SURFACE_OF } from "../../src/maps/open/naija";

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures++;
}

console.log("the big world:");
let t0 = performance.now();
const L = buildMaxWorld();
const built = performance.now() - t0;
const L2 = buildMaxWorld();
check(L.half === MAX_HALF && L.placements.length === L2.placements.length && L.solids.length === L2.solids.length && L.placements.every((p, i) => p.x === L2.placements[i].x && p.prefab === L2.placements[i].prefab), `built the same twice (${L.placements.length} placements, ${L.solids.length} solids, ${built.toFixed(0)} ms)`);
const city = buildNaijaWorld();
check(city.placements.every((p, i) => p.x === L.placements[i].x && p.z === L.placements[i].z && p.prefab === L.placements[i].prefab), "Naija World's city is in the middle exactly as it is");
const kinds = new Set(L.placements.map((p) => p.prefab));
for (const k of ["pine", "turbine", "containers", "crane", "tank", "flarestack", "dune", "hangar", "ctower", "mangrove", "stilt", "club", "stand", "glasstower"] as const) check(kinds.has(k), `has ${k}`);
check(L.landmarks.filter((l) => l.id.startsWith("mx-")).length === 9, "nine new places on the compass");
check((L.boards ?? []).length > (city.boards ?? []).length + 8 && (city.boards ?? []).every((b, i) => L.boards![i].id === b.id), `more billboards: ${(L.boards ?? []).length} (the city's ${(city.boards ?? []).length} kept first, ids unchanged)`);
check(L.spawns.length >= 40, `starts spread for 24 players: ${L.spawns.length}`);
const space = new Space(L.solids, { x0: -L.half, z0: -L.half, x1: L.half, z1: L.half }, (x, z) => SURFACE_OF[L.groundAt(x, z)]);
t0 = performance.now();
const reach = reachOf(space, L.spawns[0]);
const rt = performance.now() - t0;
check(reach.size === 4 && rt < 4000, `the walk grid at 4 m cells: ${reach.n}² in ${rt.toFixed(0)} ms`);
const ok = (x: number, z: number) => {
  for (let dx = -12; dx <= 12; dx += 4) for (let dz = -12; dz <= 12; dz += 4) if (reach.at(x + dx, z + dz)) return true;
  return false;
};
for (const l of L.landmarks.filter((l) => l.id.startsWith("mx-"))) check(ok(l.x, l.z), `${l.name} is reachable on foot from the city`);
let open = 0;
for (const v of reach.ground) open += v;
check(open > 100000, `open ground to place things on: ${open} cells`);

console.log("the Royale:");
{
  const def = BUILTIN_MANIFEST.modes.find((m) => m.id === "max-royale")!;
  const world = matchWorldOf(L, space, "max-world");
  const s = settingsOf(def);
  const m = new Match({ seed: 3, world, settings: s, countdown: 0.1, contestants: Array.from({ length: 24 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, bot: false, squad: Math.floor(i / 4) })) });
  const g = m.module<GunsModule>("guns")!;
  check(!!g && g.royale && !m.settings.respawn.on, "24 players in squads of four, guns, no comebacks");
  check(g.pickups.filter((p) => p.kind === "gun").length > 200 && g.breakables.length > 300, `loot across the world: ${g.pickups.filter((p) => p.kind === "gun").length} guns, ${g.breakables.length} crates and drums`);
  while (m.phase !== "play") m.step(1 / 60);
  // Everyone but squad 2 goes down: squad 2 wins.
  for (const c of m.contestants) if (m.squads[c.index] !== 2) m.eliminate(c, "shot");
  m.step(1 / 60);
  check(!!m.winner && m.winner.squad === 2 && m.over, "the last squad standing wins");
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
