// The operators (v4 rework R2/R3): the CC0 Quaternius mannequins (male and
// female) as the bodies under the black tactical suit, and the CC0 Universal
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
import urlM from "./op/op-m.bin?url";
import urlF from "./op/op-f.bin?url";
import urlClips from "./op/op-clips.bin?url";

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

let loading: Promise<void> | null = null;
/** Both bodies and the clips. Safe to call more than once. */
export function loadOperators(): Promise<void> {
  loading ??= Promise.all([
    fetchBin(urlM).then(({ head, buf, at }) => void (bodies.m = readBody(head, buf, at))),
    fetchBin(urlF).then(({ head, buf, at }) => void (bodies.f = readBody(head, buf, at))),
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
  });
  return loading;
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
export function operatorBody(body: Body, level: Detail): BuiltBody {
  const b = bodies[body]!;
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
  built = { geometry: g, rest: b.rest, prop: PROPORTIONS[body], scale: 1, triangles: src.length / 3 };
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
