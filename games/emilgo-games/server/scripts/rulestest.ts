// The referee, checked directly — no server, no network. Protocol 3's moves
// (jump, crouch, prone, sprint) and protocol 4's modes, distances, balls,
// attacks and shoves (SPEC-V2 §2).
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

import { ATTACK, BALLS, DISTANCES, FINAL, FLOW, MOVE, RULES, TIME_LIMIT, ballCount, courseFor, walkoutLength, type Course } from "../../src/config";
import { Rng } from "../../src/core/rng";
import { BotBrain } from "../../src/game/bots";
import { Highlights, type Moment } from "../../src/game/highlights";
import { PEN, openLane, penAt } from "../../src/game/pens";
import { fieldHalfWidth, mapOf } from "../../src/maps/registry";
import { RedLightRound, freshMotion, isMoving, moveContestant, setBoosts, type Contestant, type RoundEvent } from "../../src/game/rules";
import { BOOSTS, BOOST_SLOTS, NO_BOOST, boostsFromWire, boostsToWire, modsOf } from "../../src/shop/boosts";
import { TutorialScript, tutorialPeople, tutorialSteps } from "../../src/rlgl/tutorial";

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

console.log("\nspawns, a full field:");
for (const n of [16, 20]) {
  const r = new RedLightRound({ seed: 777 + n, contestants: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, bot: false })) });
  let closest = Infinity;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) closest = Math.min(closest, Math.hypot(r.contestants[i].x - r.contestants[j].x, r.contestants[i].z - r.contestants[j].z));
  check(closest > MOVE.radius * 2, `${n} players, nobody starts on anyone (closest ${closest.toFixed(1)} m)`);
}

// ── Protocol 4 ──────────────────────────────────────────────────────────────

console.log("\ndistances:");
for (const d of DISTANCES) {
  const c = courseFor("classic", d);
  check(c.finishZ === -d && c.timeLimit === TIME_LIMIT[d] && c.dollZ < c.safeZ && c.safeZ < c.finishZ, `${d} m: line at ${c.finishZ}, ${c.timeLimit} s, doll beyond the safe zone`);
}
{
  const r = new RedLightRound({ seed: 3, contestants: [{ id: "a", name: "A", bot: false }], course: courseFor("classic", 100) });
  let guard = 0;
  while (!r.over && guard++ < 60 * 200) r.step(DT);
  check(r.get("a")!.cause === "time" && near(r.elapsed, 45, 0.05), `100 m: standing still, time runs out at ${r.elapsed.toFixed(2)} s`);
}

console.log("\nballs:");
check(ballCount(20) === 13 && ballCount(4) === 3 && ballCount(2) === 1 && ballCount(3) === 2, `ball counts: 20→${ballCount(20)}, 4→${ballCount(4)}, 3→${ballCount(3)}, 2→${ballCount(2)}`);

const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, bot: false }));

/** A Ball Haunting round, past the countdown, everyone placed by hand. */
function ballRound(n: number, place: [number, number][], course: Course = courseFor("balls", 100)): { r: RedLightRound; ev: RoundEvent[] } {
  const r = new RedLightRound({ seed: 99, contestants: people(n), course });
  while (r.phase === "countdown") r.step(DT);
  r.contestants.forEach((c, i) => {
    c.x = place[i][0];
    c.z = place[i][1];
    c.vx = c.vz = 0;
  });
  return { r, ev: r.drain() };
}
const tick = (r: RedLightRound, seconds: number, ev?: RoundEvent[]) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    r.step(DT);
    ev?.push(...r.drain());
  }
};
const singing = (r: RedLightRound) => {
  r.phase = "sing";
  r.phaseTime = 0;
  r.phaseDuration = 999;
};

{
  const r = new RedLightRound({ seed: 5, contestants: people(20), course: courseFor("balls", 200) });
  const c = r.course;
  const okPlace = r.balls.every((b) => Math.abs(b.x) < c.halfWidth && b.z < 0 && b.z > c.finishZ);
  let closest = Infinity;
  for (const a of r.balls) for (const b of r.balls) if (a !== b) closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
  check(r.balls.length === 13 && okPlace && closest > 2, `20 players: 13 balls on the field, ${closest.toFixed(1)} m apart at least`);
  check(r.baskets.length === BALLS.baskets && r.baskets.every((k) => k.z < c.finishZ), `${r.baskets.length} baskets just past the line`);
  const classic = new RedLightRound({ seed: 5, contestants: people(20), course: courseFor("classic", 200) });
  check(classic.balls.length === 0 && classic.contestants.every((p, i) => p.x === r.contestants[i].x), "Classic Run: no balls, same spawns");
}

{
  const { r } = ballRound(2, [[0, -20], [6, -20]]);
  singing(r);
  const b = r.balls[0];
  b.x = 0.4;
  b.z = -20.5;
  r.setActions("p1", 0, 1); // too far away
  tick(r, 0.05);
  check(r.get("p1")!.ball === -1, "grab from 6 m: nothing");
  r.setActions("p0", 0, 1);
  tick(r, 0.05);
  check(r.get("p0")!.ball === b.index && b.holder === 0, "grab within reach: holding it");
  r.get("p0")!.inZ = -1;
  tick(r, 0.5);
  check(Math.hypot(b.x - r.get("p0")!.x, b.z - r.get("p0")!.z) < 1e-6, "the ball moves with its holder");
}

console.log("\nattacks:");
{
  // p0 holds a ball; p1 pushes them from 1.5 m; p2 stands by.
  const { r } = ballRound(3, [[0, -20], [0, -18.5], [3, -20]]);
  singing(r);
  const b = r.balls[0];
  b.x = 0;
  b.z = -20;
  r.setActions("p0", 0, 1);
  tick(r, 0.05);
  const ev: RoundEvent[] = [];
  const z0 = r.get("p0")!.z;
  r.setActions("p1", (1 << 2) | 3, 0); // push
  tick(r, 1, ev);
  const hit = ev.find((e) => e.type === "attack");
  check(hit?.type === "attack" && hit.target === "p0" && hit.dropped === b.index, "push lands within 2 m and knocks the ball loose");
  check(near(r.get("p0")!.z - z0, -ATTACK.kinds.push.knock, 0.3), `the target slides ${(z0 - r.get("p0")!.z).toFixed(2)} m`);
  check(b.holder === -1 && r.get("p0")!.ball === -1, "the ball is free");
  // The attacker can't take it back for 3 s; somebody else can.
  const p1 = r.get("p1")!;
  p1.x = b.x;
  p1.z = b.z + 0.5;
  r.setActions("p1", (1 << 2) | 3, 1);
  tick(r, 0.05);
  check(p1.ball === -1, "the attacker can't grab it straight away");
  const p2 = r.get("p2")!;
  p2.x = b.x + 0.6;
  p2.z = b.z;
  r.setActions("p2", 0, 1);
  tick(r, 0.05);
  check(p2.ball === b.index, "anyone else can");
}
{
  const { r } = ballRound(2, [[0, -20], [0, -17]]);
  singing(r);
  const ev: RoundEvent[] = [];
  r.setActions("p1", (1 << 2) | 1, 0); // fist from 3 m
  tick(r, 0.1, ev);
  const a = ev.find((e) => e.type === "attack");
  check(a?.type === "attack" && a.target === null, "fist from 3 m: a miss");
  r.get("p1")!.z = -18.6;
  r.setActions("p1", (2 << 2) | 1, 0); // again at once: still cooling down
  tick(r, 0.1, ev);
  check(ev.filter((e) => e.type === "attack").length === 1, `fist twice inside ${ATTACK.kinds.fist.cooldown} s: the second is ignored`);
  tick(r, ATTACK.kinds.fist.cooldown);
  r.setActions("p1", (3 << 2) | 1, 0);
  tick(r, 0.1, ev);
  const last = ev.filter((e) => e.type === "attack").pop();
  check(last?.type === "attack" && last.target === "p0", "after the cooldown it lands");
}
{
  // While she watches: the attacker is shot; the one hit is forgiven.
  const r = new RedLightRound({ seed: 7, contestants: people(2), course: courseFor("balls", 100) });
  let guard = 0;
  while (r.phase !== "watch" && guard++ < 60 * 60) r.step(DT);
  while (r.phaseTime < RULES.grace + 0.05) r.step(DT);
  const [a, b] = r.contestants;
  a.x = 0;
  a.z = -10;
  b.x = 0;
  b.z = -11.2;
  r.setActions("p0", (1 << 2) | 3, 0);
  for (let i = 0; i < 20; i++) r.step(DT);
  check(a.status === "eliminated" && a.cause === "moved", "attacking while she watches → the attacker is caught");
  check(b.status === "alive", "the one pushed slid, and is forgiven");
}
{
  // Safe players can't be attacked.
  const { r } = ballRound(2, [[0, -20], [0, -18.8]], courseFor("classic", 100));
  singing(r);
  const p0 = r.get("p0")!;
  p0.status = "finished";
  const ev: RoundEvent[] = [];
  r.setActions("p1", (1 << 2) | 2, 0);
  tick(r, 0.1, ev);
  const a = ev.find((e) => e.type === "attack");
  check(a?.type === "attack" && a.target === null, "a player past the line can't be attacked");
}

console.log("\nthe line, in Ball Haunting:");
{
  const { r } = ballRound(3, [[0, -97], [3, -97], [-3, -60]]);
  singing(r);
  const b = r.balls[0];
  b.x = 0;
  b.z = -97;
  r.setActions("p0", 0, 1);
  tick(r, 0.05);
  r.get("p0")!.inZ = -1;
  r.get("p1")!.inZ = -1;
  const ev: RoundEvent[] = [];
  tick(r, 1.5, ev);
  check(r.get("p0")!.status === "finished" && b.basket >= 0, "across with a ball → safe, the ball in a basket");
  check(r.get("p1")!.status === "alive" && r.get("p1")!.z < -100, "across without one → still in play");
  check(ev.some((e) => e.type === "bank" && e.id === "p0"), "a bank event");
}
{
  // A holder caught by the doll drops the ball.
  const r = new RedLightRound({ seed: 11, contestants: people(2), course: courseFor("balls", 100) });
  while (r.phase === "countdown") r.step(DT);
  const p0 = r.get("p0")!;
  const b = r.balls[0];
  p0.x = b.x;
  p0.z = b.z;
  r.setActions("p0", 0, 1);
  r.step(DT);
  let guard = 0;
  while (r.phase !== "watch" && guard++ < 60 * 60) r.step(DT);
  while (r.phaseTime < RULES.grace + 0.05) r.step(DT);
  p0.inZ = -1;
  for (let i = 0; i < 10; i++) r.step(DT);
  check(p0.status === "eliminated" && b.holder === -1 && b.basket === -1, "a holder caught moving drops the ball where they fall");
}
{
  // Every ball banked → nobody left can make it: the round ends.
  const { r } = ballRound(2, [[0, -97], [3, -60]]);
  singing(r);
  const b = r.balls[0];
  b.x = 0;
  b.z = -97;
  r.setActions("p0", 0, 1);
  tick(r, 0.05);
  r.get("p0")!.inZ = -1;
  tick(r, 1.5);
  check(r.over && r.get("p1")!.cause === "noball", "the last ball banked → the rest are out (no ball left), round over");
}

console.log("\nbodies (no fight without a tap):");
{
  // Sprinting into someone is just a bump: no stagger, no slide, no attack.
  const { r } = ballRound(2, [[0, -20], [0, -24]], courseFor("classic", 100));
  singing(r);
  const [a, b] = r.contestants;
  a.inZ = -1;
  a.inSprint = true;
  b.inZ = -0.3; // the one in front jogs on
  const ev: RoundEvent[] = [];
  let maxStun = 0;
  let maxSpeedB = 0;
  for (let i = 0; i < 72; i++) {
    r.step(DT);
    ev.push(...r.drain());
    maxStun = Math.max(maxStun, a.stun, b.stun);
    maxSpeedB = Math.max(maxSpeedB, Math.hypot(b.vx, b.vz));
  }
  check(!ev.some((e) => e.type === "attack") && maxStun === 0, "sprinting into someone: nobody is staggered, no attack");
  check(maxSpeedB <= MOVE.walk + 0.01, `the one bumped keeps their own pace (top ${maxSpeedB.toFixed(2)} m/s, no slide)`);
  let overlap = 0;
  const x = ballRound(2, [[0, -20], [0, -26]], courseFor("classic", 100));
  singing(x.r);
  x.r.get("p0")!.inZ = -1;
  for (let i = 0; i < 240; i++) {
    x.r.step(DT);
    const [p, q] = x.r.contestants;
    overlap = Math.max(overlap, MOVE.radius * 2 - Math.hypot(p.x - q.x, p.z - q.z));
  }
  check(overlap < 0.05, `nobody runs through anybody (worst overlap ${(overlap * 100).toFixed(1)} cm)`);
}

console.log("\nthe slide:");
{
  const c = runner();
  c.inZ = -1;
  c.inSprint = true;
  steps(c, 1);
  const z0 = c.z;
  c.inStance = 1; // crouch while sprinting
  moveContestant(c, DT);
  check(c.slide > 0 && c.stance === 1 && !c.sprinting, "crouching out of a sprint starts a slide");
  c.inX = 1; // try to steer
  const hx = Math.sign(c.vx);
  steps(c, MOVE.slideTime * 0.5);
  check(Math.sign(c.vx) === hx && isMoving(c), "no steering during a slide, and it counts as moving");
  steps(c, MOVE.slideTime);
  const slid = z0 - c.z;
  check(c.slide === 0 && c.stance === 1 && slid > 4, `then you're crouched, ${slid.toFixed(1)} m on`);
  const w = runner();
  w.inZ = -1;
  steps(w, 1);
  w.inStance = 1; // crouch from a plain run: no slide
  moveContestant(w, DT);
  check(w.slide === 0, "crouching from a run is just a crouch");
}

console.log("\nthe warning hum:");
{
  // Many rounds' worth of her cycle: every turn is warned; some hums are fake.
  let turns = 0;
  let warned = 0;
  let hums = 0;
  let fakes = 0;
  let fakeTwice = 0;
  let fakeFirst = 0;
  let humLenOk = true;
  for (let seed = 1; seed <= 40; seed++) {
    const r = new RedLightRound({ seed, contestants: [{ id: "a", name: "A", bot: false }], course: courseFor("classic", 300) });
    r.get("a")!.graceBonus = 1e9; // never caught: just watch her cycle
    let prev = "";
    let lastFake = false;
    let realTurns = 0;
    let humDur = 0;
    for (let i = 0; i < 60 * 120 && !r.over; i++) {
      r.step(DT);
      for (const e of r.drain()) {
        if (e.type !== "phase") continue;
        if (e.phase === "hum") {
          hums++;
          humDur = e.duration;
          if (Math.abs(e.duration - RULES.hum.length) > 1e-9) humLenOk = false;
        }
        if (e.phase === "turning") {
          turns++;
          realTurns++;
          if (prev === "hum") warned++;
          lastFake = false;
        }
        if (e.phase === "sing" && prev === "hum") {
          fakes++;
          if (lastFake) fakeTwice++;
          if (realTurns === 0) fakeFirst++;
          lastFake = true;
        }
        prev = e.phase;
      }
    }
    void humDur;
  }
  check(turns > 50 && warned === turns, `every turn comes after a hum (${warned}/${turns})`);
  check(humLenOk, `every hum lasts ${RULES.hum.length} s`);
  check(fakes > 0 && Math.abs(fakes / hums - RULES.hum.fakeChance * 0.6) < 0.2, `some hums are fake (${fakes} of ${hums})`);
  check(fakeTwice === 0 && fakeFirst === 0, "never two fakes running, never before her first turn");
  // Running through a hum is safe.
  const r = new RedLightRound({ seed: 9, contestants: [{ id: "a", name: "A", bot: false }], course: courseFor("classic", 300) });
  let guard = 0;
  while (r.phase !== "hum" && guard++ < 60 * 60) r.step(DT);
  r.setInput("a", 0, -1);
  while (r.phase === "hum") r.step(DT);
  check(r.get("a")!.status === "alive", "running all through a hum: still in");
}

console.log("match flow (protocol 7):");
{
  const people = (n: number, bots = 0) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, bot: i >= n - bots }));
  const phasesOf = (ev: RoundEvent[]) => ev.filter((e) => e.type === "phase").map((e) => (e as { phase: string }).phase);
  check(RULES.countdown === 5, "the countdown runs 5 → 1");
  check(walkoutLength("balls") > walkoutLength("classic") && walkoutLength("classic") > FLOW.walk, `walkout ${walkoutLength("classic").toFixed(1)} s (Classic) / ${walkoutLength("balls").toFixed(1)} s (Ball Haunting, + the balls shot)`);

  // A full walkout: nobody moves, the clock doesn't run, then the countdown, then the song.
  const course = courseFor("classic", 100);
  const r = new RedLightRound({ seed: 21, contestants: people(3), course, walkout: walkoutLength("classic") });
  const ev: RoundEvent[] = [...r.drain()];
  const start = r.contestants.map((c) => [c.x, c.z]);
  for (const c of r.contestants) r.setInput(c.id, 0, -1);
  let t = 0;
  while (r.phase === "walkout" && t < 60) {
    r.step(DT);
    t += DT;
    ev.push(...r.drain());
  }
  check(phasesOf(ev)[0] === "walkout" && ev[0].type === "phase" && near(ev[0].duration, walkoutLength("classic"), 1e-9), "a room's round opens on the walkout, its length announced");
  check(near(t, walkoutLength("classic"), 2 * DT), `unskipped, it lasts the full ${walkoutLength("classic").toFixed(1)} s`);
  check(r.contestants.every((c, i) => c.x === start[i][0] && c.z === start[i][1]) && r.elapsed === 0, "nobody moves and the clock doesn't run through the walkout");
  while (r.phase === "countdown") {
    r.step(DT);
    t += DT;
    ev.push(...r.drain());
  }
  check(r.contestants.every((c, i) => c.z === start[i][1]) && r.elapsed < 2 * DT, "or through the countdown");
  check(phasesOf(ev).slice(0, 3).join(",") === "walkout,countdown,sing", "walkout → countdown → sing");

  // Skips: too early does nothing; once everyone in the arena has skipped, the countdown starts at once.
  const s = new RedLightRound({ seed: 22, contestants: people(3), course, walkout: walkoutLength("classic") });
  for (let i = 0; i < Math.round((FLOW.walk - 1) / DT); i++) s.step(DT);
  for (const c of s.contestants) s.skip(c.id);
  check(s.phase === "walkout", "a skip before everyone has walked in doesn't count");
  for (let i = 0; i < Math.round(1.1 / DT); i++) s.step(DT);
  s.skip("p0");
  s.skip("p1");
  check(s.phase === "walkout" && s.hasSkipped("p0") && !s.hasSkipped("p2"), "two of three skipped: the others still watch");
  s.skip("nobody");
  check(s.phase === "walkout", "a stranger's skip counts for nothing");
  s.drain();
  s.skip("p2");
  const sk = s.drain();
  check(s.phase === "countdown" && phasesOf(sk).join(",") === "countdown" && sk[0].type === "phase" && near(sk[0].duration, RULES.countdown, 1e-9), "the last skip starts the countdown for everyone");

  // Solo: CPUs never hold it up — your skip is enough.
  const solo = new RedLightRound({ seed: 23, contestants: people(20, 19), course: courseFor("balls", 200), walkout: walkoutLength("balls") });
  for (let i = 0; i < Math.round((FLOW.walk + 0.1) / DT); i++) solo.step(DT);
  solo.skip("p0");
  check(solo.phase === "countdown", "Solo: your skip alone starts the countdown");

  // Without a walkout (tests, the tutorial): straight to the countdown, as before.
  const plain = new RedLightRound({ seed: 24, contestants: people(2), course });
  check(plain.phase === "countdown" && phasesOf(plain.drain())[0] === "countdown", "a round made without a walkout opens on the countdown");
}

console.log("\nthe pens (Ball Haunting):");
{
  const street = courseFor("balls", 200, 9.2);
  check(street.pens.length === 6 && courseFor("balls", 100, 9.2).pens.length === 4 && courseFor("balls", 300, 9.2).pens.length === 8 && courseFor("classic", 200, 9.2).pens.length === 0, "pens: 4 / 6 / 8 on 100 / 200 / 300 m, none in Classic Run");
  const lane = openLane(street.pens);
  check(street.pens.every((p) => Math.abs(p.x) + PEN.size / 2 + PEN.wall <= street.halfWidth) && lane > 4, `inside the field, both edges, an open middle ${(lane * 2).toFixed(1)} m wide`);
  const desert = mapOf("desert-field");
  check(fieldHalfWidth(desert, "balls") === 24 && fieldHalfWidth(desert, "classic") === 16 && fieldHalfWidth(mapOf("lagos-street"), "balls") === 9.2, "the Desert Field is 48 m wide in Ball Haunting (32 m in Classic Run); streets keep their width");

  // Walls are solid: running at a pen's front beside the door stops at the wall; on the door's line you walk in.
  const pen = street.pens.find((p) => p.side > 0)!;
  const wallFace = pen.x - PEN.size / 2 - PEN.wall;
  const blocked = runner();
  blocked.x = 0;
  blocked.z = pen.z + 1.6; // in front of the wall, beside the door
  blocked.inX = 1;
  for (let i = 0; i < 120; i++) moveContestant(blocked, DT, street);
  check(blocked.x <= wallFace - MOVE.radius + 1e-6 && Math.abs(blocked.z - (pen.z + 1.6)) < 0.05, `beside the door: stopped at the wall (${(wallFace - blocked.x).toFixed(2)} m off it)`);
  const walker = runner();
  walker.x = 0;
  walker.z = pen.z;
  walker.inX = 1;
  for (let i = 0; i < 90; i++) moveContestant(walker, DT, street);
  check(penAt(street.pens, walker.x, walker.z) === pen, "on the door's line: in through the door");
  walker.inX = 0;
  walker.inZ = -1;
  for (let i = 0; i < 90; i++) moveContestant(walker, DT, street);
  check(penAt(street.pens, walker.x, walker.z) === pen && walker.z >= pen.z - PEN.size / 2 + MOVE.radius - 1e-6, "inside, the far wall holds you in");

  // The balls: some in the pens, the rest in the open (never in a pen's walls), all reachable.
  const r = new RedLightRound({ seed: 7, contestants: people(20), course: street });
  const penned = r.balls.filter((b) => penAt(street.pens, b.x, b.z));
  const open = r.balls.filter((b) => !penAt(street.pens, b.x, b.z, PEN.wall + 0.5));
  check(r.balls.length === 13 && penned.length === 6 && open.length === 7, `20 players: 13 balls, ${penned.length} in pens, ${open.length} in the open`);
  check(new Set(penned.map((b) => penAt(street.pens, b.x, b.z))).size === penned.length, "one ball a pen");
  const two = new RedLightRound({ seed: 7, contestants: people(2), course: street });
  check(two.balls.length === 1 && !penAt(street.pens, two.balls[0].x, two.balls[0].z), "a match of two: its one ball lies in the open");

  // A ball knocked loose against a wall lands clear of it.
  const { r: k } = ballRound(2, [[wallFace - 0.4, pen.z + 1.6], [wallFace - 1.9, pen.z + 1.6]], street);
  singing(k);
  const kb = k.balls[0];
  kb.x = wallFace - 0.4;
  kb.z = pen.z + 1.6;
  k.setActions("p0", 0, 1);
  tick(k, 0.4);
  k.setActions("p1", (1 << 2) | 3, 0); // push p0 into the wall
  tick(k, 0.3);
  const w = street.walls;
  const inWall = w.some((x) => Math.abs(kb.x - x.x) < x.hx + 0.29 && Math.abs(kb.z - x.z) < x.hz + 0.29);
  check(k.get("p0")!.ball === -1 && kb.holder === -1 && !inWall, "pushed against a wall: the ball drops clear of it");

  // CPUs find their way in and out of the pens.
  const rr = new RedLightRound({ seed: 3, contestants: people(20).map((p) => ({ ...p, bot: true })), course: street });
  const rng = new Rng(17);
  const brains = rr.contestants.map((c, i) => new BotBrain(c.id, i, rng));
  const fromPen = new Set<number>();
  // Stuck: pushing on the stick while she sings, and not getting anywhere, for long.
  const stuckFor = new Map<string, number>();
  let worst = 0;
  for (let i = 0; i < 60 * 80 && !rr.over; i++) {
    for (const b of brains) b.think(rr, rr.get(b.id)!);
    rr.step(DT);
    for (const e of rr.drain()) if (e.type === "grab" && penAt(street.pens, rr.get(e.id)!.x, rr.get(e.id)!.z, PEN.wall + 0.3)) fromPen.add(e.ball);
    const singing = rr.phase === "sing" || rr.phase === "hum";
    for (const c of rr.contestants) {
      const pushing = c.status === "alive" && singing && Math.hypot(c.inX, c.inZ) > 0.5 && Math.hypot(c.vx, c.vz) < 0.3;
      const t = pushing ? (stuckFor.get(c.id) ?? 0) + DT : 0;
      stuckFor.set(c.id, t);
      worst = Math.max(worst, t);
    }
  }
  check(fromPen.size >= 2 && worst < 1.5, `CPUs go in and out of the pens: ${fromPen.size} pen balls taken from inside, nobody stuck on a wall (longest ${worst.toFixed(1)} s)`);
}

console.log("\nthe final two (protocol 8):");
{
  /** A Classic Run round of n, past the countdown, Mama watching, everyone in a row. */
  const watched = (n: number) => {
    const r = new RedLightRound({ seed: 11, contestants: people(n), course: courseFor("classic", 100) });
    while (r.phase === "countdown") r.step(DT);
    r.contestants.forEach((c, i) => {
      c.x = -6 + i * 3;
      c.z = -20;
      c.vx = c.vz = 0;
    });
    r.phase = "watch";
    r.phaseTime = 1;
    r.phaseDuration = 999;
    r.drain();
    return r;
  };
  const r = watched(4);
  const ev: RoundEvent[] = [];
  r.get("p2")!.inZ = -1;
  r.get("p3")!.inZ = -1;
  tick(r, 0.3, ev);
  const finals = ev.filter((e) => e.type === "final");
  check(r.aliveCount === 2 && finals.length === 1 && finals[0].type === "final" && finals[0].ids.join() === "p0,p1", `two caught, two left: one "final" for p0 and p1`);
  check(r.timeScale === FINAL.scale, `the referee's clock runs at ${r.timeScale}×`);
  const e0 = r.elapsed;
  tick(r, 1, ev);
  check(near(r.elapsed - e0, FINAL.scale, 0.02), `1 s of real time is ${(r.elapsed - e0).toFixed(2)} s of play`);
  const p0 = r.get("p0")!;
  const z0 = p0.z;
  r.phase = "sing";
  p0.inZ = -1;
  tick(r, 1, ev);
  p0.inZ = 0;
  check(p0.z < z0 && near(Math.hypot(p0.vx, p0.vz), MOVE.run, 0.3), `slowed, a runner still runs at ${Math.hypot(p0.vx, p0.vz).toFixed(1)} m/s of play (just slower in real time)`);
  tick(r, FINAL.seconds, ev);
  check(r.timeScale === 1, `after ${FINAL.seconds} s of real time the clock is back to 1×`);
  r.phase = "watch";
  r.phaseTime = 1;
  r.get("p1")!.inZ = -1;
  tick(r, 0.3, ev);
  check(r.aliveCount === 1 && ev.filter((e) => e.type === "final").length === 1, "once a round: one left is no second final");
  const two = watched(2);
  const ev2: RoundEvent[] = [];
  tick(two, 0.5, ev2);
  check(!ev2.some((e) => e.type === "final") && two.timeScale === 1, "a round of two (a staked match) has no final two");
  const three = watched(3);
  const ev3: RoundEvent[] = [];
  three.get("p0")!.inZ = -1;
  three.get("p1")!.inZ = -1;
  three.get("p2")!.inZ = -1;
  tick(three, 0.3, ev3);
  check(!ev3.some((e) => e.type === "final"), "three caught at once: nobody is left to slow down for");
}

console.log("\nhighlights (the play of the game):");
{
  /** Step the referee and the scorer together; the moments it announced. */
  const run = (r: RedLightRound, h: Highlights, seconds: number, each?: () => void): Moment[] => {
    const out: Moment[] = [];
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      each?.();
      r.step(DT);
      const m = h.observe(r, r.drain());
      if (m) out.push(m);
    }
    return out;
  };
  const setup = (n: number, mode: "classic" | "balls" = "classic") => {
    const r = new RedLightRound({ seed: 21, contestants: people(n), course: courseFor(mode, 100) });
    while (r.phase === "countdown") r.step(DT);
    r.contestants.forEach((c, i) => {
      c.x = -6 + i * 4;
      c.z = -20;
      c.vx = c.vz = 0;
    });
    r.drain();
    return r;
  };

  // A close escape: walking as she turns, stopping just before she can see.
  {
    const r = setup(3);
    const h = new Highlights();
    r.phase = "turning";
    r.phaseTime = 0;
    r.phaseDuration = 0.4;
    const p0 = r.get("p0")!;
    p0.inZ = -0.3;
    const ms = run(r, h, 7, () => {
      if (r.phase === "watch" && r.phaseTime >= 0.08) p0.inZ = 0;
      if (r.phase === "turningBack") r.phaseDuration = 999;
    });
    const m = ms[ms.length - 1];
    check(p0.status === "alive" && !!m && m.kind === "escape" && m.who === 0 && m.score > 70, `stopped just in time and not caught: a close escape (${m?.kind} ${m?.score})`);
  }

  // A near miss: shot right beside you while you stood still.
  {
    const r = setup(3);
    const h = new Highlights();
    r.get("p1")!.x = r.get("p0")!.x + 1;
    r.phase = "watch";
    r.phaseTime = 1;
    r.phaseDuration = 1.5;
    // (Two left after the shot: the final two's slow motion stretches the stare.)
    const ms = run(r, h, 2.5, () => {
      r.get("p1")!.inZ = -1;
      if (r.phase === "turningBack") r.phaseDuration = 999;
    });
    const m = ms[ms.length - 1];
    check(r.get("p1")!.status === "eliminated" && !!m && m.kind === "dodge" && m.who === 0 && m.score > 60, `1 m from someone shot, and still in: a dodge (${m?.kind} ${m?.score})`);
  }

  // A steal: knock the ball loose, wait out the 3 s, take it.
  {
    const r = setup(2, "balls");
    const h = new Highlights();
    singing(r);
    const [a, b] = [r.get("p0")!, r.get("p1")!];
    b.x = a.x + 1.2;
    b.z = a.z;
    const ball = r.balls[0];
    ball.x = a.x;
    ball.z = a.z;
    r.setActions("p0", 0, 1);
    run(r, h, 0.5);
    r.setActions("p1", (1 << 2) | 1, 0); // fist
    run(r, h, 0.2);
    const loose = ball.holder === -1;
    b.x = ball.x;
    b.z = ball.z;
    r.setActions("p1", (1 << 2) | 1, 1);
    const early = run(r, h, 1);
    r.setActions("p1", (1 << 2) | 1, 2);
    const ms = run(r, h, BALLS.attackerWait + 0.5, () => {
      b.x = ball.x;
      b.z = ball.z;
      if (r.elapsed > BALLS.attackerWait + 1.2 && b.ball < 0) r.setActions("p1", (1 << 2) | 1, 3);
    });
    const m = ms.find((x) => x.kind === "attack");
    check(loose && early.every((x) => x.kind !== "attack") && b.ball === ball.index && !!m && m.who === 1, `knocked loose, taken back after the wait: the best attack (${m?.score})`);
  }
}

console.log("\nCP boosts (SPEC-V2 §7.7):");
{
  check(BOOSTS.length >= 10 && BOOSTS.length <= 20, `${BOOSTS.length} boosts (10–20)`);
  check(modsOf(["quick_feet", "sprinter", "cool_head"]) === modsOf(["quick_feet", "sprinter"]) || modsOf(["quick_feet", "sprinter", "cool_head"]).grace === 0, `at most ${BOOST_SLOTS} count`);
  check(modsOf([]) === NO_BOOST && modsOf(["nonsense"]) === NO_BOOST, "none, or unknown ids: no change");
  check(boostsFromWire(boostsToWire(["iron_grip", "long_arm"])).join() === "iron_grip,long_arm" && boostsFromWire([0, 0, 99, "x"]).join() === "quick_feet", "on the wire: indexes, cleaned");

  // Quick Feet: a full push runs 4% faster; Sprinter: sprints 4% faster.
  const a = runner();
  const b = runner();
  setBoosts(b, ["quick_feet", "sprinter"]);
  a.inZ = b.inZ = -1;
  steps(a, 1.2);
  steps(b, 1.2);
  check(near(speed(b) / speed(a), 1.04, 0.002), `Quick Feet: run ${speed(a).toFixed(2)} → ${speed(b).toFixed(2)} m/s`);
  a.inSprint = b.inSprint = true;
  steps(a, 0.8);
  steps(b, 0.8);
  check(near(speed(b) / speed(a), 1.04, 0.002), `Sprinter: sprint ${speed(a).toFixed(2)} → ${speed(b).toFixed(2)} m/s`);

  // Second Wind: a full bar lasts 25% longer.
  const s1 = runner();
  const s2 = runner();
  setBoosts(s2, ["second_wind"]);
  s1.inZ = s2.inZ = -1;
  s1.inSprint = s2.inSprint = true;
  // The first unbroken sprint, from a full bar.
  const firstRun = (c: Contestant) => {
    let t = 0;
    let stopped = false;
    steps(c, MOVE.sprintFor * 1.6, () => {
      if (c.sprinting && !stopped) t += DT;
      else if (t > 0) stopped = true;
    });
    return t;
  };
  const t1 = firstRun(s1);
  const t2 = firstRun(s2);
  check(near(t2 / t1, 1.25, 0.03), `Second Wind: sprint ${t1.toFixed(1)} s → ${t2.toFixed(1)} s`);

  // Iron Grip: the first hit leaves the ball in your hands, the second knocks it loose.
  const { r } = ballRound(2, [[0, -20], [0, -18.5]]);
  singing(r);
  setBoosts(r.get("p0")!, ["iron_grip"]);
  const ball = r.balls[0];
  ball.x = 0;
  ball.z = -20;
  r.setActions("p0", 0, 1);
  tick(r, 0.05);
  const ev: RoundEvent[] = [];
  r.setActions("p1", (1 << 2) | 2, 0); // slap
  tick(r, 1, ev);
  const first = ev.find((e) => e.type === "attack");
  check(first?.type === "attack" && first.target === "p0" && first.dropped === -1 && r.get("p0")!.ball === ball.index, "Iron Grip: the first hit doesn't knock the ball loose");
  const p1 = r.get("p1")!;
  p1.x = r.get("p0")!.x;
  p1.z = r.get("p0")!.z + 1.2;
  r.setActions("p1", (2 << 2) | 2, 0);
  tick(r, 1, ev);
  const second = ev.filter((e) => e.type === "attack")[1];
  check(second?.type === "attack" && second.dropped === ball.index && ball.holder === -1, "the second does");

  // Long Arm reaches 2.3 m; without it a swing from there misses.
  const { r: r2 } = ballRound(2, [[0, -20], [0, -17.8]]);
  singing(r2);
  const ev2: RoundEvent[] = [];
  r2.setActions("p1", (1 << 2) | 1, 0);
  tick(r2, 0.1, ev2);
  setBoosts(r2.get("p1")!, ["long_arm"]);
  r2.get("p1")!.cool = 0;
  r2.get("p0")!.x = 0;
  r2.get("p0")!.z = -20;
  r2.get("p1")!.x = 0;
  r2.get("p1")!.z = -17.8;
  r2.setActions("p1", (2 << 2) | 1, 0);
  tick(r2, 0.1, ev2);
  const sw = ev2.filter((e) => e.type === "attack");
  check(sw.length === 2 && sw[0].type === "attack" && sw[0].target === null && sw[1].type === "attack" && sw[1].target === "p0", "Long Arm: 2.2 m misses without it, lands with it");

  // Cool Head: moving just inside the usual grace + 0.1 s is caught without it, safe with it.
  let caught = 0;
  for (const boosted of [false, true]) {
    const rr = new RedLightRound({ seed: 3, contestants: [...people(2)].map((p, i) => ({ ...p, boosts: boosted && i === 0 ? ["cool_head"] : [] })), course: courseFor("classic", 100) });
    while (rr.phase !== "watch") rr.step(DT);
    const c = rr.get("p0")!;
    let out = false;
    for (let i = 0; i < Math.round((RULES.grace + 0.07) / DT); i++) {
      c.inZ = rr.phaseTime > RULES.grace + 0.02 ? -1 : 0;
      rr.step(DT);
      if (rr.drain().some((e) => e.type === "eliminated" && e.id === "p0")) out = true;
    }
    if (out) caught++;
    if (boosted) check(!out, "Cool Head: moving just after the usual grace isn't seen yet");
    else check(out, "without it: caught");
  }
}

console.log("\nthe tutorial:");
for (const mode of ["classic", "balls"] as const) {
  // The scripted round shows every step, on any seed, and the model makes it over the line.
  let missed = 0;
  let worst = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const r = new RedLightRound({ seed, contestants: tutorialPeople(mode), featuredId: "demo", course: courseFor(mode, 100) });
    const script = new TutorialScript(mode);
    const seen = new Set<string>();
    let t = 0;
    while (!r.over && !script.done && t < 90) {
      script.think(r);
      r.step(DT);
      t += DT;
      for (const e of r.drain()) {
        const id = script.onEvent(e, r);
        if (id) seen.add(id);
      }
    }
    worst = Math.max(worst, t);
    if (!script.done || tutorialSteps(mode).some((s) => s.id !== "end" && !seen.has(s.id))) missed++;
  }
  check(missed === 0, `${mode === "balls" ? "Ball Haunting" : "Classic Run"}: every step shown and the model crosses, 30/30 seeds (longest ${worst.toFixed(0)} s)`);
}

console.log(`\n${failures ? `${failures} FAILED` : "all passed"}`);
process.exit(failures ? 1 : 0);
