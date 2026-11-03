// The EMILGO app's copy of the operators (v4 rework): the app embeds the game
// in one file, so it carries the three near-to-far levels only (High and Max
// in the app wear level 2). Reads op-m.bin / op-f.bin, drops level 3, keeps
// only the vertices levels 0–2 use, writes op-m.lite.bin / op-f.lite.bin.
//
//   node tools/anim/lite.mjs          (after tools/anim/operator.mjs)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../../src/world/human/op");
const KEEP = 3;
const pad = (n) => (4 - (n % 4)) % 4;

for (const body of ["m", "f"]) {
  const buf = readFileSync(join(DIR, `op-${body}.bin`));
  const hl = buf.readUInt32LE(4);
  const head = JSON.parse(buf.subarray(8, 8 + hl).toString());
  const N = head.n;
  let o = 8 + hl + pad(hl);
  const take = (Ctor, len) => {
    const a = new Ctor(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + len * Ctor.BYTES_PER_ELEMENT));
    o += a.byteLength + pad(a.byteLength);
    return a;
  };
  const P = take(Int16Array, N * 3);
  const Nn = take(Int8Array, N * 3);
  const reg = take(Uint8Array, N);
  const ji = take(Uint8Array, N * 4);
  const W = take(Uint8Array, N * 4);
  const pal = take(Uint8Array, N * 4);
  const acc = take(Uint8Array, N);
  const lv = head.levels.map((len) => take(head.wide ? Uint32Array : Uint16Array, len));
  const keep = lv.slice(0, KEEP);
  const map = new Int32Array(N).fill(-1);
  let n = 0;
  for (const ix of keep) for (const k of ix) if (map[k] < 0) map[k] = n++;
  const sub = (src, w, Ctor) => {
    const out = new Ctor(n * w);
    for (let k = 0; k < N; k++) if (map[k] >= 0) for (let c = 0; c < w; c++) out[map[k] * w + c] = src[k * w + c];
    return out;
  };
  const wide = n > 65535;
  const idx = keep.map((ix) => (wide ? Uint32Array : Uint16Array).from(ix, (k) => map[k]));
  const h2 = { ...head, n, levels: idx.map((a) => a.length), wide };
  const parts = [sub(P, 3, Int16Array), sub(Nn, 3, Int8Array), sub(reg, 1, Uint8Array), sub(ji, 4, Uint8Array), sub(W, 4, Uint8Array), sub(pal, 4, Uint8Array), sub(acc, 1, Uint8Array), ...idx];
  const hj = Buffer.from(JSON.stringify(h2));
  let size = 8 + hj.length + pad(hj.length);
  for (const p of parts) size += p.byteLength + pad(p.byteLength);
  const out = Buffer.alloc(size);
  out.write("EOP1", 0);
  out.writeUInt32LE(hj.length, 4);
  hj.copy(out, 8);
  let q = 8 + hj.length + pad(hj.length);
  for (const p of parts) {
    Buffer.from(p.buffer, p.byteOffset, p.byteLength).copy(out, q);
    q += p.byteLength + pad(p.byteLength);
  }
  writeFileSync(join(DIR, `op-${body}.lite.bin`), out);
  console.log(`op-${body}.lite.bin`, (out.length / 1024).toFixed(0), "KB;", n, "of", N, "vertices; triangles", idx.map((a) => a.length / 3).join(" / "));
}
