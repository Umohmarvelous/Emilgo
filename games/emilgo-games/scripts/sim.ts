// Headless balance check: plays many practice rounds with bots only (plus a
// scripted "human" with a given reaction time) and prints outcome rates.
// Run from the repo root:  npx tsx games/emilgo-games/scripts/sim.ts [rounds] [classic|balls] [100|200|300|all]

import { DISTANCES, PRACTICE, RULES, MOVE, ballCount, courseFor, type Course, type Distance, type Mode } from "../src/config";
import { Rng } from "../src/core/rng";
import { BotBrain, BOT_NAMES } from "../src/game/bots";
import { RedLightRound } from "../src/game/rules";

const ROUNDS = Number(process.argv[2] ?? 400);
const MODE = (process.argv[3] ?? "classic") as Mode;
const DISTS: Distance[] = !process.argv[4] || process.argv[4] === "all" ? [...DISTANCES] : [Number(process.argv[4]) as Distance];
let course: Course = courseFor(MODE, 200);
const DT = 1 / 60;

/**
 * A scripted human. Runs while she sings and lets go `reaction` s after the
 * cue it trusts:
 *   watcher   watches Mama — ignores the song stopping, reacts to her turning
 *   listener  trusts the hum — freezes as it ends (fake hums included)
 */
let turnFor = 0;
let lastPhase = "";
function humanInput(round: RedLightRound, reaction: number, run: boolean, listener: boolean): [number, number] {
  const t = round.phaseTime;
  if (round.phase !== lastPhase) {
    if (round.phase === "turning") turnFor = round.phaseDuration;
    lastPhase = round.phase;
  }
  const go =
    (round.phase === "sing" && t > 0.15) ||
    (round.phase === "hum" && (!listener || t < RULES.hum.length - reaction)) ||
    (round.phase === "turning" && t < reaction) ||
    (round.phase === "watch" && t < reaction - turnFor);
  if (!go) return [0, 0];
  return [0, run ? -1 : -MOVE.runAt * 0.95];
}
void RULES;

function play(seed: number, humanReaction: number, humanRuns: boolean, listener: boolean) {
  const rng = new Rng(seed ^ 0x5bd1e995);
  const people = [{ id: "me", name: "Me", bot: false }];
  for (let i = 0; i < PRACTICE.bots; i++) people.push({ id: `b${i}`, name: BOT_NAMES[i], bot: true });
  const round = new RedLightRound({ seed, contestants: people, featuredId: "me", course });
  const brains = people.slice(1).map((p, i) => new BotBrain(p.id, i, rng));
  // Ball Haunting needs a ball: the "human" plays it like a steady CPU.
  if (course.mode === "balls") brains.push(new BotBrain("me", 1, rng));

  let steps = 0;
  while (round.phase !== "ended" && steps++ < 60 * (course.timeLimit + 10)) {
    if (course.mode === "classic") {
      const [x, z] = humanInput(round, humanReaction, humanRuns, listener);
      round.setInput("me", x, z);
    }
    for (const b of brains) b.think(round, round.get(b.id)!);
    round.step(DT);
    round.drain();
  }
  const bots = round.contestants.filter((c) => c.bot);
  const me = round.get("me")!;
  return {
    botsFinished: bots.filter((c) => c.status === "finished").length,
    botsMoved: bots.filter((c) => c.cause === "moved").length,
    botsTime: bots.filter((c) => c.cause === "time" || c.cause === "noball").length,
    me: me.status === "finished" ? "finished" : me.cause ?? "?",
    meTime: me.finishTime,
    duration: round.elapsed,
  };
}

function report(label: string, reaction: number, runs: boolean, listener = false) {
  let fin = 0, moved = 0, time = 0, meFin = 0, meMoved = 0, meTime = 0, dur = 0, finT = 0;
  for (let s = 1; s <= ROUNDS; s++) {
    const r = play(s * 7919, reaction, runs, listener);
    fin += r.botsFinished; moved += r.botsMoved; time += r.botsTime; dur += r.duration;
    if (r.me === "finished") { meFin++; finT += r.meTime; }
    if (r.me === "moved") meMoved++;
    if (r.me === "time") meTime++;
  }
  const n = ROUNDS * PRACTICE.bots;
  console.log(
    `${label.padEnd(26)} bots: finish ${(100 * fin / n).toFixed(0)}%  caught ${(100 * moved / n).toFixed(0)}%  timeout ${(100 * time / n).toFixed(0)}%` +
    ` | human: finish ${(100 * meFin / ROUNDS).toFixed(0)}% (avg ${(finT / Math.max(1, meFin)).toFixed(1)}s)  caught ${(100 * meMoved / ROUNDS).toFixed(0)}%  timeout ${(100 * meTime / ROUNDS).toFixed(0)}%` +
    ` | round ${(dur / ROUNDS).toFixed(1)}s`,
  );
}

for (const d of DISTS) {
  course = courseFor(MODE, d);
  console.log(
    `\n${MODE} ${d} m — ${ROUNDS} rounds, ${PRACTICE.bots + 1} players${MODE === "balls" ? `, ${ballCount(PRACTICE.bots + 1)} balls` : ""}, limit ${course.timeLimit}s, detection ${(RULES.turning.min + RULES.grace).toFixed(2)}–${(RULES.turning.max + RULES.grace).toFixed(2)}s after she starts turning, fake hums ${RULES.hum.fakeChance}`,
  );
  if (MODE === "balls") {
    report("CPU field (all 20)", 0.35, true);
    continue;
  }
  report("sharp watcher (0.25s)", 0.25, true);
  report("good watcher (0.35s)", 0.35, true);
  report("ok watcher (0.45s)", 0.45, true);
  report("slow watcher (0.60s)", 0.6, true);
  report("good listener (0.35s)", 0.35, true, true);
  report("good walker (0.35s)", 0.35, false);
}
