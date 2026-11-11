// Horde Dash's rules (v6 max, 3.1), offline: every course can be run to the
// gate (an autopilot does it on many seeds), the moves do what they say, the
// horde catches the careless, the power-ups work, the pay adds up.
//
//   npx tsx server/scripts/dashtest.ts

import { buildCourse, DASH, dashCp, laneX, newDash, stepDash, type Course, type Dash, type DashInput } from "../../src/game/runner/dash";

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures++;
}
const DT = 1 / 60;
const none: DashInput = { left: false, right: false, jump: false, slide: false };

/** A careful runner: looks 10 m ahead, goes round buses, jumps barriers, slides under gantries. */
function autopilot(d: Dash, c: Course): DashInput {
  const inp = { ...none };
  const ahead = (lane: number, from: number, to: number) => c.obs.filter((o) => !o.gone && o.lane === lane && o.z + o.len > d.z + from && o.z < d.z + to);
  const mine = ahead(d.lane, -0.5, 14);
  const bus = mine.find((o) => o.kind === "bus");
  if (bus && d.laneT >= 1) {
    // The nearest lane with no bus coming (two lanes over if need be: one change at a time).
    const free = [0, 1, 2].filter((l) => l !== d.lane && !ahead(l, -10, 18).some((o) => o.kind === "bus")).sort((a, b) => Math.abs(a - d.lane) - Math.abs(b - d.lane));
    if (free.length) (free[0] < d.lane ? (inp.left = true) : (inp.right = true));
  }
  const near = mine.find((o) => o.kind !== "bus" && o.z - d.z < d.speed * 0.2 + 0.6 && o.z - d.z > 0);
  if (near?.kind === "gantry" && d.slideT <= 0.05) inp.slide = true;
  if ((near?.kind === "barrier" || near?.kind === "cones") && d.y <= 0.001) inp.jump = true;
  return inp;
}

console.log("courses:");
{
  let finished = 0;
  let worst = Infinity;
  for (let s = 1; s <= 40; s++) {
    const c = buildCourse(s * 7919, 1 + (s % 3));
    // Every row leaves a way through: never a bus in all three lanes at once.
    for (const o of c.obs) {
      if (o.kind !== "bus") continue;
      const lanes = new Set(c.obs.filter((p) => p.kind === "bus" && Math.abs(p.z - o.z) < 1).map((p) => p.lane));
      if (lanes.size >= 3) worst = -1;
    }
    const d = newDash();
    for (let k = 0; k < 60 * 400 && !d.done; k++) stepDash(d, c, DT, autopilot(d, c));
    if (d.done === "finish") finished++;
    worst = Math.min(worst, d.gap);
  }
  check(worst >= 0, "no row closes all three lanes with buses");
  check(finished >= 38, `a careful runner reaches the Safe Gate on ${finished} of 40 courses (levels 1–3)`);
  const c = buildCourse(1234);
  check(c.length === DASH.length && c.coins.length > 100 && c.pows.length >= 2, `a course: ${c.length} m, ${c.coins.length} Owo, ${c.pows.length} power-ups, ${c.obs.length} obstacles`);
  check(JSON.stringify(buildCourse(1234)) === JSON.stringify(c), "the same seed, the same course");
}

console.log("\nmoves:");
{
  const c: Course = { seed: 0, length: 500, obs: [], coins: [], pows: [] };
  const d = newDash();
  stepDash(d, c, DT, { ...none, left: true });
  for (let k = 0; k < 20; k++) stepDash(d, c, DT, none);
  check(d.lane === 0 && Math.abs(d.x - laneX(0)) < 1e-6, "left: one lane over, in a fifth of a second");
  stepDash(d, c, DT, { ...none, jump: true });
  let top = 0;
  for (let k = 0; k < 60 && (d.y > 0 || k < 2); k++) {
    stepDash(d, c, DT, none);
    top = Math.max(top, d.y);
  }
  check(top > 1.7 && top < 2.0 && d.y === 0, `a jump: ${top.toFixed(2)} m up and down again`);
  stepDash(d, c, DT, { ...none, slide: true });
  check(d.slideT > 0, "down: a slide");
  const s0 = d.speed;
  for (let k = 0; k < 600; k++) stepDash(d, c, DT, none);
  check(d.speed > s0 && d.speed <= DASH.speedMax, `faster and faster (${s0.toFixed(1)} → ${d.speed.toFixed(1)} m/s)`);
}

console.log("\nthe horde and the obstacles:");
{
  const bus: Course = { seed: 0, length: 500, obs: [{ kind: "bus", lane: 1, z: 20, len: 9 }], coins: [], pows: [] };
  const d = newDash();
  for (let k = 0; k < 600 && !d.done; k++) stepDash(d, bus, DT, none);
  check(d.done === "caught" && d.events.some((e) => e.type === "caught" && e.how === "bus"), "into a bus's front: the horde has you");
  const bars: Course = { seed: 0, length: 900, obs: [20, 60, 100].map((z) => ({ kind: "barrier" as const, lane: 1, z, len: 0.5 })), coins: [], pows: [] };
  const e = newDash();
  for (let k = 0; k < 60 * 30 && !e.done; k++) stepDash(e, bars, DT, none);
  check(e.done === "caught" && e.events.filter((x) => x.type === "stumble").length >= 2, `stumbling over barriers: the horde catches up (${e.events.filter((x) => x.type === "stumble").length} stumbles)`);
  const g: Course = { seed: 0, length: 200, obs: [{ kind: "gantry", lane: 1, z: 20, len: 0.6 }], coins: [], pows: [] };
  const f = newDash();
  for (let k = 0; k < 60 * 40 && !f.done; k++) stepDash(f, g, DT, { ...none, slide: f.z > 15 && f.z < 15.3 });
  check(!f.events.some((x) => x.type === "stumble") && f.done === "finish", "under a gantry on a slide: clean, and on to the gate");
  const side: Course = { seed: 0, length: 300, obs: [{ kind: "bus", lane: 0, z: 10, len: 30 }], coins: [], pows: [] };
  const s = newDash();
  for (let k = 0; k < 60; k++) stepDash(s, side, DT, none);
  stepDash(s, side, DT, { ...none, left: true });
  for (let k = 0; k < 30; k++) stepDash(s, side, DT, none);
  check(s.lane === 1 && s.events.some((x) => x.type === "stumble" && x.kind === "side"), "into a bus's side: bounced back, a stumble");
}

console.log("\npower-ups:");
{
  const c: Course = { seed: 0, length: 400, obs: [{ kind: "bus", lane: 1, z: 30, len: 9 }], coins: [], pows: [{ kind: "shield", lane: 1, z: 10, taken: false }] };
  const d = newDash();
  for (let k = 0; k < 60 * 40 && !d.done; k++) stepDash(d, c, DT, none);
  check(d.done === "finish" && d.events.some((e) => e.type === "shield" && e.kind === "bus"), "a shield shoves a bus aside (once)");
  const j: Course = { seed: 0, length: 300, obs: [{ kind: "bus", lane: 1, z: 40, len: 9 }, { kind: "gantry", lane: 1, z: 60, len: 0.6 }], coins: [], pows: [{ kind: "jet", lane: 1, z: 10, taken: false }] };
  const e = newDash();
  let high = 0;
  for (let k = 0; k < 60 * 30 && !e.done; k++) {
    stepDash(e, j, DT, none);
    high = Math.max(high, e.y);
  }
  const sky = j.coins.filter((k) => k.y > 5 && k.taken).length;
  check(e.done === "finish" && high > DASH.jetH - 0.3 && sky > 10, `the jet pack: ${high.toFixed(1)} m up, over the bus and the gantry, ${sky} sky coins`);
  const m: Course = { seed: 0, length: 200, obs: [], coins: [0, 2].map((lane) => ({ lane, z: 40, y: 0.9, taken: false })), pows: [{ kind: "magnet", lane: 1, z: 10, taken: false }] };
  const g = newDash();
  for (let k = 0; k < 60 * 6; k++) stepDash(g, m, DT, none);
  check(g.coins === 2, "the magnet pulls in the coins in the other lanes");
}

console.log("\nCP:");
{
  const p = dashCp({ done: "finish", coins: 230, t: 70 }, 1000);
  check(p.cp === 30 + 23 + 10, `the gate 30, 230 Owo 23, a quick time 10: ${p.cp} CP`);
  check(dashCp({ done: "caught", coins: 5, t: 20 }, 1000).cp === 0, "caught early with nothing: nothing");
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
