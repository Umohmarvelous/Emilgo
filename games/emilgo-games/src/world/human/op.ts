// The operators (v4 rework R2/R3): the CC0 Quaternius mannequins (male and
// female; only the female one is used since v5) as the bodies under the black tactical suit, and the CC0 Universal
// Animation Library's clips, both baked onto the game's skeleton by
// tools/anim/operator.mjs. Everyone in Free For All and the Dead Streets
// runner wears this body; the clips play on any body (the zombies' scans too).
//
// Files (op/): op-m.bin, op-f.bin (each body at the four detail levels, in the
// game's rest pose, a region per vertex for the suit shader: suit.ts) and
// op-clips.bin (per frame, each bone's local rotation and the hips' offset).
// Loaded at boot beside the scans; inlined in the EMILGO app's single file.

import { BufferAttribute, BufferGeometry, Quaternion, Sphere, Vector3 } from "three";

import type { BuiltBody, Detail } from "./mesh";
import { BONES, PROPORTIONS, type BoneName, type V3 } from "./skeleton";
import type { Body } from "./wardrobe";
import urlClips from "./op/op-clips.bin?url";
import urlDances from "./op/op-dances.bin?url";

/**
 * v5: one body for every operator, the female one (the owner: "hide the male 3d
 * model"), so the male body's file isn't even fetched. To bring it back: load
 * op-m here too and use `body` in operatorBody.
 *
 * The body's file: the EMILGO app's one-file copy carries the lite one (levels 0–2; tools/anim/lite.mjs).
 */
const bodyUrl = (): Promise<string> =>
  __HOST_BUILD__ === "emilgo" ? import("./op/op-f.lite.bin?url").then((f) => f.default) : import("./op/op-f.bin?url").then((f) => f.default);

/** The suit's regions (operator.mjs R). */
export const REGION = { suit: 0, seam: 1, glove: 2, boot: 3, head: 4, pad: 5, belt: 6, pocket: 7, band: 8, eye: 9, knuckle: 10, sole: 11 } as const;

interface OpBody {
  pos: Float32Array;
  nor: Int8Array;
  reg: Uint8Array;
  ji: Uint8Array;
  jw: Uint8Array;
  pal: Uint8Array;
  acc: Uint8Array;
  levels: (Uint16Array | Uint32Array)[];
  rest: Record<BoneName, V3>;
  built: (BuiltBody | undefined)[];
}

export interface MocapClip {
  name: string;
  fps: number;
  n: number;
  dur: number;
  loop: boolean;
  /** Where the left heel lands (0..1 of the loop) and the metres a loop covers. */
  phase0: number;
  stride: number;
  /** Packed rotations: n × keep. */
  q: Uint32Array;
  /** The hips' offset, 1/10000 m: n × 3. */
  hips: Int16Array;
}

const bodies: Partial<Record<Body, OpBody>> = {};
export const CLIPS: Record<string, MocapClip> = {};
/** Game bone index for each packed bone. */
let KEEP: number[] = [];
/** For each game bone, its place in a frame (−1: not carried). */
const SLOT = new Int16Array(BONES.length).fill(-1);
let ready = false;

async function fetchBin(url: string): Promise<{ head: any; buf: ArrayBuffer; at: number }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const buf = await r.arrayBuffer();
  const dv = new DataView(buf);
  const len = dv.getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, len)));
  return { head, buf, at: 8 + len + ((4 - (len % 4)) % 4) };
}

const pad4 = (n: number) => n + ((4 - (n % 4)) % 4);

function readBody(head: any, buf: ArrayBuffer, at: number): OpBody {
  const N: number = head.n;
  let o = at;
  const P = new Int16Array(buf, o, N * 3);
  o += pad4(P.byteLength);
  const nor = new Int8Array(buf, o, N * 3);
  o += pad4(nor.byteLength);
  const reg = new Uint8Array(buf, o, N);
  o += pad4(reg.byteLength);
  const ji = new Uint8Array(buf, o, N * 4);
  o += pad4(ji.byteLength);
  const jw = new Uint8Array(buf, o, N * 4);
  o += pad4(jw.byteLength);
  const pal = new Uint8Array(buf, o, N * 4);
  o += pad4(pal.byteLength);
  const acc = new Uint8Array(buf, o, N);
  o += pad4(acc.byteLength);
  const levels: (Uint16Array | Uint32Array)[] = [];
  for (const len of head.levels as number[]) {
    const a = head.wide ? new Uint32Array(buf, o, len) : new Uint16Array(buf, o, len);
    levels.push(a);
    o += pad4(a.byteLength);
  }
  const pos = new Float32Array(N * 3);
  const mn = head.mn as number[];
  const mx = head.mx as number[];
  for (let k = 0; k < N; k++) for (let c = 0; c < 3; c++) pos[k * 3 + c] = mn[c] + ((P[k * 3 + c] + 32768) / 65535) * (mx[c] - mn[c]);
  const rest = {} as Record<BoneName, V3>;
  for (const b of BONES) {
    const v = head.rest[b] as [number, number, number] | undefined;
    rest[b] = v ? { x: v[0], y: v[1], z: v[2] } : { x: 0, y: 0, z: 0 };
  }
  return { pos, nor, reg, ji, jw, pal, acc, levels, rest, built: [] };
}

/** BONES index of a name. */
const BI = (b: BoneName) => BONES.indexOf(b);

/**
 * v5 (3.5, the owner: "the thigh is too small, add some muscles to the thigh
 * and legs to match the entire body"): fuller thighs and calves, and a nose
 * for the open face. Done once on the body's own numbers, before any level is
 * built, so every level, every pose and every clip gets the same body.
 */
export function shapeBody(b: OpBody): OpBody {
  thickenLegs(b);
  return addNose(b);
}

/**
 * Each vertex on a leg bone moves out from the bone's line, by its weight on
 * that bone: the thighs most (fuller at the top and in front: the quads), the
 * calves bulging behind, the knee and the ankle left as they are.
 */
function thickenLegs(b: OpBody): void {
  const N = b.pos.length / 3;
  const segs: { bone: number; a: V3; z: V3; f: (t: number, front: number) => number }[] = [];
  for (const s of ["L", "R"] as const) {
    const thigh = b.rest[`thigh${s}`];
    const shin = b.rest[`shin${s}`];
    const foot = b.rest[`foot${s}`];
    // Thigh: +22% at the top, easing to +8% at the knee; +5% more in front (the quads).
    segs.push({ bone: BI(`thigh${s}`), a: thigh, z: shin, f: (t, front) => 0.22 - 0.14 * t + 0.05 * Math.max(0, front) });
    // Calf: a bulge behind, highest a third of the way down; the ankle untouched.
    segs.push({ bone: BI(`shin${s}`), a: shin, z: foot, f: (t, front) => (0.06 + 0.12 * Math.max(0, -front)) * Math.sin(Math.PI * Math.min(1, t * 1.15)) });
  }
  for (let k = 0; k < N; k++) {
    let dx = 0;
    let dy = 0;
    let dz = 0;
    const px = b.pos[k * 3];
    const py = b.pos[k * 3 + 1];
    const pz = b.pos[k * 3 + 2];
    for (let c = 0; c < 4; c++) {
      const w = b.jw[k * 4 + c] / 255;
      if (w <= 0) continue;
      const seg = segs.find((s) => s.bone === b.ji[k * 4 + c]);
      if (!seg) continue;
      const ax = seg.z.x - seg.a.x;
      const ay = seg.z.y - seg.a.y;
      const az = seg.z.z - seg.a.z;
      const l2 = ax * ax + ay * ay + az * az || 1;
      const t = Math.max(0, Math.min(1, ((px - seg.a.x) * ax + (py - seg.a.y) * ay + (pz - seg.a.z) * az) / l2));
      const rx = px - (seg.a.x + ax * t);
      const ry = py - (seg.a.y + ay * t);
      const rz = pz - (seg.a.z + az * t);
      const rl = Math.hypot(rx, ry, rz) || 1;
      const k2 = seg.f(t, rz / rl) * w;
      dx += rx * k2;
      dy += ry * k2;
      dz += rz * k2;
    }
    b.pos[k * 3] = px + dx;
    b.pos[k * 3 + 1] = py + dy;
    b.pos[k * 3 + 2] = pz + dz;
  }
}

/**
 * A nose (the mannequin's head has none): a small wedge on the face, on the
 * head bone, its own vertices added to every level. Painted as the suit
 * paints the face: skin where the face is open (suit.ts), the mask's knit
 * where it is closed, so the shape shows through the fabric either way.
 */
function addNose(b: OpBody): OpBody {
  const e = b.rest.eyeL;
  const f = b.rest.eyeR;
  const cx = (e.x + f.x) / 2;
  const cy = (e.y + f.y) / 2;
  // The face's surface on the midline under the eyes (the head's own vertices there sit ~9 mm before the eyeballs' centres).
  const cz = Math.max(e.z, f.z) + 0.009;
  // Bridge top, ridge, tip, the base under it, the wings (left, right), the sides of the ridge, under the base.
  const V: [number, number, number][] = [
    [0, -0.006, 0.0],
    [0, -0.026, 0.01],
    [0, -0.046, 0.021],
    [0, -0.056, 0.008],
    [0.013, -0.05, -0.003],
    [-0.013, -0.05, -0.003],
    [0.008, -0.03, 0.002],
    [-0.008, -0.03, 0.002],
    [0, -0.058, -0.002],
  ];
  // Faces: left side, right side, the underside; each both ways round (20 triangles: no culling surprises on a face this small).
  const one = [
    [0, 6, 1], [0, 1, 7], [1, 6, 4], [1, 4, 2], [1, 5, 7], [1, 2, 5],
    [2, 4, 3], [2, 3, 5], [3, 4, 8], [3, 8, 5],
  ];
  const T = [...one, ...one.map(([a2, b2, c2]) => [a2, c2, b2])];
  const N0 = b.pos.length / 3;
  const n = V.length;
  const grow = <A extends Float32Array | Int8Array | Uint8Array>(a: A, per: number, make: (len: number) => A): A => {
    const out = make(a.length + n * per);
    out.set(a);
    return out;
  };
  const pos = grow(b.pos, 3, (l) => new Float32Array(l));
  const nor = grow(b.nor, 3, (l) => new Int8Array(l));
  const reg = grow(b.reg, 1, (l) => new Uint8Array(l));
  const ji = grow(b.ji, 4, (l) => new Uint8Array(l));
  const jw = grow(b.jw, 4, (l) => new Uint8Array(l));
  const pal = grow(b.pal, 4, (l) => new Uint8Array(l));
  const acc = grow(b.acc, 1, (l) => new Uint8Array(l));
  // A head vertex's palette (the mask's colour and roughness) for the new ones.
  let src = 0;
  for (let k = 0; k < N0; k++) if (b.reg[k] === REGION.head) src = k;
  const head = BI("head");
  V.forEach(([x, y, z], i) => {
    const k = N0 + i;
    pos[k * 3] = cx + x;
    pos[k * 3 + 1] = cy + y;
    pos[k * 3 + 2] = cz + z;
    // Normals: forward, leaning to the side the vertex is on, down under the tip.
    const nx = x * 40;
    const ny = i === 3 || i === 8 ? -0.8 : 0.1;
    const nz = 0.8;
    const l = Math.hypot(nx, ny, nz);
    nor[k * 3] = Math.round((nx / l) * 127);
    nor[k * 3 + 1] = Math.round((ny / l) * 127);
    nor[k * 3 + 2] = Math.round((nz / l) * 127);
    reg[k] = REGION.head;
    ji[k * 4] = head;
    jw[k * 4] = 255;
    for (let c = 0; c < 4; c++) pal[k * 4 + c] = b.pal[src * 4 + c];
    acc[k] = 0;
  });
  // Every level gets the nose (it's 10 triangles); a level's indices grow by it.
  const levels = b.levels.map((lv) => {
    const wide = N0 + n > 65535 || lv instanceof Uint32Array;
    const out = wide ? new Uint32Array(lv.length + T.length * 3) : new Uint16Array(lv.length + T.length * 3);
    out.set(lv);
    T.forEach((tri, j) => tri.forEach((v, c) => (out[lv.length + j * 3 + c] = N0 + v)));
    return out;
  });
  return { ...b, pos, nor, reg, ji, jw, pal, acc, levels, built: [] };
}

let loading: Promise<void> | null = null;
/** Both bodies and the clips. Safe to call more than once. */
export function loadOperators(): Promise<void> {
  loading ??= Promise.all([
    bodyUrl().then((url) => fetchBin(url).then(({ head, buf, at }) => void (bodies.f = shapeBody(readBody(head, buf, at))))),
    fetchBin(urlClips).then(({ head, buf, at }) => {
      KEEP = head.keep;
      KEEP.forEach((b, j) => (SLOT[b] = j));
      let o = at;
      for (const c of head.clips as Omit<MocapClip, "q" | "hips">[]) {
        const q = new Uint32Array(buf, o, c.n * KEEP.length);
        o += pad4(q.byteLength);
        const hips = new Int16Array(buf, o, c.n * 3);
        o += pad4(hips.byteLength);
        CLIPS[c.name] = { ...c, q, hips };
      }
    }),
  ]).then(() => {
    ready = true;
    for (const fn of readyFns) fn();
    // v6 max (3.9): the dances, after (137 KB nobody needs before the first emote).
    void loadDances();
  });
  return loading;
}

let dancing: Promise<void> | null = null;
/** v6 max (3.9): the motion-captured dances (tools/anim/dances.mjs), into CLIPS beside the others. */
export function loadDances(): Promise<void> {
  dancing ??= fetchBin(urlDances)
    .then(({ head, buf, at }) => {
      // The same bones in the same order as the clips (both bakes keep every bone but the root and the face).
      if (head.keep.length !== KEEP.length) return;
      let o = at;
      for (const c of head.clips as Omit<MocapClip, "q" | "hips">[]) {
        const q = new Uint32Array(buf, o, c.n * KEEP.length);
        o += pad4(q.byteLength);
        const hips = new Int16Array(buf, o, c.n * 3);
        o += pad4(hips.byteLength);
        CLIPS[c.name] = { ...c, q, hips };
      }
    })
    .catch(() => {
      dancing = null;
    });
  return dancing;
}

const readyFns: (() => void)[] = [];
/** Called once when the bodies and clips have arrived. */
export function onOperatorsReady(fn: () => void): void {
  if (ready) fn();
  else readyFns.push(fn);
}

export function operatorsReady(): boolean {
  return ready;
}

/** The operator's body at a detail level (cached), as a BuiltBody the Human can wear. */
export function operatorBody(_body: Body, want: Detail): BuiltBody {
  const b = bodies.f!;
  // The app's lite files stop at level 2.
  const level = Math.min(want, b.levels.length - 1) as Detail;
  let built = b.built[level];
  if (built) return built;
  const g = new BufferGeometry();
  // Only the vertices this level uses (compacted), so the far level costs little.
  const src = b.levels[level];
  const map = new Int32Array(b.pos.length / 3).fill(-1);
  let n = 0;
  for (let k = 0; k < src.length; k++) if (map[src[k]] < 0) map[src[k]] = n++;
  const pos = new Float32Array(n * 3);
  const nor = new Int8Array(n * 3);
  const reg = new Uint8Array(n);
  const ji = new Uint8Array(n * 4);
  const jw = new Uint8Array(n * 4);
  const pal = new Uint8Array(n * 4);
  const acc = new Uint8Array(n);
  for (let k = 0; k < map.length; k++) {
    const m = map[k];
    if (m < 0) continue;
    for (let c = 0; c < 3; c++) {
      pos[m * 3 + c] = b.pos[k * 3 + c];
      nor[m * 3 + c] = b.nor[k * 3 + c];
    }
    reg[m] = b.reg[k];
    acc[m] = b.acc[k];
    for (let c = 0; c < 4; c++) {
      ji[m * 4 + c] = b.ji[k * 4 + c];
      jw[m * 4 + c] = b.jw[k * 4 + c];
      pal[m * 4 + c] = b.pal[k * 4 + c];
    }
  }
  const idx = n > 65535 ? new Uint32Array(src.length) : new Uint16Array(src.length);
  for (let k = 0; k < src.length; k++) idx[k] = map[src[k]];
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("normal", new BufferAttribute(nor, 3, true));
  g.setAttribute("region", new BufferAttribute(reg, 1));
  g.setAttribute("pal", new BufferAttribute(pal, 4, true));
  g.setAttribute("accent", new BufferAttribute(acc, 1, true));
  g.setAttribute("skinIndex", new BufferAttribute(ji, 4));
  g.setAttribute("skinWeight", new BufferAttribute(jw, 4, true));
  g.setIndex(new BufferAttribute(idx, 1));
  g.boundingSphere = new Sphere(new Vector3(0, 0.9, 0), 1.6);
  built = { geometry: g, rest: b.rest, prop: PROPORTIONS.f, scale: 1, triangles: src.length / 3 };
  b.built[level] = built;
  return built;
}

// ── Clips ───────────────────────────────────────────────────────────────────

const _a = new Quaternion();
const _b = new Quaternion();

function unpack(v: number, out: Quaternion): Quaternion {
  const big = v & 3;
  const c = [0, 0, 0, 0];
  let sh = 2;
  let s = 0;
  for (let k = 0; k < 4; k++) {
    if (k === big) continue;
    const u = (((v >>> sh) & 1023) / 1023 - 0.5) * 2 * Math.SQRT1_2;
    c[k] = u;
    s += u * u;
    sh += 10;
  }
  c[big] = Math.sqrt(Math.max(0, 1 - s));
  return out.set(c[0], c[1], c[2], c[3]);
}

/**
 * Sample a clip at `time` (looping clips wrap; others hold their ends) into
 * per-bone quaternions (`q`: BONES.length × 4) and the hips' offset, added in by
 * weight `w` (blend several clips by calling with weights summing to 1, then
 * normalise: mocapNormalise). Only bones in `mask` (or all when null).
 */
export function sampleClip(c: MocapClip, time: number, w: number, q: Float32Array, hips: Vector3 | null, mask: Uint8Array | null = null): void {
  if (w <= 0) return;
  let f = time * c.fps;
  if (c.loop) {
    const n = c.n - 1;
    f = ((f % n) + n) % n;
  } else f = Math.max(0, Math.min(c.n - 1, f));
  const f0 = Math.floor(f);
  const f1 = Math.min(c.n - 1, f0 + 1);
  const u = f - f0;
  const K = KEEP.length;
  for (let j = 0; j < K; j++) {
    const bi = KEEP[j];
    if (mask && !mask[bi]) continue;
    unpack(c.q[f0 * K + j], _a);
    unpack(c.q[f1 * K + j], _b);
    _a.slerp(_b, u);
    const o = bi * 4;
    // Keep every addition in one hemisphere so the blend doesn't cancel out.
    const d = q[o] * _a.x + q[o + 1] * _a.y + q[o + 2] * _a.z + q[o + 3] * _a.w;
    const s = d < 0 ? -w : w;
    q[o] += _a.x * s;
    q[o + 1] += _a.y * s;
    q[o + 2] += _a.z * s;
    q[o + 3] += _a.w * s;
  }
  if (hips) {
    const h0 = f0 * 3;
    const h1 = f1 * 3;
    hips.x += ((c.hips[h0] + (c.hips[h1] - c.hips[h0]) * u) / 10000) * w;
    hips.y += ((c.hips[h0 + 1] + (c.hips[h1 + 1] - c.hips[h0 + 1]) * u) / 10000) * w;
    hips.z += ((c.hips[h0 + 2] + (c.hips[h1 + 2] - c.hips[h0 + 2]) * u) / 10000) * w;
  }
}

/** Does this game bone come from the clips? */
export function carried(bi: number): boolean {
  return SLOT[bi] >= 0;
}
