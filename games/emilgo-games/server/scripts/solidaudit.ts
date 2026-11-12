// v7 (2.6, the owner: "I do not want character to be able to walk into an object (building, stones, assets,
// trees, nothing except the items)"): what is drawn where a body would touch it, with no solid there.
//
// Draws every placement of both open worlds with the prefab kit (as Medium does, without the scans) and samples
// each drawn surface between LO and HI metres up; a sample no solid holds (MARGIN of grace) is walked through.
// Prints, per prefab (props by table index), the count and the uncovered parts' boxes in the placement's own axes.
// A ramp's drawn steps read as uncovered: a false alarm. Not a pass/fail test: a list to work from.
// The rocks are left out: the game draws their scans (the model library), whose solids are the scans' own
// footprints (prefabs.ts rockParts); the drawn rock here is only the fallback without the library.
//
//   node server/build-tools.mjs && node server/dist/solidaudit.mjs          (MARGIN=0.2 to loosen)
import type { BufferGeometry } from "three";
import { PrefabKit } from "../../src/maps/open/art";
import { buildNaijaWorld } from "../../src/maps/open/naija";
import { buildMaxWorld } from "../../src/maps/open/max";
import type { Solid } from "../../src/game/core/space";

const LO = 0.5;
const HI = 1.6;
const MARGIN = Number(process.env.MARGIN ?? 0.12);

function inside(s: Solid, x: number, y: number, z: number): boolean {
  if (s.kind === "pit") return false;
  const dx = x - s.x;
  const dz = z - s.z;
  const c = Math.cos(s.rot);
  const n = Math.sin(s.rot);
  const lx = dx * c - dz * n;
  const lz = dx * n + dz * c;
  if (Math.abs(lx) > s.hx + MARGIN || Math.abs(lz) > s.hz + MARGIN) return false;
  if (s.kind === "ramp") {
    const t = Math.min(1, Math.max(0, (lz + s.hz) / (2 * s.hz)));
    return y >= s.y0 - 0.1 && y <= s.y1 + ((s.y2 ?? s.y1) - s.y1) * t + 0.1;
  }
  return y >= s.y0 - 0.1 && y <= s.y1 + 0.1;
}

for (const [name, L] of [["Naija City", buildNaijaWorld()], ["Meridian Max", buildMaxWorld()]] as const) {
  const G = 8;
  const grid = new Map<string, number[]>();
  L.solids.forEach((s, i) => {
    const r = Math.hypot(s.hx, s.hz) + 1;
    for (let gx = Math.floor((s.x - r) / G); gx <= Math.floor((s.x + r) / G); gx++)
      for (let gz = Math.floor((s.z - r) / G); gz <= Math.floor((s.z + r) / G); gz++) {
        const k = `${gx},${gz}`;
        (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
      }
  });
  const covered = (x: number, y: number, z: number) => (grid.get(`${Math.floor(x / G)},${Math.floor(z / G)}`) ?? []).some((i) => inside(L.solids[i], x, y, z));
  const kit = new PrefabKit(1957);
  kit.tier = 1;
  const per = new Map<string, { n: number; pts: number; parts: string[]; from: number }>();
  for (const [pi, p] of L.placements.entries()) {
    if (p.prefab === "rock") continue;
    const { chunk } = kit.draw(p, false);
    const key = p.prefab === "prop" ? `prop:${p.v & 255}` : p.prefab;
    const e = per.get(key) ?? { n: 0, pts: 0, parts: [], from: -1 };
    e.n++;
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    const lists: [string, BufferGeometry[]][] = [["mass", chunk.mass], ["main", chunk.main], ["detail", chunk.detail], ["atlas", chunk.atlas], ["leaves", chunk.leaves]];
    for (const [bucket, list] of lists)
      for (const g of list) {
        const pos = g.attributes.position;
        const idx = g.index;
        const tris = (idx ? idx.count : pos.count) / 3;
        let bb: number[] | null = null;
        for (let t = 0; t < tris; t++) {
          const v = [0, 1, 2].map((j) => (idx ? idx.getX(t * 3 + j) : t * 3 + j)).map((i) => [pos.getX(i), pos.getY(i), pos.getZ(i)]);
          const [A, B, C] = v;
          if (Math.max(A[1], B[1], C[1]) < LO || Math.min(A[1], B[1], C[1]) > HI) continue;
          const edge = Math.max(Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]), Math.hypot(A[0] - C[0], A[1] - C[1], A[2] - C[2]), Math.hypot(B[0] - C[0], B[1] - C[1], B[2] - C[2]));
          const m = Math.min(30, Math.max(1, Math.ceil(edge / 0.3)));
          for (let i = 0; i <= m; i++)
            for (let j = 0; j <= m - i; j++) {
              const u = i / m;
              const w = j / m;
              const o = 1 - u - w;
              const x = A[0] * o + B[0] * u + C[0] * w;
              const y = A[1] * o + B[1] * u + C[1] * w;
              const z = A[2] * o + B[2] * u + C[2] * w;
              if (y < LO || y > HI || covered(x, y, z)) continue;
              e.pts++;
              const dx = x - p.x;
              const dz = z - p.z;
              const lx = dx * c - dz * s;
              const lz = dx * s + dz * c;
              bb = bb ? [Math.min(bb[0], lx), Math.max(bb[1], lx), Math.min(bb[2], y), Math.max(bb[3], y), Math.min(bb[4], lz), Math.max(bb[5], lz)] : [lx, lx, y, y, lz, lz];
            }
        }
        // The parts of the first placement with any uncovered (every placement of a prefab differs a little).
        if (bb && (e.from < 0 || e.from === pi) && e.parts.length < 8) e.from = pi;
        if (bb && e.from === pi && e.parts.length < 8) e.parts.push(`${bucket} x[${bb[0].toFixed(1)}, ${bb[1].toFixed(1)}] y[${bb[2].toFixed(1)}, ${bb[3].toFixed(1)}] z[${bb[4].toFixed(1)}, ${bb[5].toFixed(1)}]`);
      }
    per.set(key, e);
  }
  console.log(`== ${name}: ${L.placements.length} placements, ${L.solids.length} solids`);
  for (const [k, e] of [...per].sort((a, b) => b[1].pts - a[1].pts)) {
    if (!e.pts) continue;
    console.log(`${k.padEnd(14)} ×${e.n}  ${e.pts} samples uncovered`);
    for (const b of e.parts) console.log(`    ${b}`);
  }
}
