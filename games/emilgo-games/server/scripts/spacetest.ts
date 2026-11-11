// The open worlds' ground and walls (src/game/core/space.ts), driven through
// the real movement kernel at 60 Hz, as the referee will drive it.
//
//   node server/build-tools.mjs && node server/dist/spacetest.mjs

import { DEFAULT_COURSE } from "../../src/config";
import { freshMotion, moveContestant, type Contestant } from "../../src/game/core/body";
import { Space, SWIM_FLOAT, type Solid } from "../../src/game/core/space";
import { NO_BOOST } from "../../src/shop/boosts";

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures++;
}

function body(x: number, z: number): Contestant {
  return {
    id: "a", name: "A", bot: false, index: 0, x, z, vx: 0, vz: 0, heading: 0, status: "alive", finishTime: -1, place: 0,
    eliminatedAt: -1, cause: null, inX: 0, inZ: 0, progress: 0, graceBonus: 0, ...freshMotion(), bst: NO_BOOST,
  };
}

/** Hold the stick (world direction) for `s` seconds. */
function run(c: Contestant, sp: Space, ix: number, iz: number, s: number, opts: { jumpAt?: number; stance?: 0 | 1 | 2 } = {}): void {
  c.inX = ix;
  c.inZ = iz;
  if (opts.stance !== undefined) c.inStance = opts.stance;
  for (let t = 0; t < s; t += 1 / 60) {
    if (opts.jumpAt !== undefined && Math.abs(t - opts.jumpAt) < 1 / 120) c.inJump = (c.inJump + 1) & 255;
    moveContestant(c, 1 / 60, DEFAULT_COURSE, sp);
  }
  c.inX = c.inZ = 0;
  for (let t = 0; t < 0.6; t += 1 / 60) moveContestant(c, 1 / 60, DEFAULT_COURSE, sp);
}

const B = { x0: -60, z0: -60, x1: 60, z1: 60 };
const box = (x: number, z: number, hx: number, hz: number, y0: number, y1: number, rot = 0): Solid => ({ x, z, hx, hz, rot, y0, y1, kind: "box", surface: "concrete" });

console.log("walls:");
{
  const sp = new Space([box(0, -10, 6, 1, 0, 3)], B);
  const c = body(0, 0);
  run(c, sp, 0, -1, 3);
  check(c.z > -10 + 1 + 0.3 && c.z < -10 + 1 + 0.4, `a wall stops you (z ${c.z.toFixed(2)})`);
  const d = body(-3, -7.5);
  run(d, sp, 0.6, -0.8, 1);
  check(d.z > -8.7 && d.x > -1, `you slide along it (x ${d.x.toFixed(1)}, z ${d.z.toFixed(2)})`);
  const r = new Space([box(0, -10, 6, 1, 0, 3, Math.PI / 4)], B);
  const e = body(0, 0);
  run(e, r, 0, -1, 3);
  const lx = e.x * Math.cos(Math.PI / 4) - (e.z + 10) * Math.sin(Math.PI / 4);
  const lz = e.x * Math.sin(Math.PI / 4) + (e.z + 10) * Math.cos(Math.PI / 4);
  check(!(Math.abs(lx) < 6 && Math.abs(lz) < 1), "a turned wall stops you too");
}

console.log("\nsteps, stairs and roofs:");
{
  // A kerb, a building with stairs up its side to the roof.
  const solids: Solid[] = [
    box(0, -5, 10, 1, 0, 0.18),
    box(0, -20, 4, 4, 0, 3.2),
    // Rising towards −z (y1 is the top at its −hz end): up beside the wall to the roof's edge.
    { x: 4.6, z: -14, hx: 0.6, hz: 4, rot: 0, y0: 0, y1: 3.2, y2: 0, kind: "ramp", surface: "concrete" },
  ];
  const sp = new Space(solids, B);
  const c = body(0, 0);
  run(c, sp, 0, -1, 0.9);
  check(c.h === 0.18 && c.y === 0, "a kerb is a step up, not a wall");
  const s = body(4.6, -9);
  // Walk up until near the top (the flight is 8 m long).
  s.inZ = -0.5;
  for (let t = 0; t < 6 && s.h < 2.9; t += 1 / 60) moveContestant(s, 1 / 60, DEFAULT_COURSE, sp);
  s.inZ = 0;
  check(s.h > 2.9 && s.y < 0.05, `the stairs take you up (${s.h.toFixed(2)} m, on your feet)`);
  run(s, sp, -1, 0, 0.6);
  check(Math.abs(s.h - 3.2) < 1e-6 && s.y === 0, "onto the roof");
  run(s, sp, -1, 0, 2.5);
  check(s.h === 0 && s.y === 0 && s.x < -4, `walk off the edge: you fall and land (x ${s.x.toFixed(1)})`);
  const w = body(-6, -20);
  run(w, sp, 1, 0, 1.5);
  check(w.h === 0 && w.x < -4.3, "from the ground, the building is a wall");
}

console.log("\ngutters:");
{
  // A gutter along z: a pit 0.9 deep, its two walls flush with the street.
  const solids: Solid[] = [
    { x: 0, z: 0, hx: 0.4, hz: 20, rot: 0, y0: -0.9, y1: -0.9, kind: "pit", surface: "concrete", water: -0.75 },
    box(-0.48, 0, 0.08, 20, -0.9, 0),
    box(0.48, 0, 0.08, 20, -0.9, 0),
    { x: 0, z: 10, hx: 0.6, hz: 1, rot: 0, y0: -0.3, y1: 0, kind: "box", surface: "concrete" },
  ];
  const sp = new Space(solids, B);
  const c = body(-1.5, 0);
  run(c, sp, 0.3, 0, 2);
  check(Math.abs(c.h + 0.9) < 1e-6, "walk into it: you drop in");
  run(c, sp, 1, 0, 1.5);
  check(Math.abs(c.h + 0.9) < 1e-6 && Math.abs(c.x) < 0.2, "you can't walk out");
  const sprinter = body(-4, 0);
  sprinter.inSprint = true;
  run(sprinter, sp, 1, 0, 1.2);
  check(sprinter.h === 0 && sprinter.x > 2, "at a sprint you clear it");
  run(c, sp, 1, 0, 0.6, { jumpAt: 0.05 });
  check(c.h === 0 && c.x > 0.5, "a jump gets you out");
  const s = body(-3, 10);
  run(s, sp, 1, 0, 1.5);
  check(s.h === 0 && s.x > 2, "the slab over it carries you across");
}

console.log("\nunder things:");
{
  // A collapsed slab 0.7 m up: crawl under it; a bridge deck 3 m up: walk under it.
  const solids: Solid[] = [box(0, -6, 3, 2, 0.7, 1.0), box(10, -6, 3, 2, 3, 3.3)];
  const sp = new Space(solids, B);
  const st = body(0, 0);
  run(st, sp, 0, -1, 2);
  check(st.z > -3.8, "standing, the low slab stops you");
  const pr = body(0, -2.5);
  for (let t = 0; t < 1; t += 1 / 60) {
    pr.inStance = 2;
    moveContestant(pr, 1 / 60, DEFAULT_COURSE, sp);
  }
  run(pr, sp, 0, -1, 14, { stance: 2 });
  check(pr.z < -8.5, `prone, you crawl under it (z ${pr.z.toFixed(1)})`);
  const br = body(10, 0);
  run(br, sp, 0, -1, 2);
  check(br.z < -8 && br.h === 0, "under a high deck you just walk");
}

console.log("\nwater and the edge:");
{
  const river: Solid = { x: 0, z: -15, hx: 30, hz: 5, rot: 0, y0: -1, y1: -1, kind: "pit", surface: "sand", water: -0.3 };
  const sp = new Space([river], B);
  const c = body(0, -12);
  c.inSprint = true;
  c.inX = 0;
  c.inZ = -1;
  let fastest = 0;
  for (let t = 0; t < 1.2; t += 1 / 60) {
    moveContestant(c, 1 / 60, DEFAULT_COURSE, sp);
    if (c.y === 0 && c.h === -1) fastest = Math.max(fastest, Math.hypot(c.vx, c.vz));
  }
  check(fastest > 0 && fastest <= 2.2 + 1e-6, `deep water: a wade, never a sprint (${fastest.toFixed(2)} m/s)`);
  check(sp.surfaceAt(0, -15, -1) === "puddle", "and it splashes underfoot");
  const e = body(55, 0);
  run(e, sp, 1, 0, 3);
  check(e.x <= 60 - 0.34 + 1e-9, "nobody leaves the world");
  // v6 max (3.5): deep water: you swim, floating at the surface, at a swimmer's pace, no jump; and climb out.
  const deep: Solid = { x: 0, z: -15, hx: 30, hz: 5, rot: 0, y0: -3, y1: -3, kind: "pit", surface: "sand", water: -0.4 };
  const sp2 = new Space([deep], B);
  const s = body(0, -12);
  s.inSprint = true;
  s.inZ = -1;
  let top = 0;
  let jumped = false;
  for (let t = 0; t < 2.5; t += 1 / 60) {
    if (Math.abs(t - 2) < 1 / 120) s.inJump = (s.inJump + 1) & 255;
    moveContestant(s, 1 / 60, DEFAULT_COURSE, sp2);
    if (s.swim) top = Math.max(top, Math.hypot(s.vx, s.vz));
    if (t > 2 && s.y > 0.05) jumped = true;
  }
  check(s.swim && Math.abs(s.h - (-0.4 - SWIM_FLOAT)) < 1e-6, `deep water: swimming, floating at the surface (feet ${s.h.toFixed(2)} m)`);
  check(top > 0 && top <= 2.8 + 1e-6, `a swimmer's pace (${top.toFixed(2)} m/s)`);
  check(!jumped, "no jumping while swimming");
  check(sp2.surfaceAt(0, -15, s.h) === "water", "and it's water underfoot");
  run(s, sp2, 0, 1, 4);
  check(!s.swim && s.h === 0 && s.z > -9.5, "swim to the bank and climb out");
}

console.log("\nthe field is unchanged:");
{
  // No Space: the corridor rules, exactly as before (h stays 0).
  const c = body(0, 0);
  c.inZ = -1;
  for (let t = 0; t < 2; t += 1 / 60) moveContestant(c, 1 / 60);
  check(c.h === 0 && c.z < -8, "Red Light, Green Light bodies never leave the floor");
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
