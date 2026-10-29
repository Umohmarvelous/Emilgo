// Dev only: company for a person testing Free For All in a browser (and the
// perf gate's crowd). N scripted phones join a mode's public queue on the
// test server — with you, it fills — then play: they search the stash spots
// (Find the Flag), walk to the flag or a drop zone, and swing at anyone close.
// Not bots in the game: test clients on the network, like the load test.
//
//   node server/dist/ffaplay.mjs [--url ws://localhost:8797] [--mode find-the-flag] [--n 11] [--seconds 300] [--hunt]
//
// --hunt: they ignore the objective and go for you (anyone not named "Tester …"), to see melee up close.

import type { FlagsModule } from "../../src/game/modules/flags";
import type { DropzonesModule } from "../../src/game/modules/dropzones";
import { field, Phone, spotDone } from "./ffanet";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const url = arg("url", "ws://localhost:8797");
const mode = arg("mode", "find-the-flag");
const n = Number(arg("n", "11"));
const seconds = Number(arg("seconds", "300"));
const hunt = process.argv.includes("--hunt");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const phones = Array.from({ length: n }, (_, i) => new Phone(`Tester ${i + 1}`, url));
  await Promise.all(phones.map((p) => p.open()));
  for (const p of phones) p.send({ t: "fq", m: mode });
  console.log(`${n} phones in the ${mode} queue`);
  await Promise.all(phones.map((p) => p.wait((m) => m.t === "start", 600_000)));
  console.log("started");
  const t0 = Date.now();
  const fields = new Map<string, Int32Array>();
  const targets = new Map<Phone, number>();
  while (Date.now() - t0 < seconds * 1000 && !phones.every((p) => p.ended)) {
    await sleep(60);
    for (const p of phones) {
      const m = p.match;
      const c = p.me();
      if (!m || !c || m.phase !== "play" || c.status !== "alive") continue;
      const f = m.module<FlagsModule>("flags");
      const dz = m.module<DropzonesModule>("dropzones");
      // Anyone within 1.8 m: a swing now and then.
      const near = m.contestants.find((o) => o !== c && o.status === "alive" && Math.hypot(o.x - c.x, o.z - c.z) < 1.8);
      if (near && Math.random() < 0.08) p.swing((1 + Math.floor(Math.random() * 3)) as 1 | 2 | 3);
      let goal: { x: number; z: number } | null = null;
      if (hunt) {
        const you = m.contestants.filter((o) => o.status === "alive" && !o.name.startsWith("Tester")).sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[0];
        if (you) {
          const d = Math.hypot(you.x - c.x, you.z - c.z);
          if (d < 1.8 && Math.random() < 0.1) p.swing((1 + Math.floor(Math.random() * 3)) as 1 | 2 | 3);
          if (process.env.DEBUG && phones.indexOf(p) < 3 && Math.random() < 0.02) {
            const df0 = fields.get(`${Math.round(you.x / 2)},${Math.round(you.z / 2)}`);
            console.log(`${p.name} d ${d.toFixed(0)} at ${c.x.toFixed(0)},${c.z.toFixed(0)} cell ${m.reach.cell(c.x, c.z)} f ${df0 ? df0[m.reach.cell(c.x, c.z)] : "-"} you ${you.x.toFixed(0)},${you.z.toFixed(0)} ok ${m.reach.ok[m.reach.cell(you.x, you.z)]}`);
          }
          if (d < 1.5) p.stick(0, 0);
          else {
            const key = `${Math.round(you.x / 2)},${Math.round(you.z / 2)}`;
            let df = fields.get(key);
            if (!df) fields.set(key, (df = field(m.reach, you.x, you.z)));
            p.steer(df);
          }
          p.sendInput();
          continue;
        }
      }
      const mine = f?.flags.find((x) => x.holder === c.index);
      if (mine && dz) goal = dz.zones.reduce((a, b) => (Math.hypot(a.x - c.x, a.z - c.z) < Math.hypot(b.x - c.x, b.z - c.z) ? a : b), dz.zones[0]) ?? null;
      else if (mine) goal = null;
      else if (f) {
        const loose = f.flags.find((x) => !x.hidden && x.holder < 0) ?? f.flags.find((x) => !x.hidden && x.holder >= 0);
        if (loose) goal = loose;
        else if (f.stashes.length) {
          let k = targets.get(p) ?? -1;
          if (k < 0 || spotDone(p, k)) {
            k = f.stashes.filter((s) => !spotDone(p, s.index)).sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[Math.floor(Math.random() * 2)]?.index ?? -1;
            targets.set(p, k);
          }
          if (k >= 0) {
            const s = f.stashes[k];
            if (Math.hypot(s.x - c.x, s.z - c.z) < 1.4) {
              p.stick(0, 0);
              p.tap();
              p.sendInput();
              continue;
            }
            goal = s;
          }
        }
      }
      if (!goal) p.stick(0, 0);
      else {
        const key = `${Math.round(goal.x)},${Math.round(goal.z)}`;
        let d = fields.get(key);
        if (!d) fields.set(key, (d = field(m.reach, goal.x, goal.z)));
        p.steer(d);
      }
      p.sendInput();
    }
  }
  console.log(`done: ${phones[0].won ? `won by ${phones[0].match?.get(phones[0].won)?.name}` : "no winner"}`);
  for (const p of phones) p.close();
  process.exit(0);
}

void main();
