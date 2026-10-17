// Dev only: how big is a worst-case snapshot (everyone alive, running, balls in play)?
//   npx tsx dev/snapsize.ts
import { NET, courseFor } from "../src/config";
import { RedLightRound } from "../src/game/rules";
import { packFlags } from "../src/net/protocol";

const r = new RedLightRound({ seed: 42, contestants: Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, bot: false })), course: courseFor("balls", 300) });
while (r.phase === "countdown") r.step(1 / 60);
for (const c of r.contestants) r.setInput(c.id, (Math.random() - 0.5) * 0.4, -1);
for (let i = 0; i < 60 * 8; i++) r.step(1 / 60);
const cm = (v: number) => Math.round(v * 100);
// Everyone alive and spread out (worst case: nobody's entry is zeros).
r.contestants.forEach((c, i) => {
  c.status = "alive";
  c.x = -8 + (i % 5) * 4.1;
  c.z = -150 - i * 3.7;
  c.heading = 3.1416 - i * 0.01;
});
const p: number[] = [];
for (const c of r.contestants) p.push(cm(c.x), cm(c.z), Math.round(c.heading * 1000), cm(c.y), packFlags(c.stance, c.sprinting, c.stamina, false, 0));
const msg = JSON.stringify({ t: "snap", s: Date.now(), ph: 1, pt: 1234, pd: 0, el: 8000, st: "a".repeat(20), p });
console.log(`alive ${r.aliveCount}/20 · snapshot ${msg.length} B · ×${NET.snapshotHz}/s = ${((msg.length * NET.snapshotHz) / 1024).toFixed(1)} KB/s`);
