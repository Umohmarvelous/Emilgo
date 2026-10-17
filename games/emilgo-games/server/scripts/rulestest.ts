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

import { ATTACK, BALLS, DISTANCES, MOVE, RULES, TIME_LIMIT, ballCount, courseFor, type Course } from "../../src/config";
import { RedLightRound, freshMotion, isMoving, moveContestant, type Contestant, type RoundEvent } from "../../src/game/rules";

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

console.log(`\n${failures ? `${failures} FAILED` : "all passed"}`);
process.exit(failures ? 1 : 0);
