// The referee's new moves (protocol 3), checked directly — no server, no network.
//
//   node server/build-tools.mjs && node server/dist/rulestest.mjs
//
// What must hold:
//   - speeds: walk 2, run 6, sprint 9, crouch 1.5, prone 0.5 m/s
//   - a jump reaches ~1.2 m and lands; you can't jump crouched or in the air
//   - sprint spends stamina and stops when it's gone; it refills after a rest
//   - while she watches: a jump, or getting up/down, counts as moving (caught);
//     holding a crouch or lying still is safe
//   - stance changes one step at a time (prone ↔ crouch ↔ stand)

import { MOVE, RULES } from "../../src/config";
import { RedLightRound, freshMotion, isMoving, moveContestant, type Contestant } from "../../src/game/rules";

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures++;
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const DT = 1 / 60;

function runner(): Contestant {
  return {
    id: "t", name: "T", bot: false, index: 0, x: 0, z: 0, vx: 0, vz: 0, heading: Math.PI, status: "alive",
    finishTime: -1, place: 0, eliminatedAt: -1, cause: null, inX: 0, inZ: 0, progress: 0, graceBonus: 0, ...freshMotion(),
  };
}
function steps(c: Contestant, seconds: number, each?: () => void): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    each?.();
    moveContestant(c, DT);
  }
}
const speed = (c: Contestant) => Math.hypot(c.vx, c.vz);

console.log("speeds:");
{
  const c = runner();
  c.inZ = -MOVE.runAt * 0.5; // a small push
  steps(c, 1);
  check(near(speed(c), MOVE.walk * 0.5, 0.05), `half a walk push → ${speed(c).toFixed(2)} m/s`);
  c.inZ = -1;
  steps(c, 1);
  check(near(speed(c), MOVE.run, 0.05), `full push runs → ${speed(c).toFixed(2)} m/s`);
  c.inSprint = true;
  steps(c, 0.8);
  check(near(speed(c), MOVE.sprint, 0.05) && c.sprinting, `sprint → ${speed(c).toFixed(2)} m/s`);
  c.inSprint = false;
  c.inStance = 1;
  steps(c, 1);
  check(c.stance === 1 && near(speed(c), MOVE.crouch, 0.05), `crouched → ${speed(c).toFixed(2)} m/s`);
  c.inStance = 2;
  steps(c, 1);
  check(c.stance === 2 && near(speed(c), MOVE.prone, 0.05), `prone → ${speed(c).toFixed(2)} m/s`);
  c.inSprint = true;
  steps(c, 0.5);
  check(!c.sprinting && speed(c) <= MOVE.prone + 0.01, "no sprinting while lying down");
}

console.log("\njump:");
{
  const c = runner();
  let top = 0;
  c.inJump = 1;
  steps(c, 1.2, () => (top = Math.max(top, c.y)));
  check(near(top, MOVE.jumpHeight, 0.05), `peak ${top.toFixed(2)} m`);
  check(c.y === 0 && c.vy === 0, "lands and stops");
  c.inJump = 2;
  steps(c, 0.1);
  const mid = c.y;
  c.inJump = 3; // a second press in the air
  steps(c, 1.2, () => (top = Math.max(top, c.y)));
  check(mid > 0 && c.y === 0, "a press in the air is ignored (no double jump)");
  c.inStance = 1;
  steps(c, 0.5);
  c.inJump = 4;
  steps(c, 0.3);
  check(c.y === 0, "no jumping while crouched");
}

console.log("\nstamina:");
{
  const c = runner();
  c.inZ = -1;
  c.inSprint = true;
  let sprinted = 0;
  steps(c, MOVE.sprintFor + 1, () => c.sprinting && (sprinted += DT));
  check(near(sprinted, MOVE.sprintFor, 0.15), `sprints for ${sprinted.toFixed(2)} s on a full bar`);
  console.log(`    (stamina ${c.stamina.toFixed(3)}, sprinting ${c.sprinting}, speed ${speed(c).toFixed(2)}, rested ${c.rested.toFixed(2)})`);
  check(c.stamina < MOVE.sprintMin && !c.sprinting && near(speed(c), MOVE.run, 0.05), "then drops back to a run");
  c.inSprint = false;
  steps(c, MOVE.refillDelay + MOVE.refillIn + 0.1);
  check(c.stamina === 1, "refills after a rest");
}

console.log("\nstance steps:");
{
  const c = runner();
  c.inStance = 2;
  moveContestant(c, DT);
  check(c.stance === 1, "stand → prone goes through crouch first");
  steps(c, MOVE.stanceTime * 2 + 0.05);
  check(c.stance === 2 && c.stanceT === 0, "…then lies down");
  c.inStance = 0;
  moveContestant(c, DT);
  check(c.stance === 1 && isMoving(c), "getting up counts as moving while it happens");
  steps(c, MOVE.stanceTime * 2 + 0.1);
  check(c.stance === 0 && !isMoving(c), "standing again, still");
}

console.log("\nwhile she watches:");
{
  // A round with one contestant, stepped to the stare.
  const make = () => {
    const r = new RedLightRound({ seed: 7, contestants: [{ id: "a", name: "A", bot: false }] });
    let guard = 0;
    while (r.phase !== "watch" && guard++ < 60 * 60) r.step(DT);
    while (r.phaseTime < RULES.grace + 0.05) r.step(DT);
    return r;
  };
  let r = make();
  r.setButtons("a", false, 0, 1);
  for (let i = 0; i < 10; i++) r.step(DT);
  check(r.get("a")!.status === "eliminated", "jumping → caught");
  r = make();
  r.setButtons("a", false, 1, 0);
  for (let i = 0; i < 10; i++) r.step(DT);
  check(r.get("a")!.status === "eliminated", "ducking down → caught");
  // Crouched BEFORE she turned, and holding it: safe.
  const r2 = new RedLightRound({ seed: 7, contestants: [{ id: "a", name: "A", bot: false }] });
  r2.setButtons("a", false, 1, 0);
  let guard = 0;
  while (r2.phase !== "watch" && guard++ < 60 * 60) r2.step(DT);
  for (let i = 0; i < 60; i++) r2.step(DT);
  check(r2.get("a")!.status === "alive" && r2.get("a")!.stance === 1, "holding a crouch through the stare → safe");
}

console.log("\nspawns:");
for (const n of [2, 3, 4, 7, 12]) {
  const r = new RedLightRound({ seed: 12345 + n, contestants: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, bot: false })) });
  let closest = Infinity;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) closest = Math.min(closest, Math.hypot(r.contestants[i].x - r.contestants[j].x, r.contestants[i].z - r.contestants[j].z));
  check(closest > MOVE.radius * 2, `${n} players, nobody starts on anyone (closest ${closest.toFixed(1)} m)`);
}

console.log(`\n${failures ? `${failures} FAILED` : "all passed"}`);
process.exit(failures ? 1 : 0);
