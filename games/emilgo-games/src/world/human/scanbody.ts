// The scanned people: a hoodie and joggers over a real head, real hands and
// real feet (the only skin that shows).
//
// The head, hands and feet are cut from the high-detail scans offline
// (tools/scan: bake.mjs, then pack.mjs) at the four detail levels, with skin
// weights for the game's own skeleton (skeleton.ts) — so every pose, emote,
// action and fall in animator.ts plays on them unchanged. The clothes are
// generated here, like every other part of a person, from the body's
// measurements (also baked: the torso and legs, slice by slice).
//
// Everyone wears the hoodie: the lobby, the waiting room, the field. Only its
// colour and design change (wardrobe.ts HOODIE_COLORS, HOODIE_DESIGNS), so a
// whole room shares two shapes per detail level — one per body.
//
// Loading: each body is three small files (scan/). The base (far and Low
// levels, the face, the build, the head texture) loads at boot, before anyone
// is drawn; Medium and High follow in the background when the graphics tier
// draws them, and the people already standing switch up (index.ts
// refreshPeople). In the EMILGO app's single-file copy the files are inlined.

import { Vector3 } from "three";

import { Builder, LEVELS, blob, crs, smooth, sweep, type BuiltBody, type Detail, type TierSpec, type Weights } from "./mesh";
import { LID_CLOSE, PROPORTIONS, restPositions, type BoneName, type Proportions, type V3 } from "./skeleton";
import type { Body, Look } from "./wardrobe";
import baseM from "./scan/scan-m-base.bin?url";
import baseF from "./scan/scan-f-base.bin?url";
import medM from "./scan/scan-m-2.bin?url";
import medF from "./scan/scan-f-2.bin?url";
import highM from "./scan/scan-m-3.bin?url";
import highF from "./scan/scan-f-3.bin?url";

// ── Baked data ────────────────────────────────────────────────────────────────

interface Part {
  /** Positions relative to the part's anchor bone, normals, indices. */
  p: Float32Array;
  n: Float32Array;
  i: Uint16Array;
  /** Skin weights: bone names, then four (index into `j`, weight) per vertex. */
  j: string[];
  si: Uint8Array;
  sw: Float32Array;
  /** Head: lens-projected UVs (u wraps past 0..1 at the back seam). */
  uv?: Float32Array;
  /** Hands and feet: vertex colours, linear. */
  c?: Float32Array;
  /** Head: depth of the lip line at this level. */
  lipZ?: number;
}

type PartName = "head" | "handL" | "handR" | "footL" | "footR";

/** The face rig (bake.mjs): positions relative to the head anchor. eyes[0] is the right eye (−X). */
interface Face {
  /** Eyeball radius; the sphere the cut eye openings are wrapped onto. */
  R: number;
  rim: number;
  /** Eyeball centre; the opening's top and bottom (elevation, radians) and half-width (azimuth) seen from it. */
  eyes: { c: [number, number, number]; top: number; bot: number; az: number }[];
  /** Lid skin, linear. */
  lid: [number, number, number];
  jaw: [number, number, number];
  mouth: { mid: [number, number, number]; a: [number, number, number]; b: [number, number, number] };
}

interface Scan {
  /** By detail level; Medium and High arrive later. */
  levels: (Record<PartName, Part> | undefined)[];
  face?: Face;
  body?: Build;
  /** Finger bones relative to their hand (wrist). */
  bones: Record<string, [number, number, number]>;
}

const FILES: Record<Body, [base: string, medium: string, high: string]> = { m: [baseM, medM, highM], f: [baseF, medF, highF] };

const scans: Partial<Record<Body, Scan>> = {};
/** The baked head textures, painted into every look's texture (scanpaint.ts). */
export const headImages: Partial<Record<Body, HTMLImageElement>> = {};

interface PartMeta {
  nv: number;
  nt: number;
  ps: number;
  j: string[];
  uv?: [number, number];
  lipZ?: number;
  at: { p: number; n: number; i: number; si: number; sw: number; uv?: number; c?: number };
}
interface Header {
  v: number;
  body: Body;
  bones?: Record<string, [number, number, number]>;
  face?: Face;
  tex?: { at: number; len: number; type: string };
  build?: { dy: number; torso: { y0: number; rows: number; cols: number; at: number }; leg: { y0: number; rows: number; cols: number; at: number } };
  levels: Record<string, Record<PartName, PartMeta>>;
}

async function fetchFile(url: string): Promise<{ h: Header; buf: ArrayBuffer; at: number }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`scan ${r.status}`);
  const buf = await r.arrayBuffer();
  const tag = new Uint8Array(buf, 0, 4);
  if (String.fromCharCode(tag[0], tag[1], tag[2], tag[3]) !== "EGS1") throw new Error("scan: not a scan file");
  const len = new DataView(buf).getUint32(4, true);
  const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, len))) as Header;
  return { h, buf, at: 8 + len };
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** One part from its arrays (tools/scan/pack.mjs says how each is stored). */
function readPart(buf: ArrayBuffer, at: number, m: PartMeta): Part {
  const nv = m.nv;
  const q = new Int16Array(buf, at + m.at.p, nv * 3);
  const p = new Float32Array(nv * 3);
  for (let k = 0; k < p.length; k++) p[k] = q[k] * m.ps;
  const qn = new Int8Array(buf, at + m.at.n, nv * 3);
  const n = new Float32Array(nv * 3);
  for (let k = 0; k < n.length; k += 3) {
    const x = qn[k] / 127;
    const y = qn[k + 1] / 127;
    const z = qn[k + 2] / 127;
    const l = Math.hypot(x, y, z) || 1;
    n[k] = x / l;
    n[k + 1] = y / l;
    n[k + 2] = z / l;
  }
  const qw = new Uint8Array(buf, at + m.at.sw, nv * 4);
  const sw = new Float32Array(nv * 4);
  for (let k = 0; k < sw.length; k += 4) {
    const s = qw[k] + qw[k + 1] + qw[k + 2] + qw[k + 3] || 1;
    for (let c = 0; c < 4; c++) sw[k + c] = qw[k + c] / s;
  }
  const part: Part = { p, n, i: new Uint16Array(buf, at + m.at.i, m.nt * 3), j: m.j, si: new Uint8Array(buf, at + m.at.si, nv * 4), sw };
  if (m.uv && m.at.uv !== undefined) {
    const qu = new Uint16Array(buf, at + m.at.uv, nv * 2);
    const uv = new Float32Array(nv * 2);
    for (let k = 0; k < uv.length; k += 2) {
      uv[k] = m.uv[0] + qu[k] * m.uv[1];
      uv[k + 1] = qu[k + 1] / 65535;
    }
    part.uv = uv;
  }
  if (m.at.c !== undefined) {
    const qc = new Uint8Array(buf, at + m.at.c, nv * 3);
    part.c = Float32Array.from(qc, (v) => toLinear(v / 255));
  }
  if (m.lipZ !== undefined) part.lipZ = m.lipZ;
  return part;
}

function readLevels(scan: Scan, buf: ArrayBuffer, at: number, levels: Header["levels"]): void {
  for (const [L, parts] of Object.entries(levels)) {
    const out = {} as Record<PartName, Part>;
    for (const [name, m] of Object.entries(parts)) out[name as PartName] = readPart(buf, at, m);
    scan.levels[Number(L)] = out;
  }
}

/** Every level both bodies have (bit per level): part of each body's cache key, so a level arriving makes new shapes. */
let loaded = 0;

/** The base files, both bodies: await before the first person is drawn. Safe to call more than once. */
let booting: Promise<void> | null = null;
export function loadScans(): Promise<void> {
  booting ??= Promise.all(
    (["m", "f"] as const).map(async (b) => {
      const { h, buf, at } = await fetchFile(FILES[b][0]);
      const scan: Scan = { levels: [], face: h.face, bones: h.bones ?? {} };
      if (h.build) {
        const rows = (r: { rows: number; cols: number; at: number }) => {
          const q = new Int16Array(buf, at + r.at, r.rows * r.cols);
          return Array.from({ length: r.rows }, (_, i) => Array.from(q.subarray(i * r.cols, (i + 1) * r.cols), (v) => v / 10000));
        };
        scan.body = { dy: h.build.dy, torso: { y0: h.build.torso.y0, rings: rows(h.build.torso) }, leg: { y0: h.build.leg.y0, rings: rows(h.build.leg) } };
      }
      readLevels(scan, buf, at, h.levels);
      if (h.tex) {
        const url = URL.createObjectURL(new Blob([new Uint8Array(buf, at + h.tex.at, h.tex.len)], { type: h.tex.type }));
        const img = new Image();
        img.src = url;
        await img.decode();
        URL.revokeObjectURL(url);
        headImages[b] = img;
      }
      scans[b] = scan;
    }),
  ).then(() => {
    loaded = 0b11;
  });
  return booting;
}

const levelLoads = new Map<number, Promise<void>>();
const levelListeners: (() => void)[] = [];

/** A detail level (2 Medium, 3 High), both bodies, in the background. Resolves when the people can use it. */
export function loadScanLevel(level: 2 | 3): Promise<void> {
  let p = levelLoads.get(level);
  if (!p) {
    p = (booting ?? loadScans())
      .then(() => Promise.all((["m", "f"] as const).map(async (b) => {
        const { h, buf, at } = await fetchFile(FILES[b][level - 1]);
        readLevels(scans[b]!, buf, at, h.levels);
      })))
      .then(() => {
        loaded |= 1 << level;
        for (const fn of levelListeners) fn();
      })
      .catch((e) => {
        // A dropped connection: try again next time it's asked for.
        levelLoads.delete(level);
        throw e;
      });
    levelLoads.set(level, p);
  }
  return p;
}

/** Called whenever a new detail level has arrived. */
export function onScanLevel(fn: () => void): void {
  levelListeners.push(fn);
}

/** The levels loaded so far (0 until the base has): changes when a level arrives. */
export function scanStamp(): number {
  return loaded;
}

export function scanReady(): boolean {
  return loaded !== 0;
}

/** The best level at most `level` that both bodies have. */
function bestLevel(level: Detail): Detail {
  for (let l = level; l > 1; l--) if (loaded & (1 << l)) return l as Detail;
  return Math.min(level, 1) as Detail;
}

// ── Measurements ──────────────────────────────────────────────────────────────

/**
 * Joints placed on the scans: the wrists where the scanned hands begin, the
 * ankles where the feet begin, the skull base under the head. Arms hang a
 * little out from the body so the hands clear the hoodie.
 */
export const SCAN_PROPORTIONS: Record<Body, Proportions> = {
  m: {
    ...PROPORTIONS.m,
    hipY: 0.9,
    hipX: 0.095,
    thigh: 0.38,
    ankleY: 0.085,
    waistY: 1.06,
    chestY: 1.28,
    shoulderY: 1.43,
    shoulderX: 0.2,
    neckBaseY: 1.49,
    headBaseY: 1.57,
    upperArm: 0.31,
    foreArm: 0.26,
    armRest: 0.27,
  },
  f: {
    ...PROPORTIONS.f,
    hipY: 0.87,
    hipX: 0.1,
    thigh: 0.38,
    ankleY: 0.08,
    waistY: 1.075,
    chestY: 1.24,
    shoulderY: 1.35,
    shoulderX: 0.165,
    neckBaseY: 1.4,
    headBaseY: 1.465,
    upperArm: 0.27,
    foreArm: 0.235,
    armRest: 0.26,
  },
};

/**
 * Where each piece of the scan-body look lives on the texture. The head gets
 * the whole left half (the face is what people look at); the clothes share
 * the right half.
 */
export const SUV = {
  head: [0, 0, 0.5, 1],
  torso: [0.5, 0.5, 1, 1],
  armL: [0.5, 0.25, 0.625, 0.5],
  armR: [0.625, 0.25, 0.75, 0.5],
  hood: [0.75, 0.25, 1, 0.5],
  legL: [0.5, 0, 0.625, 0.25],
  legR: [0.625, 0, 0.75, 0.25],
  palette: [0.75, 0, 1, 0.25],
} as const;
/** The head's projected u runs −HEAD_PAD … 1 + HEAD_PAD across its rectangle (room for the back seam). */
export const HEAD_PAD = 0.05;

/** Solid cells in the palette block (8 × 4). */
export const SCELL = { hood: 0, pocket: 1, string: 2, tip: 3, inner: 4, cuff: 5, band: 6, mouth: 7, teeth: 8 } as const;
export function scellUv(cell: number): [number, number] {
  const [u0, v0, u1, v1] = SUV.palette;
  return [u0 + (((cell % 8) + 0.5) / 8) * (u1 - u0), v0 + ((Math.floor(cell / 8) + 0.5) / 4) * (v1 - v0)];
}

/** The body under the clothes (bake.mjs): per height, radii in n directions (back first, turning to +X); z from the neck ring. */
interface Build {
  dy: number;
  torso: { y0: number; rings: number[][] };
  leg: { y0: number; rings: number[][] };
}

/** Rings every dy from y0: each a centre depth and radii in n directions. */
interface Shape {
  y0: number;
  dy: number;
  n: number;
  cz: number[];
  r: number[][];
}

const TAU = Math.PI * 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** 0 → 1 over [a, b], 1 → 0 over [c, d]. */
const bell = (x: number, a: number, b: number, c: number, d: number) => smooth(a, b, x) * (1 - smooth(c, d, x));

function shapeR(s: Shape, y: number, phi: number): number {
  const fi = Math.max(0, Math.min(s.r.length - 1.001, (y - s.y0) / s.dy));
  const i = Math.floor(fi);
  const t = fi - i;
  let a = (phi / TAU) * s.n;
  a = ((a % s.n) + s.n) % s.n;
  const k = Math.floor(a);
  const u = a - k;
  const k1 = (k + 1) % s.n;
  const r0 = s.r[i][k] + (s.r[i][k1] - s.r[i][k]) * u;
  const r1 = s.r[i + 1][k] + (s.r[i + 1][k1] - s.r[i + 1][k]) * u;
  return r0 + (r1 - r0) * t;
}

function shapeZ(s: Shape, y: number): number {
  const fi = Math.max(0, Math.min(s.cz.length - 1.001, (y - s.y0) / s.dy));
  const i = Math.floor(fi);
  return s.cz[i] + (s.cz[i + 1] - s.cz[i]) * (fi - i);
}

/** A ring's convex hull, as radii per direction: cloth bridges the hollows (between the breasts, down the spine). */
function hull(r: number[]): number[] {
  const n = r.length;
  const pts = r.map((v, k) => [Math.sin((k / n) * TAU) * v, -Math.cos((k / n) * TAU) * v] as [number, number]);
  const sorted = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [];
  const hi: [number, number][] = [];
  for (const q of sorted) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of sorted.slice().reverse()) {
    while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop();
    hi.push(q);
  }
  const H = lo.slice(0, -1).concat(hi.slice(0, -1));
  return r.map((v, k) => {
    const dx = Math.sin((k / n) * TAU);
    const dz = -Math.cos((k / n) * TAU);
    let best = v;
    for (let i = 0; i < H.length; i++) {
      const a = H[i];
      const b = H[(i + 1) % H.length];
      const ex = b[0] - a[0];
      const ez = b[1] - a[1];
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = (a[0] * ez - a[1] * ex) / den;
      const u = (a[0] * dz - a[1] * dx) / den;
      if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.max(best, t);
    }
    return best;
  });
}

/** One pass of smoothing across directions and rings. */
function soften(r: number[][]): number[][] {
  const n = r[0].length;
  const a = r.map((row) => row.map((v, k) => (row[(k + n - 1) % n] + 2 * v + row[(k + 1) % n]) / 4));
  return a.map((row, i) => row.map((v, k) => (a[Math.max(0, i - 1)][k] + 2 * v + a[Math.min(a.length - 1, i + 1)][k]) / 4));
}

/** Her figure: a fuller bust and seat (added to the measured body). */
function figure(body: Body, y: number, phi: number): number {
  if (body !== "f") return 0;
  const front = -Math.cos(phi);
  const side = Math.abs(Math.sin(phi));
  const bust = bell(y, 1.12, 1.2, 1.22, 1.3) * smooth(0.55, 0.85, front) * (0.6 + 0.4 * smooth(0.15, 0.4, side)) * 0.013;
  const seat = bell(y, 0.77, 0.86, 0.9, 1.0) * smooth(0.45, 0.8, Math.cos(phi)) * 0.02;
  return bust + seat;
}

interface Fit {
  /** Hem and neck heights. */
  y0: number;
  y1: number;
  /** The rib band's height (it lines up with the painted band). */
  band: number;
  /** Room over the body; the band's own; how much the body blouses over the band. */
  ease: number;
  bandEase: number;
  blouse: number;
  /** Limb thickness multiplier. */
  limb: number;
}

function fitFor(p: Proportions, body: Body): Fit {
  // Hers is a little shorter and closer, so her shape shows; his roomier, like the photos.
  const f =
    body === "m"
      ? { y0: p.hipY - 0.065, y1: p.neckBaseY + 0.01, band: 0, ease: 0.03, bandEase: 0.012, blouse: 0.014, limb: 1 }
      : { y0: p.hipY + 0.015, y1: p.neckBaseY + 0.01, band: 0, ease: 0.016, bandEase: 0.008, blouse: 0.008, limb: 0.88 };
  // The painter's band is 65 mm of its 640 mm torso.
  f.band = (0.065 / 0.64) * (f.y1 - f.y0);
  return f;
}

const bodies = new Map<Body, { B: Shape; H: Shape; L: Shape }>();

/**
 * The measured body (with her figure), the hoodie's shape over it, and the
 * leg. Above the armpits a slice takes in the upper arms: there the body is
 * kept to the shoulders, narrowing to the neck. The hoodie's shape is the
 * body's convex hull per ring, hanging straight down from wherever it is
 * fullest (chest, belly, seat), softened.
 */
function shapesFor(body: Body, b: Build, p: Proportions, neckZ: number): { B: Shape; H: Shape; L: Shape } {
  const hit = bodies.get(body);
  if (hit) return hit;
  const n = b.torso.rings[0].length - 2;
  const ys = b.torso.rings.map((_, i) => b.torso.y0 + i * b.dy);
  const raw = b.torso.rings.map((row, i) => row.slice(2).map((r, k) => r + figure(body, ys[i], (k / n) * TAU)));
  const sideOf = (row: number[]) => Math.max(row[n / 4], row[(3 * n) / 4]);
  let pit = raw.findIndex((row, i) => i > 0 && ys[i] > 1.0 && sideOf(row) > sideOf(raw[i - 1]) + 0.03);
  if (pit < 0) pit = raw.length;
  const xA = pit < raw.length ? sideOf(raw[pit - 1]) + 0.005 : 0;
  const xS = p.shoulderX + 0.02;
  const xN = body === "m" ? 0.085 : 0.075;
  const clamped = raw.map((row, i) => {
    if (i < pit) return row;
    const y = ys[i];
    const xl = y <= p.shoulderY ? lerp(xA, xS, smooth(ys[pit], p.shoulderY, y)) : lerp(xS, xN, smooth(p.shoulderY, p.neckBaseY + 0.01, y));
    return row.map((r, k) => {
      const sx = Math.abs(Math.sin((k / n) * TAU));
      return sx > 0.15 && r * sx > xl ? xl / sx : r;
    });
  });
  const hulled = clamped.map(hull);
  const cz = b.torso.rings.map((row) => row[1] + neckZ);
  const B: Shape = { y0: b.torso.y0, dy: b.dy, n, cz, r: hulled };
  // Drape: from the top down, cloth falls at most 45 mm in for every 100 mm.
  const d = hulled.map((row) => row.slice());
  for (let i = d.length - 2; i >= 0; i--) for (let k = 0; k < n; k++) d[i][k] = Math.max(d[i][k], d[i + 1][k] - 0.45 * b.dy);
  const H: Shape = { y0: b.torso.y0, dy: b.dy, n, cz, r: soften(d) };
  const ln = b.leg.rings[0].length - 2;
  const L: Shape = { y0: b.leg.y0, dy: b.dy, n: ln, cz: b.leg.rings.map((row) => row[1] + neckZ), r: soften(b.leg.rings.map((row) => row.slice(2))) };
  const out = { B, H, L };
  bodies.set(body, out);
  return out;
}

/** The hoodie's radius: the shape, plus room; the band hugs, the body blouses just over it, neat at the neck. */
function hoodieR(H: Shape, f: Fit, y: number, phi: number): number {
  const top = f.y0 + f.band;
  let e = f.ease * (1 - 0.6 * smooth(f.y1 - 0.1, f.y1, y));
  e = lerp(f.bandEase, e, smooth(top - 0.012, top + 0.004, y));
  e += f.blouse * bell(y, top - 0.005, top + 0.02, top + 0.03, top + 0.09);
  return shapeR(H, y, phi) + e;
}

const dirOf = (phi: number, out: Vector3) => out.set(Math.sin(phi), 0, -Math.cos(phi));

// ── The body ──────────────────────────────────────────────────────────────────

const shapes = new Map<string, BuiltBody>();

export function buildScanBody(look: Look, level: Detail): BuiltBody {
  // Medium or High asked for before it has arrived: the best there is (index.ts rebuilds when it comes).
  const lv = bestLevel(level);
  const key = `${look.body}|${lv}`;
  let b = shapes.get(key);
  if (!b) {
    b = build(look.body, lv);
    shapes.set(key, b);
  }
  // Shared geometry; the look's height is the mesh's scale (index.ts).
  return { ...b, scale: look.height };
}

function build(body: Body, level: Detail): BuiltBody {
  const scan = scans[body]!;
  const p = SCAN_PROPORTIONS[body];
  const rest = restPositions(p);
  // Fingers where the scanned hands have them.
  for (const [name, off] of Object.entries(scan.bones)) {
    const hand = rest[(name.endsWith("L") ? "handL" : "handR") as BoneName];
    rest[name as BoneName] = { x: hand.x + off[0], y: hand.y + off[1], z: hand.z + off[2] };
  }
  const T = LEVELS[level];
  const f = fitFor(p, body);
  const { B, H, L } = shapesFor(body, scan.body!, p, rest.neck.z);
  const m = new Builder();

  hoodieBody(m, p, f, H, level);
  hood(m, f, H, level);
  for (const s of [1, -1] as const) {
    sleeve(m, rest, f, T, s, level);
    jogger(m, p, rest, f, B, L, T, s, level);
  }
  if (level >= 2) pocket(m, p, f, H, level);

  const parts = scan.levels[level]!;
  const head = parts.head;
  // The head sits on the neck where the scan had it: line its lowest ring up with the neck bone.
  let zb = 0;
  let nb = 0;
  let minY = Infinity;
  for (let i = 1; i < head.p.length; i += 3) minY = Math.min(minY, head.p[i]);
  for (let i = 0; i < head.p.length; i += 3) if (head.p[i + 1] < minY + 0.015) (zb += head.p[i + 2]), nb++;
  const dz = rest.neck.z - zb / nb;
  addPart(m, head, { x: rest.head.x, y: rest.head.y, z: rest.head.z + dz }, "head");
  if (scan.face) face(m, scan.face, rest, { x: rest.head.x, y: rest.head.y, z: rest.head.z + dz }, level, head);
  addPart(m, parts.handL, rest.handL);
  addPart(m, parts.handR, rest.handR);
  addPart(m, parts.footL, rest.footL);
  addPart(m, parts.footR, rest.footR);

  const geometry = m.build();
  return { geometry, rest, prop: p, scale: 1, triangles: m.idx.length / 3 };
}

const _p = new Vector3();
const _n = new Vector3();

function addPart(m: Builder, part: Part, at: V3, kind?: "head"): void {
  const base = m.count;
  const [u0, v0, u1, v1] = SUV.head;
  for (let k = 0; k < part.p.length / 3; k++) {
    _p.set(part.p[k * 3] + at.x, part.p[k * 3 + 1] + at.y, part.p[k * 3 + 2] + at.z);
    _n.set(part.n[k * 3], part.n[k * 3 + 1], part.n[k * 3 + 2]);
    const w: Weights = [];
    for (let q = 0; q < 4; q++) {
      const wt = part.sw[k * 4 + q];
      if (wt > 0) w.push([part.j[part.si[k * 4 + q]] as BoneName, wt]);
    }
    let u = 0;
    let v = 0;
    if (kind === "head" && part.uv) {
      u = u0 + ((part.uv[k * 2] + HEAD_PAD) / (1 + 2 * HEAD_PAD)) * (u1 - u0);
      v = v0 + part.uv[k * 2 + 1] * (v1 - v0);
    } else {
      // Skin parts read a white palette cell; their colour is the vertex colour.
      [u, v] = scellUv(SCELL.tip);
    }
    const c = part.c ? ([part.c[k * 3], part.c[k * 3 + 1], part.c[k * 3 + 2]] as const) : undefined;
    m.vert(_p, _n, u, v, w, c);
  }
  for (const i of part.i) m.idx.push(base + i);
}


// ── The face: eyes, lids, the inside of the mouth ────────────────────────────


type RGB = readonly [number, number, number];
const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// Eyeball colours, linear: a big dark-brown iris reads at a distance.
const PUPIL: RGB = [0.004, 0.003, 0.003];
const IRIS_IN: RGB = [0.075, 0.036, 0.016];
const IRIS_OUT: RGB = [0.028, 0.013, 0.006];
const SCLERA: RGB = [0.5, 0.45, 0.4];
const SCLERA_SIDE: RGB = [0.24, 0.2, 0.17];
const IRIS = 0.56;
const PUPIL_A = 0.19;

function face(m: Builder, f: Face, rest: Record<BoneName, V3>, at: V3, level: Detail, head: Part): void {
  const pos = (q: readonly number[]) => ({ x: at.x + q[0], y: at.y + q[1], z: at.z + q[2] });
  rest.jaw = pos(f.jaw);
  const bones: [BoneName, BoneName][] = [
    ["eyeR", "lidR"],
    ["eyeL", "lidL"],
  ];
  f.eyes.forEach((e, i) => {
    const [eye, lidB] = bones[i];
    rest[eye] = rest[lidB] = pos(e.c);
  });
  // The far level keeps the painted face.
  if (level === 0) return;
  f.eyes.forEach((e, i) => {
    const [eye, lidB] = bones[i];
    const c = new Vector3(rest[eye].x, rest[eye].y, rest[eye].z);
    eyeball(m, c, f.R, eye, level);
    lid(m, c, (f.R + f.rim) / 2, e, lidB, level, f.lid);
  });
  // How deep the lip line sits at this level (bake.mjs measures it on the cut).
  mouth(m, f, pos, level, at.z + (head.lipZ ?? f.mouth.mid[2]), head, at);
}

/** A sphere looking down +Z, its colours in rings (doubled rings keep the iris edge crisp). */
function eyeball(m: Builder, c: Vector3, R: number, bone: BoneName, level: Detail): void {
  const seg = [0, 8, 12, 16][level];
  const rings: [number, RGB][] =
    level >= 3
      ? [[PUPIL_A, PUPIL], [PUPIL_A, IRIS_IN], [0.38, mixc(IRIS_IN, IRIS_OUT, 0.5)], [IRIS, IRIS_OUT], [IRIS, SCLERA], [0.85, SCLERA], [1.2, mixc(SCLERA, SCLERA_SIDE, 0.5)], [1.65, SCLERA_SIDE]]
      : level === 2
        ? [[PUPIL_A, PUPIL], [PUPIL_A, IRIS_IN], [IRIS, IRIS_OUT], [IRIS, SCLERA], [1.0, SCLERA], [1.65, SCLERA_SIDE]]
        : [[IRIS * 0.85, IRIS_OUT], [IRIS, SCLERA], [1.1, SCLERA], [1.65, SCLERA_SIDE]];
  const [u, v] = scellUv(SCELL.tip);
  const w: Weights = [[bone, 1]];
  const pole = m.vert(new Vector3(c.x, c.y, c.z + R), new Vector3(0, 0, 1), u, v, w, level >= 2 ? PUPIL : IRIS_OUT);
  let prev: number[] = [];
  rings.forEach(([th, col], ri) => {
    const row: number[] = [];
    for (let j = 0; j < seg; j++) {
      const ph = (j / seg) * Math.PI * 2;
      _n.set(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th));
      _p.copy(c).addScaledVector(_n, R);
      row.push(m.vert(_p, _n, u, v, w, col));
    }
    for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg;
      if (ri === 0) m.tri(pole, row[j], row[j1]);
      else if (th !== rings[ri - 1][0]) {
        m.tri(prev[j], row[j], row[j1]);
        m.tri(prev[j], row[j1], prev[j1]);
      }
    }
    prev = row;
  });
}

/**
 * The upper lid: a skin patch on a sphere between the eyeball and the rim of
 * the cut opening. Open (rest), it sits above the opening, under the skin;
 * turning its bone LID_CLOSE about X brings its lower edge below the opening.
 */
function lid(m: Builder, c: Vector3, r: number, e: Face["eyes"][number], bone: BoneName, level: Detail, skin: RGB): void {
  const e0 = Math.max(e.top + 0.04, e.bot - 0.06 + LID_CLOSE);
  const e1 = e0 + LID_CLOSE + 0.14;
  const a = Math.min(1.5, e.az + 0.15);
  const cols = [0, 5, 7, 10][level];
  const rows = [0, 2, 3, 5][level];
  const [u, v] = scellUv(SCELL.tip);
  const w: Weights = [[bone, 1]];
  const lash = mixc(skin, [0, 0, 0], 0.85);
  const base = m.count;
  for (let i = 0; i <= rows; i++) {
    const t = Math.pow(i / rows, 1.4);
    // The lash line along the lower edge, the crease a little darker than the lid.
    const col = i === 0 ? lash : i === 1 ? mixc(skin, lash, 0.35) : skin;
    for (let j = 0; j <= cols; j++) {
      const az = -a + (2 * a * j) / cols;
      // The edge hangs lower towards the corners (they turn less as the lid shuts), like the opening's own almond.
      const el = e0 - 0.4 * (az / a) ** 2 * (1 - t) + (e1 - e0) * t;
      _n.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
      _p.copy(c).addScaledVector(_n, r);
      m.vert(_p, _n, u, v, w, col);
    }
  }
  const W = cols + 1;
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const k = base + i * W + j;
      m.tri(k, k + 1, k + W);
      m.tri(k + 1, k + W + 1, k + W);
    }
}

/** The dark inside of the mouth (top half with the head, bottom half with the jaw), and teeth on Medium and High. */
function mouth(m: Builder, f: Face, pos: (q: readonly number[]) => V3, level: Detail, lipZ: number, head: Part, at: V3): void {
  const mid = pos(f.mouth.mid);
  const half = Math.abs(f.mouth.b[0] - f.mouth.a[0]) / 2;
  // Its front 1 cm behind the lip line: the teeth fit between, and nothing shows through closed lips.
  const c = new Vector3(mid.x, mid.y - 0.001, lipZ - 0.01 - 0.014);
  const split = (q: Vector3): Weights => {
    const k = smooth(c.y - 0.004, c.y + 0.004, q.y);
    return [
      ["head", k],
      ["jaw", 1 - k],
    ];
  };
  const muv = scellUv(SCELL.mouth);
  // Wider than the lips (opened, the stretched corners still have it behind
  // them), curving back with the face; behindFace keeps it in.
  const bend = (x: number) => 14 * (x - c.x) ** 2;
  const base = m.count;
  blob(m, c, [half * 1.35, 0.013, 0.014], level <= 1 ? 5 : 7, level <= 1 ? 9 : 13, split, { uvAt: () => muv }, (p) => {
    p.z -= bend(p.x);
    // Deeper below: a wide-open jaw still has it behind the lower lip.
    if (p.y < c.y) p.y = c.y + (p.y - c.y) * 1.7;
  });
  behindFace(m, base, head, at, (x) => c.z - bend(x));
  if (level < 2) return;
  const tuv = scellUv(SCELL.teeth);
  const front = lipZ - 0.006;
  const strip = (y0: number, y1: number, dz: number, bone: BoneName) => {
    const cols = level >= 3 ? 8 : 5;
    const tw = half * 0.5;
    const base = m.count;
    for (let i = 0; i <= 1; i++)
      for (let j = 0; j <= cols; j++) {
        const x = -tw + (2 * tw * j) / cols;
        // The biting edge curves away towards the back teeth, so the row isn't a box.
        const edge = (x / tw) ** 2 * 0.0035;
        const y = bone === "head" ? (i ? y1 : y0 + edge) : i ? y1 - edge : y0;
        _p.set(mid.x + x, y, front + dz - 12 * x * x);
        _n.set(x * 20, 0, 1).normalize();
        m.vert(_p, _n, tuv[0], tuv[1], [[bone, 1]]);
      }
    const W = cols + 1;
    for (let j = 0; j < cols; j++) {
      m.tri(base + j, base + j + 1, base + W + j);
      m.tri(base + j + 1, base + W + j + 1, base + W + j);
    }
  };
  strip(mid.y - 0.005, mid.y + 0.003, 0, "head");
  strip(mid.y - 0.011, mid.y - 0.002, -0.0015, "jaw");
}

/**
 * Keep the inside of the mouth inside: any of its vertices (from `from` on)
 * in front of the face, or within 3 mm of it, is pulled back towards the
 * shape's middle (`mid`, depth at x). The face's front is the nearest-forward
 * head vertex round each spot (5 mm cells).
 */
function behindFace(m: Builder, from: number, head: Part, at: V3, mid: (x: number) => number): void {
  const C = 0.005;
  const front = new Map<string, number>();
  for (let k = 0; k < head.p.length; k += 3) {
    const key = `${Math.floor((head.p[k] + at.x) / C)},${Math.floor((head.p[k + 1] + at.y) / C)}`;
    const z = head.p[k + 2] + at.z;
    if (z > (front.get(key) ?? -Infinity)) front.set(key, z);
  }
  for (let i = from; i < m.count; i++) {
    const x = m.pos[i * 3];
    const y = m.pos[i * 3 + 1];
    let fz = Infinity;
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++) {
        const z = front.get(`${Math.floor(x / C) + a},${Math.floor(y / C) + b}`);
        if (z !== undefined) fz = Math.min(fz, z);
      }
    if (!Number.isFinite(fz)) continue;
    // Squeezed towards its own middle, never flattened past it (a flipped face would vanish).
    const z0 = mid(x);
    const z = m.pos[i * 3 + 2];
    const lim = Math.max(z0 + 0.001, fz - 0.003);
    if (z > lim) m.pos[i * 3 + 2] = z0 + (z - z0) * ((lim - z0) / (z - z0));
  }
}

// ── The hoodie ────────────────────────────────────────────────────────────────

/** A tube along a path, its radius a function of the way along (0 … 1) and the direction round (0 = back). */
function tube(
  m: Builder,
  pts: Vector3[],
  radius: (t: number, phi: number, c: Vector3) => number,
  seg: number,
  rings: number,
  weights: (q: Vector3, t: number) => Weights,
  uv: { rect: readonly [number, number, number, number]; vOf?: (t: number) => number } | { uvAt: (q: Vector3, t: number, phi: number) => [number, number] },
  opts: { prefer?: Vector3; capStart?: number; capEnd?: number; ts?: number[] } = {},
): void {
  const prefer = opts.prefer ?? new Vector3(0, 0, 1);
  const lens: number[] = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = lens[lens.length - 1];
  const tan = new Vector3();
  const nxt = new Vector3();
  sweep(m, {
    rings,
    ts: opts.ts,
    seg,
    ...("rect" in uv ? { rect: uv.rect, vOf: uv.vOf } : { uvAt: uv.uvAt }),
    weights: (q, t) => weights(q, t),
    capStart: opts.capStart,
    capEnd: opts.capEnd,
    frame: (t, fr) => {
      const d = t * total;
      let k = 0;
      while (k < pts.length - 2 && lens[k + 1] < d) k++;
      const ft = Math.max(0, Math.min(1, (d - lens[k]) / (lens[k + 1] - lens[k] || 1)));
      fr.c.lerpVectors(pts[k], pts[k + 1], ft);
      tan.subVectors(pts[k + 1], pts[k]).normalize();
      if (k + 2 < pts.length && ft > 0.7) tan.lerp(nxt.subVectors(pts[k + 2], pts[k + 1]).normalize(), (ft - 0.7) / 0.6).normalize();
      else if (k > 0 && ft < 0.3) tan.lerp(nxt.subVectors(pts[k], pts[k - 1]).normalize(), (0.3 - ft) / 0.6).normalize();
      fr.front.copy(prefer).addScaledVector(tan, -prefer.dot(tan)).normalize();
      fr.right.crossVectors(fr.front, tan).normalize();
      fr.rx = fr.rzF = fr.rzB = 1;
    },
    displace: (q, t, phi, fr) => {
      const r = radius(t, phi, fr.c);
      q.sub(fr.c).multiplyScalar(r).add(fr.c);
    },
  });
}

/** Body of the hoodie: hem band to the neck, on the measured body. Weighted like the generated torso, so it bends the same. */
function hoodieBody(m: Builder, p: Proportions, f: Fit, H: Shape, level: Detail): void {
  const R = [8, 11, 14, 24][level];
  const seg = [10, 12, 14, 20][level];
  // Rings evenly up the body, with three more where the band and the blousing turn.
  const tb = f.band / (f.y1 - f.y0);
  const ts = Array.from({ length: R - 3 }, (_, i) => i / (R - 4));
  ts.push(tb - 0.012, tb + 0.02, tb + 0.07);
  ts.sort((a, b) => a - b);
  sweep(m, {
    rings: ts.length,
    ts,
    seg,
    rect: SUV.torso,
    capStart: 0.0,
    frame: (t, fr) => {
      const y = f.y0 + (f.y1 - f.y0) * t;
      fr.c.set(0, y, shapeZ(H, y));
      fr.right.set(1, 0, 0);
      fr.front.set(0, 0, 1);
      fr.rx = fr.rzF = fr.rzB = 1;
    },
    displace: (q, t, phi, fr) => {
      const y = fr.c.y;
      q.copy(fr.c).addScaledVector(dirOf(phi, _d), hoodieR(H, f, y, phi));
      void t;
    },
    weights: (q) => torsoWeights(p, f, q),
  });
}
const _d = new Vector3();

function torsoWeights(p: Proportions, f: Fit, q: Vector3): Weights {
  const y = q.y;
  const w: Weights = [];
  const lower = 1 - smooth(p.waistY - 0.07, p.waistY + 0.05, y);
  const upper = smooth(p.chestY - 0.1, p.chestY + 0.02, y);
  w.push(["hips", lower], ["spine", Math.max(0, 1 - lower - upper)], ["chest", upper]);
  // The hem follows the thighs a little (a stride lifts it).
  const legPull = (1 - smooth(f.y0 + 0.02, p.hipY + 0.04, y)) * 0.35;
  if (legPull > 0) {
    const side = smooth(-0.05, 0.05, q.x);
    w[0][1] *= 1 - legPull;
    w.push(["thighL", legPull * side], ["thighR", legPull * (1 - side)]);
  }
  // Dropped shoulders follow the arms.
  const sh = smooth(p.shoulderY - 0.16, p.shoulderY - 0.03, y) * smooth(p.shoulderX * 0.5, p.shoulderX * 1.05, Math.abs(q.x));
  if (sh > 0) {
    const L = q.x > 0;
    for (const x of w) x[1] *= 1 - sh;
    w.push([L ? "clavL" : "clavR", sh * 0.5], [L ? "upperArmL" : "upperArmR", sh * 0.5]);
  }
  const nk = smooth(f.y1 - 0.05, f.y1, y) * 0.4;
  if (nk > 0) {
    for (const x of w) x[1] *= 1 - nk;
    w.push(["neck", nk]);
  }
  return w;
}

/**
 * The hood, down, as in both photos: it stands up round the back of the neck
 * (tallest behind, where it rises towards the head), its two edges cross
 * over in a V low at the front, and its bulk lies folded on the upper back.
 * The lining shows on the inside.
 */
function hood(m: Builder, f: Fit, H: Shape, level: Detail): void {
  const ny = f.y1 - 0.004;
  const cz = shapeZ(H, ny);
  const hoodCell = scellUv(SCELL.hood);
  const inner = scellUv(SCELL.inner);
  const n = [10, 14, 20, 28][level];
  const tall = f.limb < 1 ? 0.085 : 0.11;
  // The band's path: from just past the front on one side, round the back, to just past it on the other.
  const over = 0.42;
  const a0 = Math.PI - over;
  const a1 = 3 * Math.PI + over;
  const at = (t: number) => a0 + (a1 - a0) * t;
  const ends = (t: number) => smooth(0, 0.14, t) * (1 - smooth(0.86, 1, t));
  const radial = new Vector3();
  const up = new Vector3();
  sweep(m, {
    rings: n + 1,
    seg: level <= 1 ? 5 : level === 2 ? 7 : 9,
    uvAt: (_q, _t, phi) => (Math.sin(phi) < -0.2 ? inner : hoodCell),
    capStart: 0.004,
    capEnd: 0.004,
    frame: (t, fr) => {
      const a = at(t);
      const front = Math.max(0, -Math.cos(a));
      const back = Math.max(0, Math.cos(a));
      const e = ends(t);
      const h = (0.035 + (tall - 0.035) * (1 - front) * (0.75 + 0.25 * back)) * (0.55 + 0.45 * e);
      const rr = hoodieR(H, f, ny, a) * (1 - 0.1 * front) + 0.01 + 0.025 * back;
      dirOf(a, radial);
      // The top end of the crossing sits in front of the bottom one.
      const layer = t > 0.5 ? 0.007 * (1 - e) : 0;
      fr.c.set(0, ny + h / 2 - 0.06 * front ** 3, cz).addScaledVector(radial, rr + layer);
      // Leaning back a little where it stands behind the neck.
      up.set(0, 1, 0).addScaledVector(radial, 0.3 * back).normalize();
      fr.front.copy(up);
      fr.right.copy(radial);
      fr.rx = 0.012 + 0.004 * back;
      fr.rzF = fr.rzB = h / 2;
    },
    weights: (q) => {
      const nk = 0.35 * smooth(ny + 0.03, ny + 0.1, q.y);
      return [
        ["chest", 1 - nk],
        ["neck", nk],
      ];
    },
  });
  // The hood's bulk, folded on the upper back: a soft dome lying on the
  // hoodie (it follows the back's curve), wide where it meets the standing
  // part, rounding to a point between the shoulder blades.
  const rows = [3, 4, 6, 8][level];
  const cols = [4, 6, 8, 10][level];
  const yb = ny - (f.limb < 1 ? 0.19 : 0.22);
  const yt = ny - 0.004;
  const hw0 = f.limb < 1 ? 0.11 : 0.125;
  const grid: Vector3[][] = [];
  for (let i = 0; i <= rows; i++) {
    const v = i / rows;
    const y = yb + (yt - yb) * v;
    const hw = hw0 * (0.12 + 0.88 * Math.sin((Math.min(1, v / 0.72) * Math.PI) / 2));
    const rb = hoodieR(H, f, y, 0);
    const row: Vector3[] = [];
    for (let j = 0; j <= cols; j++) {
      const u = -1 + (2 * j) / cols;
      const phi = (u * hw) / rb;
      const edge = i === 0 || j === 0 || j === cols;
      const th = edge ? 0.0015 : 0.0015 + 0.03 * Math.pow(1 - u * u, 0.6) * smooth(0, 0.35, v);
      row.push(new Vector3(0, y, shapeZ(H, y)).addScaledVector(dirOf(phi, _d), hoodieR(H, f, y, phi) + th));
    }
    grid.push(row);
  }
  const base = m.count;
  const nrm = new Vector3();
  const du = new Vector3();
  const dv = new Vector3();
  for (let i = 0; i <= rows; i++)
    for (let j = 0; j <= cols; j++) {
      du.subVectors(grid[i][Math.min(cols, j + 1)], grid[i][Math.max(0, j - 1)]);
      dv.subVectors(grid[Math.min(rows, i + 1)][j], grid[Math.max(0, i - 1)][j]);
      nrm.crossVectors(dv, du).normalize();
      if (nrm.z > 0) nrm.negate();
      m.vert(grid[i][j], nrm, hoodCell[0], hoodCell[1], [["chest", 1]]);
    }
  const W = cols + 1;
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const k = base + i * W + j;
      // Seen from behind (−Z): wound the other way round to the front panels.
      m.tri(k, k + W, k + 1);
      m.tri(k + 1, k + W, k + W + 1);
    }
}

/** The kangaroo pocket: a panel a few mm proud of the front, its edges turned in, exactly where the painter draws it. */
function pocket(m: Builder, p: Proportions, f: Fit, H: Shape, level: Detail): void {
  const [r0, r1, r2, r3] = SUV.torso;
  const W = 1.12;
  const Ht = 0.64;
  const vb = 0.085 / Ht;
  const vt = 0.235 / Ht;
  const cols = level >= 3 ? 10 : 7;
  const rows = level >= 3 ? 5 : 3;
  const base = m.count;
  const q = new Vector3();
  for (let i = 0; i <= rows; i++) {
    const tv = i / rows;
    const v = vb + (vt - vb) * tv;
    // Wider at the bottom; the hand openings curve in towards the top.
    const hw = (0.15 - 0.055 * tv ** 1.8) / W;
    for (let j = 0; j <= cols; j++) {
      const u = 0.5 - hw + (2 * hw * j) / cols;
      const phi = u * TAU;
      const y = f.y0 + v * (f.y1 - f.y0);
      const edge = i === 0 || i === rows || j === 0 || j === cols;
      q.set(0, y, shapeZ(H, y)).addScaledVector(dirOf(phi, _d), hoodieR(H, f, y, phi) + (edge ? 0.0012 : 0.005));
      _n.copy(_d);
      m.vert(q, _n, r0 + 0.004 + u * (r2 - r0 - 0.008), r1 + 0.004 + v * (r3 - r1 - 0.008), torsoWeights(p, f, q));
    }
  }
  const Wn = cols + 1;
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const k = base + i * Wn + j;
      m.tri(k, k + 1, k + Wn);
      m.tri(k + 1, k + Wn + 1, k + Wn);
    }
}

/**
 * A full sleeve from the dropped shoulder, stacking in soft folds above a
 * long rib cuff that hugs the wrist (both photos).
 */
function sleeve(m: Builder, rest: Record<BoneName, V3>, f: Fit, T: TierSpec, s: 1 | -1, level: Detail): void {
  const L = s === 1 ? "L" : "R";
  const sh = rest[`upperArm${L}`];
  const el = rest[`foreArm${L}`];
  const wr = rest[`hand${L}`];
  const start = new Vector3(sh.x - s * 0.045, sh.y - 0.03, sh.z - 0.008);
  const elbow = new Vector3(el.x, el.y, el.z - 0.004);
  const wrist = new Vector3(wr.x + s * 0.002, wr.y - 0.045, wr.z);
  const along = new Vector3().subVectors(wrist, elbow).normalize();
  const cuffTop = wrist.clone().addScaledVector(along, -0.075);
  const k = f.limb;
  // Starts narrow, tucked under the dropped shoulder, then full.
  const radii = [0.056, 0.077, 0.077, 0.072, 0.068, 0.066, 0.067, 0.06].map((r) => r * k);
  const lenUp = start.distanceTo(elbow);
  const elbowT = lenUp / (lenUp + elbow.distanceTo(cuffTop));
  const folds = level >= 2;
  const armW = (top: number, bend: number): Weights => [
    [`clav${L}`, top * 0.45],
    [`upperArm${L}`, (1 - bend) * (1 - top * 0.45)],
    [`foreArm${L}`, bend],
  ];
  tube(
    m,
    [start, elbow, cuffTop.clone().addScaledVector(along, 0.012)],
    (t, phi) => {
      let r = crs(radii, t);
      // Stacked folds over the forearm (slanting, not rings), blousing over the cuff.
      if (folds) r *= 1 + 0.055 * Math.sin(((t - 0.68) / 0.3) * Math.PI * 3 + 1.1 * Math.sin(phi)) * bell(t, 0.66, 0.74, 0.92, 0.99);
      return r;
    },
    T.seg,
    Math.round(6 + 9 * Math.min(1, T.ringK)) + (folds ? (level >= 3 ? 6 : 3) : 0),
    (_q, t) => armW(1 - smooth(0, 0.12, t), smooth(elbowT - 0.07, elbowT + 0.07, t)),
    { rect: s === 1 ? SUV.armL : SUV.armR, vOf: (t) => 0.1 + 0.9 * (1 - t) },
    { capStart: 0 },
  );
  // The cuff (the rib at the bottom of the sleeve's paint).
  tube(
    m,
    [cuffTop, wrist],
    (t) => (0.043 - 0.006 * t) * k,
    T.seg,
    3,
    () => [[`foreArm${L}`, 1]],
    { rect: s === 1 ? SUV.armL : SUV.armR, vOf: (t) => 0.085 * (1 - t) },
  );
}

/**
 * Joggers on the measured legs and seat: each leg is a tube down its bones;
 * above the crotch it fills its half of the measured hips and seat (the two
 * meet in the middle), below it takes the leg's own measured shape, roomy
 * and gathered into a rib cuff over the ankle.
 */
function jogger(m: Builder, p: Proportions, rest: Record<BoneName, V3>, f: Fit, B: Shape, Lg: Shape, T: TierSpec, s: 1 | -1, level: Detail): void {
  const L = s === 1 ? "L" : "R";
  const hip = rest[`thigh${L}`];
  const knee = rest[`shin${L}`];
  const ankle = rest[`foot${L}`];
  const yC = Lg.y0 + Lg.dy * (Lg.r.length - 1) - 0.01;
  const top = new Vector3(hip.x, f.y0 + f.band * 0.5, shapeZ(B, f.y0));
  const kn = new Vector3(knee.x, knee.y, knee.z + 0.004);
  const end = new Vector3(ankle.x, ankle.y + 0.02, ankle.z + 0.012);
  const fitted = f.limb < 1 ? 0.6 : 1;
  const ease = (y: number) => (0.012 + 0.006 * bell(y, 0.35, 0.45, 0.5, 0.6)) * fitted + 0.01 * bell(y, end.y + 0.02, end.y + 0.05, end.y + 0.08, end.y + 0.12);
  const q = new Vector3();
  const dir = new Vector3();
  /** Above the crotch: from this tube's centre, out to the measured hips/seat (this side's half). */
  const half = (c: Vector3, phi: number): number => {
    dirOf(phi, dir);
    let r = 0.1;
    const czT = shapeZ(B, c.y);
    for (let it = 0; it < 6; it++) {
      q.copy(c).addScaledVector(dir, r);
      const dz = q.z - czT;
      const th = Math.atan2(q.x, -dz);
      r += shapeR(B, c.y, th) - Math.hypot(q.x, dz);
    }
    // Towards the middle: out to the front and back of the hips like any
    // other direction (the two legs overlap there, so the front is smooth),
    // but never more than 2 cm past the middle sideways; and past the middle
    // a little inside the other leg's surface, so each leg owns its own side.
    if (dir.x * s < 0) r = Math.min(r, (Math.abs(c.x) + 0.02) / Math.abs(dir.x));
    const xe = c.x + dir.x * r;
    if (xe * s < 0) r -= Math.min(0.012, Math.abs(xe) * 0.3);
    return Math.max(0.03, r);
  };
  const legR = (y: number, phi: number) => shapeR(Lg, y, s > 0 ? phi : TAU - phi);
  const lenTop = top.distanceTo(kn);
  const kneeT = lenTop / (lenTop + kn.distanceTo(end));
  tube(
    m,
    [top, kn, end],
    (_t, phi, c) => {
      const y = c.y;
      // Across the front of the crotch the cloth bridges from leg to leg (no cleft).
      const front = -Math.cos(phi);
      const inward = -Math.sin(phi) * s;
      const bridge = smooth(0.3, 0.8, front) * smooth(-0.3, 0.3, inward) * smooth(yC - 0.09, yC - 0.01, y);
      const k = Math.max(smooth(yC - 0.03, yC + 0.03, y), bridge);
      const below = legR(Math.min(y, yC), phi) + ease(y);
      const hipFill = (cc: Vector3) => half(cc, phi);
      const cuff = smooth(end.y + 0.035, end.y, y);
      // Close under the band (inside it), roomier below the hem.
      let r = below;
      if (k > 0) {
        const fill = hipFill(c) + lerp(0.002, 0.004 + 0.008 * fitted, smooth(f.y0 - 0.005, f.y0 - 0.04, y));
        // Below the crotch the bridge only ever adds cloth; above it the hips are the shape.
        r = lerp(below, y < yC ? Math.max(below, fill) : fill, k);
      }
      // Gathered into the cuff.
      return lerp(r, Math.max(0.046 * f.limb, legR(end.y, phi) + 0.006), cuff);
    },
    T.seg + (level >= 3 ? 4 : 0),
    Math.round(8 + 12 * Math.min(1, T.ringK)),
    (qq, t) => {
      const hipK = smooth(yC - 0.02, f.y0 + 0.03, qq.y);
      const bend = smooth(kneeT - 0.06, kneeT + 0.06, t);
      const an = smooth(0.95, 1, t) * 0.5;
      return [
        ["hips", hipK * 0.55],
        [`thigh${L}`, (1 - bend) * (1 - hipK * 0.55)],
        [`shin${L}`, bend * (1 - an)],
        [`foot${L}`, an],
      ];
    },
    { rect: s === 1 ? SUV.legL : SUV.legR, vOf: (t) => 1 - t },
  );
  void p;
}
