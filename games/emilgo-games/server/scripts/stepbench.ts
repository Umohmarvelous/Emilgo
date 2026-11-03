// Dev only: one Free For All room's step cost, offline (v4 Phase 10). Plays a
// mode with scripted inputs like the load test's and reports each step's time:
// the slow ones and which module they spent it in.
//
//   node server/build-tools.mjs && node server/dist/stepbench.mjs max-royale 24 180

import { BUILTIN_MANIFEST } from "../../src/content/modes";
import { FfaGame } from "../src/ffa";

const id = process.argv[2] ?? "max-royale";
const n = Number(process.argv[3] ?? 24);
const secs = Number(process.argv[4] ?? 180);
const def = BUILTIN_MANIFEST.modes.find((m) => m.id === id)!;
const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const t0 = performance.now();
const g = new FfaGame(def, 7, roster, roster.map((_, i) => Math.floor(i / def.players.squad[1])));
console.log(`${id} ×${n}: built in ${(performance.now() - t0).toFixed(0)} ms (cold)`);
for (let k = 0; k < 3; k++) {
  const t1 = performance.now();
  new FfaGame(def, 8 + k, roster, roster.map((_, i) => Math.floor(i / def.players.squad[1])));
  console.log(`  again: ${(performance.now() - t1).toFixed(1)} ms`);
}

// Time each module's hooks.
const spent = new Map<string, number>();
const worst = new Map<string, number>();
let stepMods = new Map<string, number>();
for (const m of g.match.modules as unknown as { id?: string; pre?: Function; step?: Function }[]) {
  for (const hook of ["pre", "step"] as const) {
    const f = m[hook];
    if (!f) continue;
    const key = `${m.id ?? m.constructor.name}.${hook}`;
    m[hook] = function (this: unknown, ...a: unknown[]) {
      const s = performance.now();
      const r = f.apply(this, a);
      const d = performance.now() - s;
      spent.set(key, (spent.get(key) ?? 0) + d);
      stepMods.set(key, (stepMods.get(key) ?? 0) + d);
      return r;
    };
  }
}
const inp = roster.map(() => ({ x: 0, z: 0, b: 0, a: 0, g: 0, i: 0, y: 0, p: 0, w: 0, turnAt: 0, burstTo: 0, reloads: 0 }));
let rs = 12345;
const rnd = () => ((rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296);
const times: number[] = [];
const slow: { t: number; ms: number; mods: string }[] = [];
const STEP = 1 / 60;
for (let k = 0; k < secs * 60 && !g.over; k++) {
  const t = k * STEP * 1000;
  if (k % 4 === 0)
    roster.forEach((r, i) => {
      const q = inp[i];
      if (t > q.turnAt) {
        q.turnAt = t + 1500 + rnd() * 4000;
        const a = rnd() * Math.PI * 2;
        const stop = rnd() < 0.15;
        q.x = stop ? 0 : Math.round(Math.cos(a) * 100);
        q.z = stop ? 0 : Math.round(Math.sin(a) * 100);
        q.b = rnd() < 0.4 ? 1 : 0;
      }
      q.y = Math.round(Math.atan2(Math.sin(q.y / 1000 + (rnd() - 0.5) * 0.2), Math.cos(q.y / 1000 + (rnd() - 0.5) * 0.2)) * 1000);
      q.p = Math.round((rnd() - 0.5) * 120);
      if (t > q.burstTo + 1200 && rnd() < 0.06) q.burstTo = t + 400 + rnd() * 1400;
      if (rnd() < 0.004) q.reloads = (q.reloads + 1) & 15;
      q.w = (t < q.burstTo ? 1 : 0) | (q.reloads << 2);
      if (rnd() < 0.02) q.a = ((((q.a >> 2) + 1) & 63) << 2) | (1 + Math.floor(rnd() * 3));
      if (rnd() < 0.01) q.g = (q.g + 1) & 255;
      if (rnd() < 0.04) q.i = (q.i + 1) & 255;
      g.input(r.id, q.x, q.z, q.b, 0, q.a, q.g, q.i, 0, q.y, q.p, q.w);
    });
  stepMods = new Map();
  const s = performance.now();
  g.step(STEP, () => 0);
  if (k % 4 === 3) JSON.stringify(g.snapshot(t, false, k % 60 === 59));
  const ms = performance.now() - s;
  times.push(ms);
  if (ms > 8) slow.push({ t: k / 60, ms, mods: [...stepMods].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, v]) => `${m} ${v.toFixed(1)}`).join(", ") });
  if (ms > (worst.get("step") ?? 0)) worst.set("step", ms);
}
const s = [...times].sort((a, b) => a - b);
const p = (q: number) => s[Math.min(s.length - 1, Math.floor(s.length * q))].toFixed(2);
console.log(`${times.length} steps (${(times.length / 60).toFixed(0)} s, over: ${g.over}) · p50 ${p(0.5)} ms · p99 ${p(0.99)} ms · max ${s[s.length - 1].toFixed(1)} ms · total ${(times.reduce((a, b) => a + b, 0) / 1000).toFixed(2)} s`);
console.log("modules (total ms):", [...spent].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(" · "));
console.log(`steps over 8 ms: ${slow.length}`);
for (const x of slow.sort((a, b) => b.ms - a.ms).slice(0, 12)) console.log(`  t=${x.t.toFixed(1)}s ${x.ms.toFixed(1)} ms · ${x.mods}`);
