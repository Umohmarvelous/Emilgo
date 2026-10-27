// Pack a baked scan (bake.mjs JSON) into the small binary files the game loads.
//
//   node tools/scan/pack.mjs <man|woman>.json <m|f> <outDir>
//
// Per body, three files, so a phone downloads only the detail it draws:
//   scan-<b>-base.bin  the face rig, the build, finger bones, the head texture,
//                      and detail levels 0 (far) and 1 (Low)
//   scan-<b>-2.bin     level 2 (Medium)
//   scan-<b>-3.bin     level 3 (High)
//
// File layout: "EGS1", u32 length of a JSON header, the header, then the
// arrays, each starting on a 4-byte boundary. The header says where each
// array is (`at`: byte offset from the start of the arrays) and how it was
// quantised:
//   positions  Int16 × 3, metres = q × ps (ps per part)
//   normals    Int8 × 3, / 127
//   indices    Uint16 × 3 per triangle
//   skin       Uint8 × 4 bone slots (into the part's `j` names), Uint8 × 4 weights / 255
//   head uv    Uint16 × 2, u = u0 + q × us, v = q / 65535
//   colours    Uint8 × 3, sRGB (the game turns them back to linear)
//   build      Int16, metres × 10 000 (torso rings: cx, cz, 32 radii; leg: cx, cz, 24)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [inPath, b, outDir] = process.argv.slice(2);
if (!inPath || !/^[mf]$/.test(b ?? '') || !outDir) {
  console.error('usage: node pack.mjs <bake.json> <m|f> <outDir>');
  process.exit(1);
}
const scan = JSON.parse(readFileSync(inPath, 'utf8'));
mkdirSync(outDir, { recursive: true });

const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

class Blobs {
  constructor() { this.parts = []; this.size = 0; }
  add(typed) {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const at = this.size;
    this.parts.push(bytes);
    this.size += bytes.length;
    const pad = (4 - (this.size % 4)) % 4;
    if (pad) { this.parts.push(new Uint8Array(pad)); this.size += pad; }
    return at;
  }
}

function packPart(blobs, part) {
  const nv = part.p.length / 3;
  let max = 0;
  for (const v of part.p) max = Math.max(max, Math.abs(v));
  const ps = (max || 1) / 32767;
  const P = Int16Array.from(part.p, (v) => Math.round(v / ps));
  const N = Int8Array.from(part.n, (v) => Math.max(-127, Math.min(127, Math.round(v * 127))));
  if (nv > 65535) throw new Error('part too big for Uint16 indices');
  const I = Uint16Array.from(part.i);
  const SI = Uint8Array.from(part.si);
  const SW = Uint8Array.from(part.sw, (w) => Math.round(w * 255));
  const meta = { nv, nt: part.i.length / 3, ps, j: part.j, at: {} };
  meta.at.p = blobs.add(P);
  meta.at.n = blobs.add(N);
  meta.at.i = blobs.add(I);
  meta.at.si = blobs.add(SI);
  meta.at.sw = blobs.add(SW);
  if (part.uv) {
    let u0 = Infinity, u1 = -Infinity;
    for (let k = 0; k < part.uv.length; k += 2) { u0 = Math.min(u0, part.uv[k]); u1 = Math.max(u1, part.uv[k]); }
    const us = (u1 - u0 || 1) / 65535;
    const UV = new Uint16Array(part.uv.length);
    for (let k = 0; k < part.uv.length; k += 2) {
      UV[k] = Math.round((part.uv[k] - u0) / us);
      UV[k + 1] = Math.round(Math.max(0, Math.min(1, part.uv[k + 1])) * 65535);
    }
    meta.uv = [u0, us];
    meta.at.uv = blobs.add(UV);
  }
  if (part.c) {
    meta.at.c = blobs.add(Uint8Array.from(part.c, (v) => Math.round(Math.max(0, Math.min(1, linearToSrgb(v))) * 255)));
  }
  if (typeof part.lipZ === 'number') meta.lipZ = part.lipZ;
  return meta;
}

function packLevels(blobs, levels) {
  const out = {};
  for (const L of levels) out[L] = Object.fromEntries(Object.entries(scan.levels[L]).map(([k, p]) => [k, packPart(blobs, p)]));
  return out;
}

function write(name, header, blobs) {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const headLen = 8 + json.length;
  const pad = (4 - (headLen % 4)) % 4;
  const buf = Buffer.alloc(headLen + pad + blobs.size);
  buf.write('EGS1', 0, 'ascii');
  buf.writeUInt32LE(json.length + pad, 4);
  json.copy(buf, 8);
  buf.fill(0x20, 8 + json.length, headLen + pad); // pad the JSON with spaces
  let o = headLen + pad;
  for (const p of blobs.parts) { buf.set(p, o); o += p.length; }
  writeFileSync(join(outDir, name), buf);
  console.log(`${name}: ${(buf.length / 1024).toFixed(1)} KB`);
}

// ── Base: everything the far and Low levels need ──
{
  const blobs = new Blobs();
  const tex = Buffer.from(scan.headTex.split(',')[1], 'base64');
  const texAt = blobs.add(new Uint8Array(tex));
  const q = (rows) => Int16Array.from(rows.flat(), (v) => Math.round(v * 10000));
  const build = scan.body;
  const torsoAt = blobs.add(q(build.torso.rings));
  const legAt = blobs.add(q(build.leg.rings));
  const header = {
    v: 1,
    body: b,
    bones: scan.bones,
    face: scan.face,
    tex: { at: texAt, len: tex.length, type: 'image/webp' },
    build: {
      dy: build.dy,
      torso: { y0: build.torso.y0, rows: build.torso.rings.length, cols: build.torso.rings[0].length, at: torsoAt },
      leg: { y0: build.leg.y0, rows: build.leg.rings.length, cols: build.leg.rings[0].length, at: legAt },
    },
    levels: packLevels(blobs, [0, 1]),
  };
  write(`scan-${b}-base.bin`, header, blobs);
}
for (const L of [2, 3]) {
  const blobs = new Blobs();
  write(`scan-${b}-${L}.bin`, { v: 1, body: b, levels: packLevels(blobs, [L]) }, blobs);
}
