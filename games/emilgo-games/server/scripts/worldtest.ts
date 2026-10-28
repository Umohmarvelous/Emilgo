// Naija World's plan (src/maps/open/naija.ts): the same city from the same
// seed, every landmark and place in it and reachable on foot, the starts on
// open ground, and bodies that run about it for a minute without ever ending
// up inside a wall or off the world.
//
//   node server/build-tools.mjs && node server/dist/worldtest.mjs

import { DEFAULT_COURSE } from "../../src/config";
import { freshMotion, moveContestant, type Contestant } from "../../src/game/core/body";
import { HEAD, Space, STEP } from "../../src/game/core/space";
import { buildNaijaWorld, SURFACE_OF } from "../../src/maps/open/naija";
import { NO_BOOST } from "../../src/shop/boosts";
import { Rng } from "../../src/core/rng";

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures++;
}

const t0 = performance.now();
const w = buildNaijaWorld();
const ms = performance.now() - t0;
const space = new Space(w.solids, { x0: -w.half, z0: -w.half, x1: w.half, z1: w.half }, (x, z) => SURFACE_OF[w.groundAt(x, z)]);
const ms2 = performance.now() - t0;

console.log("the plan:");
console.log(`    ${w.placements.length} placements · ${w.solids.length} solids · ${w.gutters.length} gutter runs · ${w.slabs.length} slabs · built in ${ms.toFixed(0)} ms (+ space ${(ms2 - ms).toFixed(0)} ms)`);
const again = buildNaijaWorld();
check(JSON.stringify(again.solids) === JSON.stringify(w.solids), "the same seed builds the same city, solid for solid");
check(JSON.stringify(buildNaijaWorld(7).placements) !== JSON.stringify(w.placements), "another seed builds another city");
check(w.landmarks.length === 12, `12 landmarks (${w.landmarks.length})`);
check(w.areas.length === 18, `18 places (${w.areas.length})`);
check(ms2 < 400, `built fast enough to do in idle time (${ms2.toFixed(0)} ms < 400)`);
const tallest = Math.max(...w.solids.filter((s) => s.kind === "box" && s.hx > 4 && s.hz > 4).map((s) => s.y1));
check(tallest <= 5 * 3.3 + 0.6, `no skyscrapers: the tallest building is ${tallest.toFixed(1)} m (5 floors at most)`);

// ── On foot: a 1 m grid of where a standing body fits, flooded from the starts ──
console.log("on foot:");
const N = w.half * 2;
const free = new Uint8Array(N * N);
const R = 0.3;
for (let r = 0; r < N; r++) {
  for (let q = 0; q < N; q++) {
    const x = q - w.half + 0.5;
    const z = r - w.half + 0.5;
    const f = space.floorAt(x, z, 0);
    let ok = true;
    for (const i of space.near(x, z, R + 0.1)) {
      const s = space.solids[i];
      if (s.kind === "pit" || s.y0 >= f.h + HEAD[0]) continue;
      const c = Math.cos(s.rot);
      const sn = Math.sin(s.rot);
      const dx = x - s.x;
      const dz = z - s.z;
      const lx = dx * c - dz * sn;
      const lz = dx * sn + dz * c;
      if (Math.abs(lx) > s.hx + R || Math.abs(lz) > s.hz + R) continue;
      const top = s.kind === "ramp" ? Math.max(s.y1, s.y2 ?? s.y1) : s.y1;
      if (top > f.h + STEP) ok = false;
    }
    free[r * N + q] = ok ? 1 : 0;
  }
}
const seen = new Uint8Array(N * N);
const queue: number[] = [];
const cellOf = (x: number, z: number) => Math.floor(z + w.half) * N + Math.floor(x + w.half);
const s0 = w.spawns[0];
queue.push(cellOf(s0[0], s0[1]));
seen[queue[0]] = 1;
for (let h = 0; h < queue.length; h++) {
  const i = queue[h];
  const q = i % N;
  const r = (i / N) | 0;
  for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nq = q + dq;
    const nr = r + dr;
    if (nq < 0 || nr < 0 || nq >= N || nr >= N) continue;
    const j = nr * N + nq;
    if (seen[j] || !free[j]) continue;
    seen[j] = 1;
    queue.push(j);
  }
}
let freeCount = 0;
for (const f of free) freeCount += f;
const reach = queue.length / freeCount;
check(reach > 0.93, `${(reach * 100).toFixed(1)}% of the open ground is reachable on foot from the first start`);
const near = (x: number, z: number, r: number): boolean => {
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const qx = Math.floor(x + dx + w.half);
    const qz = Math.floor(z + dz + w.half);
    if (qx >= 0 && qz >= 0 && qx < N && qz < N && seen[qz * N + qx]) return true;
  }
  return false;
};
const lost = [...w.landmarks.map((l) => ({ name: l.name, x: l.x, z: l.z, r: 18 })), ...w.areas.map((a) => ({ name: a.name, x: a.x, z: a.z, r: Math.ceil(a.r) + 4 }))].filter((p) => !near(p.x, p.z, p.r));
check(lost.length === 0, `every landmark and place can be walked to${lost.length ? ` (not: ${lost.map((l) => l.name).join(", ")})` : ""}`);
check(w.spawns.length >= 12, `${w.spawns.length} starts (12 players need 12)`);
const badSpawn = w.spawns.filter(([x, z]) => !seen[cellOf(x, z)]);
check(badSpawn.length === 0, `every start is on open ground joined to the rest${badSpawn.length ? ` (${badSpawn.length} not)` : ""}`);
let minGap = Infinity;
for (let i = 0; i < w.spawns.length; i++) for (let j = i + 1; j < w.spawns.length; j++) minGap = Math.min(minGap, Math.hypot(w.spawns[i][0] - w.spawns[j][0], w.spawns[i][1] - w.spawns[j][1]));
check(minGap >= 40, `starts at least 40 m apart (${minGap.toFixed(0)} m)`);

// ── A minute of running about: 24 bodies, random sticks, jumps and stances ──
console.log("a minute of running about:");
const rng = new Rng(42);
const bodies: Contestant[] = w.spawns.slice(0, 24).map(([x, z], i) => ({
  id: `b${i}`, name: "B", bot: false, index: i, x, z, vx: 0, vz: 0, heading: 0, status: "alive", finishTime: -1, place: 0,
  eliminatedAt: -1, cause: null, inX: 0, inZ: 0, progress: 0, graceBonus: 0, ...freshMotion(), bst: NO_BOOST,
}));
let inside = 0;
let off = 0;
let nan = 0;
let steps = 0;
const tm = performance.now();
for (let f = 0; f < 60 * 60; f++) {
  for (const c of bodies) {
    if (f % 90 === 0) {
      const a = rng.range(0, Math.PI * 2);
      c.inX = Math.cos(a);
      c.inZ = Math.sin(a);
      c.inSprint = rng.chance(0.5);
      c.inStance = rng.chance(0.15) ? 2 : rng.chance(0.2) ? 1 : 0;
    }
    if (rng.chance(0.01)) c.inJump = (c.inJump + 1) & 255;
    moveContestant(c, 1 / 60, DEFAULT_COURSE, space);
    steps++;
    if (!Number.isFinite(c.x + c.z + c.h + c.y)) nan++;
    if (Math.abs(c.x) > w.half || Math.abs(c.z) > w.half) off++;
    // Inside a wall: the centre deep in a solid that rises past the feet.
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
}
const per = ((performance.now() - tm) * 1000) / steps;
check(nan === 0, "no body's position ever breaks");
check(off === 0, "nobody leaves the world");
check(inside === 0, `nobody ends up inside a wall (${inside} of ${steps} steps)`);
check(per < 25, `a body's step costs ${per.toFixed(1)} µs (12 players × 60 Hz is well under 1 ms)`);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
