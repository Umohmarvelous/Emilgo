// A person's body, generated: one smooth, skinned mesh per look and tier.
//
// Everything is swept: a body part is a run of elliptical rings along a path
// (the torso up the spine, a leg from hip to ankle, a finger from knuckle to
// tip, even the head, pole to pole). Rings give smooth normals, clean UVs for
// the painter, and natural skin weights: a ring's weight is just how far along
// its bone chain it sits.
//
// Detail levels (SPEC-V2 §5.2, §6.3): the tiers' people are Low ≈ 2,000
// triangles, Medium ≈ 3,500 and High ≤ 5,000, all with fingers and ears; a
// fourth, "far" level (≈ 1,000, mitten hands) is only ever drawn at a distance
// (world/human/lod.ts). A tier's near level is tier + 1.

import { BufferGeometry, Float32BufferAttribute, Sphere, Uint16BufferAttribute, Vector3 } from "three";

import { CELL, HEAD_EPS, HEAD_GRID, UV, cellUv, headElevation, headWarpU, headWarpV, type Rect } from "./layout";
import { BONE_INDEX, FINGER_LENGTH, PROPORTIONS, restPositions, type BoneName, type Proportions, type V3 } from "./skeleton";
import { OUTFIT_BY_ID, type HairId, type Look, type Outfit } from "./wardrobe";
import { buildScanBody, scanReady } from "./scanbody";

export type Tier = 0 | 1 | 2;
/** Geometry detail: 0 far, 1 Low, 2 Medium, 3 High. */
export type Detail = 0 | 1 | 2 | 3;

/** The detail a tier draws people at up close. */
export function nearDetail(tier: Tier): Detail {
  return (tier + 1) as Detail;
}

export interface TierSpec {
  seg: number; // vertices around a limb
  torsoSeg: number;
  ringK: number; // ring density multiplier
  head: readonly [rings: number, seg: number];
  fingers: boolean;
  ears: boolean;
  detail: boolean; // gear pouches, laces, finger segments
}

export const LEVELS: TierSpec[] = [
  { seg: 6, torsoSeg: 10, ringK: 0.5, head: HEAD_GRID[0], fingers: false, ears: false, detail: false },
  { seg: 8, torsoSeg: 12, ringK: 0.62, head: HEAD_GRID[1], fingers: true, ears: true, detail: false },
  { seg: 10, torsoSeg: 16, ringK: 1.2, head: HEAD_GRID[2], fingers: true, ears: true, detail: false },
  { seg: 12, torsoSeg: 18, ringK: 1.16, head: HEAD_GRID[3], fingers: true, ears: true, detail: true },
];

export type Weights = [BoneName, number][];

// ── Mesh builder ──────────────────────────────────────────────────────────────

export class Builder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  /** Vertex colours (linear), only once a part asks for them (scanned hands and feet). */
  col: number[] | null = null;
  readonly si: number[] = [];
  readonly sw: number[] = [];
  readonly idx: number[] = [];

  get count(): number {
    return this.pos.length / 3;
  }

  vert(p: Vector3, n: Vector3, u: number, v: number, w: Weights, c?: readonly [number, number, number]): number {
    if (c && !this.col) this.col = new Array(this.pos.length).fill(1);
    if (this.col) this.col.push(c ? c[0] : 1, c ? c[1] : 1, c ? c[2] : 1);
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    // Keep the four strongest, normalised.
    const top = w.filter((x) => x[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    let sum = 0;
    for (const t of top) sum += t[1];
    for (let i = 0; i < 4; i++) {
      const t = top[i];
      this.si.push(t ? BONE_INDEX[t[0]] : 0);
      this.sw.push(t ? t[1] / (sum || 1) : 0);
    }
    return this.count - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new Float32BufferAttribute(this.uv, 2));
    g.setAttribute("skinIndex", new Uint16BufferAttribute(this.si, 4));
    g.setAttribute("skinWeight", new Float32BufferAttribute(this.sw, 4));
    if (this.col) g.setAttribute("color", new Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.boundingSphere = new Sphere(new Vector3(0, 0.9, 0), 1.25);
    return g;
  }
}

export interface Frame {
  c: Vector3;
  /** Unit vectors across the ring: `right` and `front` (front gets rzF). */
  right: Vector3;
  front: Vector3;
  rx: number;
  rzF: number;
  rzB: number;
}

interface SweepOpts {
  rings: number;
  seg: number;
  frame: (t: number, out: Frame) => void;
  weights: (p: Vector3, t: number, phi: number) => Weights;
  /** Atlas rectangle (u around from the back seam, v along) … */
  rect?: Rect;
  uOf?: (j: number, seg: number) => number;
  vOf?: (t: number) => number;
  /** … or a per-vertex UV (palette parts). */
  uvAt?: (p: Vector3, t: number, phi: number) => [number, number];
  displace?: (p: Vector3, t: number, phi: number, f: Frame) => void;
  /** Close the ends with a cone of this depth (0 = flat). Undefined = open. */
  capStart?: number;
  capEnd?: number;
  /** Ring parameters (0..1); default uniform. */
  ts?: number[];
}

const _f: Frame = { c: new Vector3(), right: new Vector3(1, 0, 0), front: new Vector3(0, 0, 1), rx: 0, rzF: 0, rzB: 0 };
const _p = new Vector3();
const _n = new Vector3();
const _a = new Vector3();
const _b = new Vector3();

/** UV margin inside each atlas rectangle (≈ 4 texels at 1024). */
const UV_INSET = 0.004;

/** Sweep rings along a path. The workhorse. */
export function sweep(m: Builder, o: SweepOpts): void {
  const rings = o.ts ?? Array.from({ length: o.rings }, (_, i) => i / (o.rings - 1));
  const R = rings.length;
  const S = o.seg;
  const P: Vector3[][] = [];
  const centers: Vector3[] = [];
  const tangents: Vector3[] = [];
  for (let i = 0; i < R; i++) {
    const t = rings[i];
    o.frame(t, _f);
    centers.push(_f.c.clone());
    const row: Vector3[] = [];
    for (let j = 0; j <= S; j++) {
      const phi = ((j % S) / S) * Math.PI * 2;
      const sn = Math.sin(phi);
      const cs = Math.cos(phi);
      const rz = cs < 0 ? _f.rzF : _f.rzB;
      const p = _f.c.clone().addScaledVector(_f.right, sn * _f.rx).addScaledVector(_f.front, -cs * rz);
      o.displace?.(p, t, phi, _f);
      row.push(p);
    }
    P.push(row);
  }
  for (let i = 0; i < R; i++) {
    const a = centers[Math.max(0, i - 1)];
    const b = centers[Math.min(R - 1, i + 1)];
    tangents.push(b.clone().sub(a).normalize());
  }

  const base = m.count;
  for (let i = 0; i < R; i++) {
    const t = rings[i];
    for (let j = 0; j <= S; j++) {
      const p = P[i][j];
      // Normal: cross of the two grid directions (wrapping around the ring).
      const jm = j === 0 ? S - 1 : j - 1;
      const jp = j === S ? 1 : j + 1;
      _a.subVectors(P[i][jp], P[i][jm]);
      _b.subVectors(P[Math.min(R - 1, i + 1)][j], P[Math.max(0, i - 1)][j]);
      _n.crossVectors(_b, _a);
      if (_n.lengthSq() < 1e-14) _n.copy(tangents[i]).multiplyScalar(i === 0 ? -1 : 1);
      _n.normalize();
      // Outward: away from the ring's centre.
      _p.subVectors(p, centers[i]);
      if (_p.lengthSq() > 1e-12 && _n.dot(_p) < 0) _n.negate();
      const phi = ((j % S) / S) * Math.PI * 2;
      let u: number;
      let v: number;
      if (o.uvAt) {
        [u, v] = o.uvAt(p, t, phi);
      } else {
        // Inset from the rectangle's edges: mipmaps blend neighbouring
        // regions, which would draw a skin-coloured line down a back seam.
        const r = o.rect!;
        const iu = Math.min(UV_INSET, (r[2] - r[0]) * 0.05);
        const iv = Math.min(UV_INSET, (r[3] - r[1]) * 0.05);
        u = r[0] + iu + (o.uOf ? o.uOf(j, S) : j / S) * (r[2] - r[0] - 2 * iu);
        v = r[1] + iv + (o.vOf ? o.vOf(t) : t) * (r[3] - r[1] - 2 * iv);
      }
      m.vert(p, _n, u, v, o.weights(p, t, phi));
    }
  }
  // Faces, wound outward (checked once on the first quad).
  const W = S + 1;
  let flip = false;
  {
    const a = P[0][0];
    const b = P[0][1];
    const c = P[Math.min(1, R - 1)][0];
    _a.subVectors(b, a);
    _b.subVectors(c, a);
    _n.crossVectors(_a, _b);
    _p.subVectors(a, centers[0]).add(_p.clone().subVectors(c, centers[Math.min(1, R - 1)]));
    if (_n.dot(_p) < 0) flip = true;
  }
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < S; j++) {
      const a = base + i * W + j;
      const b = a + 1;
      const c = a + W;
      const d = c + 1;
      if (flip) {
        m.tri(a, c, b);
        m.tri(b, c, d);
      } else {
        m.tri(a, b, c);
        m.tri(b, d, c);
      }
    }
  }
  // Caps.
  const cap = (ring: number, depth: number, dir: number) => {
    const t = rings[ring];
    const ctr = centers[ring].clone().addScaledVector(tangents[ring], dir * depth);
    const nrm = tangents[ring].clone().multiplyScalar(dir);
    let u: number;
    let v: number;
    if (o.uvAt) [u, v] = o.uvAt(ctr, t, 0);
    else {
      const r = o.rect!;
      u = (r[0] + r[2]) / 2;
      v = r[1] + (o.vOf ? o.vOf(t) : t) * (r[3] - r[1]);
    }
    const ci = m.vert(ctr, nrm, u, v, o.weights(ctr, t, 0));
    const r0 = base + ring * W;
    for (let j = 0; j < S; j++) {
      // Winding consistent with the side faces: outward along `dir`.
      const a = r0 + j;
      const b = r0 + j + 1;
      _a.subVectors(P[ring][j + 1], P[ring][j]);
      _b.subVectors(ctr, P[ring][j]);
      _n.crossVectors(_a, _b);
      if (_n.dot(nrm) >= 0) m.tri(a, b, ci);
      else m.tri(b, a, ci);
    }
  };
  if (o.capStart !== undefined) cap(0, o.capStart, -1);
  if (o.capEnd !== undefined) cap(R - 1, o.capEnd, 1);
}

// ── Small helpers ─────────────────────────────────────────────────────────────

export const v3 = (p: V3) => new Vector3(p.x, p.y, p.z);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Catmull-Rom through a list of numbers at even spacing. */
export function crs(vals: readonly number[], t: number): number {
  const n = vals.length - 1;
  const x = clamp01(t) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const f = x - i;
  const p0 = vals[Math.max(0, i - 1)];
  const p1 = vals[i];
  const p2 = vals[i + 1];
  const p3 = vals[Math.min(n, i + 2)];
  return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
}

/** Two perpendicular unit vectors across a tangent, `front` kept as close to `prefer` as possible. */
function across(tangent: Vector3, prefer: Vector3, right: Vector3, front: Vector3): void {
  front.copy(prefer).addScaledVector(tangent, -prefer.dot(tangent));
  if (front.lengthSq() < 1e-8) front.set(0, 1, 0).addScaledVector(tangent, -tangent.y);
  front.normalize();
  right.crossVectors(front, tangent).normalize();
}

const UP = new Vector3(0, 1, 0);
const FWD = new Vector3(0, 0, 1);

/** A straight-ish rod between points, radii along it. */
export function rod(
  m: Builder,
  pts: Vector3[],
  radii: readonly number[],
  seg: number,
  rings: number,
  weights: SweepOpts["weights"],
  uv: { rect: Rect; vOf?: (t: number) => number } | { uvAt: SweepOpts["uvAt"] },
  opts: { prefer?: Vector3; flatten?: number; capStart?: number; capEnd?: number; zF?: readonly number[]; zB?: readonly number[] } = {},
): void {
  const prefer = opts.prefer ?? FWD;
  const lens: number[] = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = lens[lens.length - 1];
  const tan = new Vector3();
  sweep(m, {
    rings,
    seg,
    ...("rect" in uv ? { rect: uv.rect, vOf: uv.vOf } : { uvAt: uv.uvAt }),
    weights,
    capStart: opts.capStart,
    capEnd: opts.capEnd,
    frame: (t, f) => {
      const d = t * total;
      let k = 0;
      while (k < pts.length - 2 && lens[k + 1] < d) k++;
      const seglen = lens[k + 1] - lens[k] || 1;
      const ft = clamp01((d - lens[k]) / seglen);
      f.c.lerpVectors(pts[k], pts[k + 1], ft);
      // Tangent blended across joints for a smooth bend.
      tan.subVectors(pts[k + 1], pts[k]).normalize();
      if (k + 2 < pts.length && ft > 0.7) {
        const nxt = new Vector3().subVectors(pts[k + 2], pts[k + 1]).normalize();
        tan.lerp(nxt, (ft - 0.7) / 0.6).normalize();
      } else if (k > 0 && ft < 0.3) {
        const prv = new Vector3().subVectors(pts[k], pts[k - 1]).normalize();
        tan.lerp(prv, (0.3 - ft) / 0.6).normalize();
      }
      across(tan, prefer, f.right, f.front);
      const r = crs(radii, t);
      f.rx = r * (opts.flatten ?? 1);
      f.rzF = r * (opts.zF ? crs(opts.zF, t) : 1);
      f.rzB = r * (opts.zB ? crs(opts.zB, t) : 1);
    },
  });
}

/** An ellipsoid (a squashed sphere), poles along `axis`. */
export function blob(
  m: Builder,
  center: Vector3,
  radii: [number, number, number],
  rings: number,
  seg: number,
  weights: SweepOpts["weights"],
  uv: { rect: Rect; uOf?: SweepOpts["uOf"]; vOf?: SweepOpts["vOf"] } | { uvAt: SweepOpts["uvAt"] },
  displace?: SweepOpts["displace"],
): void {
  const [rx, ry, rz] = radii;
  const eps = HEAD_EPS;
  sweep(m, {
    rings,
    seg,
    ...("rect" in uv ? { rect: uv.rect, uOf: uv.uOf, vOf: uv.vOf } : { uvAt: uv.uvAt }),
    weights,
    displace,
    capStart: ry * (1 - Math.cos(eps)),
    capEnd: ry * (1 - Math.cos(eps)),
    frame: (t, f) => {
      const th = Math.PI - eps - t * (Math.PI - 2 * eps); // bottom → top
      f.c.set(center.x, center.y + Math.cos(th) * ry, center.z);
      f.right.set(1, 0, 0);
      f.front.set(0, 0, 1);
      f.rx = Math.sin(th) * rx;
      f.rzF = f.rzB = Math.sin(th) * rz;
    },
  });
}

/** A torus (watch band, earring, glasses rim): ring of radius R around `axis`. */
function torus(m: Builder, center: Vector3, axis: Vector3, R: number, r: number, seg: number, weights: Weights, cell: number): void {
  const uv = cellUv(cell);
  const a = new Vector3();
  const b = new Vector3();
  across(axis.clone().normalize(), Math.abs(axis.y) > 0.9 ? FWD : UP, a, b);
  const n = Math.max(6, seg);
  const pts: Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * Math.PI * 2;
    pts.push(center.clone().addScaledVector(a, Math.cos(th) * R).addScaledVector(b, Math.sin(th) * R));
  }
  rod(m, pts, [r, r], 4, n + 1, () => weights, { uvAt: () => uv });
}

const W1 = (b: BoneName): Weights => [[b, 1]];

// ── The body ──────────────────────────────────────────────────────────────────

export interface BuiltBody {
  geometry: BufferGeometry;
  rest: Record<BoneName, V3>;
  prop: Proportions;
  /** Scale applied to everything (the look's height). */
  scale: number;
  triangles: number;
}

/** Hard triangle ceilings per level (SPEC-V2 §5.2, §6.3: High never above 5,000). */
const CAP = [1500, 2400, 3600, 5000] as const;

/**
 * Build a body at a detail level. Heavy looks (tactical gear plus a gele and
 * glasses) are rebuilt with fewer rings until they fit the level's ceiling;
 * the head grid never changes, so the painted face still fits.
 */
export function buildBody(look: Look, level: Detail): BuiltBody {
  if (!look.doll && scanReady()) return buildScanBody(look, level);
  let T = LEVELS[level];
  for (let k = 0; ; k++) {
    const b = buildWith(look, T);
    if (b.triangles <= CAP[level] || k >= 6) return b;
    T = { ...T, ringK: T.ringK * 0.85, seg: Math.max(6, T.seg - 1), torsoSeg: Math.max(10, T.torsoSeg - 2), detail: k >= 1 ? false : T.detail };
  }
}

function buildWith(look: Look, T: TierSpec): BuiltBody {
  const prop = PROPORTIONS[look.body];
  const rest = restPositions(prop);
  const outfit = OUTFIT_BY_ID[look.outfit];
  const m = new Builder();

  torso(m, prop, rest, outfit, T);
  neckAndHead(m, prop, rest, T);
  for (const s of [1, -1] as const) {
    arm(m, prop, rest, outfit, T, s, look);
    leg(m, prop, rest, outfit, T, s);
    foot(m, prop, rest, outfit, T, s);
  }
  if (outfit.bottom.kind === "skirt" || outfit.bottom.kind === "dress") skirt(m, prop, outfit, T);
  if (outfit.gear) gear(m, prop, rest, outfit, T);
  hair(m, prop, look.hair, T);
  for (const e of look.extras) extra(m, prop, rest, e, T);

  const geometry = m.build();
  return { geometry, rest, prop, scale: look.height, triangles: m.idx.length / 3 };
}

// Torso: crotch to neck base. Thighs and arms hold on to the edges so a bent
// leg or a raised arm pulls the skin with it instead of tearing it.
function torso(m: Builder, p: Proportions, rest: Record<BoneName, V3>, o: Outfit, T: TierSpec): void {
  const rings = p.torso;
  const y0 = rings[0][0];
  const y1 = rings[rings.length - 1][0];
  const ys = rings.map((r) => r[0]);
  const bulk = o.top.bulk ?? 0;
  const n = Math.round(lerp(6, 16, T.ringK / 1.9) + 2);
  sweep(m, {
    rings: n,
    seg: T.torsoSeg,
    rect: UV.torso,
    capStart: 0.02,
    frame: (t, f) => {
      // Rings interpolated by HEIGHT (uneven key spacing).
      const y = lerp(y0, y1, t);
      let k = 0;
      while (k < ys.length - 2 && ys[k + 1] < y) k++;
      const ft = clamp01((y - ys[k]) / (ys[k + 1] - ys[k]));
      const tt = (k + ft) / (ys.length - 1);
      const add = y > p.waistY - 0.02 ? bulk * smooth(p.waistY - 0.04, p.waistY + 0.04, y) * (1 - smooth(y1 - 0.08, y1, y)) : 0;
      f.c.set(0, y, 0);
      f.right.set(1, 0, 0);
      f.front.set(0, 0, 1);
      f.rx = crs(rings.map((r) => r[1]), tt) + add;
      f.rzF = crs(rings.map((r) => r[2]), tt) + add;
      f.rzB = crs(rings.map((r) => r[3]), tt) + add;
    },
    weights: (q) => {
      const y = q.y;
      const w: Weights = [];
      const lower = 1 - smooth(p.waistY - 0.07, p.waistY + 0.05, y);
      const upper = smooth(p.chestY - 0.1, p.chestY + 0.02, y);
      const mid = 1 - lower - upper;
      w.push(["hips", lower], ["spine", Math.max(0, mid)], ["chest", upper]);
      // Hips/glutes follow the thighs a little.
      const legPull = (1 - smooth(p.hipY - 0.06, p.hipY + 0.08, y)) * 0.55;
      if (legPull > 0) {
        const side = smooth(-0.04, 0.06, q.x);
        w[0][1] *= 1 - legPull;
        w.push(["thighL", legPull * side], ["thighR", legPull * (1 - side)]);
      }
      // Shoulder caps follow the arms.
      const sh = smooth(p.shoulderY - 0.12, p.shoulderY - 0.02, y) * smooth(p.shoulderX * 0.45, p.shoulderX * 0.95, Math.abs(q.x));
      if (sh > 0) {
        const L = q.x > 0;
        for (const x of w) x[1] *= 1 - sh;
        w.push([L ? "clavL" : "clavR", sh * 0.55], [L ? "upperArmL" : "upperArmR", sh * 0.45]);
      }
      // Neck base.
      const nk = smooth(y1 - 0.04, y1, y) * 0.5;
      if (nk > 0) {
        for (const x of w) x[1] *= 1 - nk;
        w.push(["neck", nk]);
      }
      return w;
    },
  });
  void rest;
}

// Head: an ellipsoid shaped into a face — jaw, chin, cheekbones, brow, nose,
// lips — by gentle displacement. The face itself is painted (paint.ts) at the
// same angles used here: FACE below.

/** Face landmarks, as (azimuth from the front, elevation from the head centre), radians. */
export const FACE = {
  eyeAz: 0.36,
  eyeEl: 0.1,
  browEl: 0.24,
  noseEl: -0.12,
  mouthEl: -0.43,
  chinEl: -0.72,
} as const;

function neckAndHead(m: Builder, p: Proportions, rest: Record<BoneName, V3>, T: TierSpec): void {
  const nb = rest.neck;
  const hb = rest.head;
  const skin = cellUv(CELL.skin);
  // Neck: from inside the torso into the head.
  rod(
    m,
    [new Vector3(0, nb.y - 0.05, nb.z - 0.005), new Vector3(0, hb.y + 0.035, hb.z - 0.012)],
    [p.neck * 1.12, p.neck * 0.95, p.neck],
    T.seg,
    Math.max(3, Math.round(4 * T.ringK)),
    (q) => {
      const t = clamp01((q.y - (nb.y - 0.05)) / (hb.y + 0.035 - (nb.y - 0.05)));
      return [["chest", 1 - smooth(0, 0.35, t)], ["neck", smooth(0, 0.35, t) * (1 - smooth(0.7, 1, t))], ["head", smooth(0.7, 1, t)]];
    },
    { uvAt: () => skin },
    { prefer: FWD },
  );

  const [hx, hy, hz] = p.head;
  const c = new Vector3(0, p.headY, 0.008);
  const [rings, seg] = T.head;
  // Seg must be even so the face centre (phi = π) is a vertex column.
  const headUv = { rect: UV.head, uOf: (j: number, S: number) => headWarpU((j / S) * Math.PI * 2), vOf: (t: number) => headWarpV(headElevation(t)) };
  blob(m, c, [hx, hy, hz], rings, seg, () => W1("head"), headUv, (q, _t, phi) => {
    // Local spherical coordinates.
    const lx = q.x - c.x;
    const ly = q.y - c.y;
    const lz = q.z - c.z;
    const el = Math.asin(Math.max(-1, Math.min(1, ly / hy)));
    const az = phi - Math.PI; // 0 = straight ahead
    const front = Math.max(0, Math.cos(az));
    // Jaw: narrower and tucked below the cheekbones, a defined chin.
    const jaw = smooth(-0.25, -0.95, el);
    const sideNarrow = 1 - jaw * 0.12 * Math.abs(Math.sin(az));
    // A fuller lower face: an ellipsoid's bottom is a point, a jaw isn't.
    const ce = Math.max(0.06, Math.cos(el));
    const full = el < 0 ? 1 + (Math.pow(ce, 0.72) / ce - 1) * smooth(-0.1, -0.7, el) : 1;
    q.x = c.x + lx * sideNarrow * Math.min(full, 1.6);
    q.z = c.z + lz * (1 - jaw * 0.08 * (1 - front)) * Math.min(full, 1.45);
    // Back of the skull a little fuller, forehead upright.
    if (lz < 0) q.z -= smooth(-0.4, 0.4, el) * 0.012 * (1 - front);
    // Bumps on the face, by distance in (az, el).
    const bump = (az0: number, el0: number, sa: number, se: number, h: number) => {
      const da = (az - az0) / sa;
      const de = (el - el0) / se;
      return h * Math.exp(-(da * da + de * de));
    };
    let out = 0;
    out += bump(0, FACE.noseEl + 0.06, 0.13, 0.17, 0.02); // nose bridge → tip
    out += bump(0, FACE.noseEl - 0.04, 0.22, 0.08, 0.008); // nostrils, broad
    out += bump(0, FACE.mouthEl, 0.26, 0.09, 0.008); // lips
    out += bump(0, FACE.chinEl, 0.3, 0.12, 0.006); // chin
    out += bump(FACE.eyeAz, FACE.browEl, 0.25, 0.06, 0.004) + bump(-FACE.eyeAz, FACE.browEl, 0.25, 0.06, 0.004); // brow
    out -= bump(FACE.eyeAz, FACE.eyeEl, 0.14, 0.08, 0.006) + bump(-FACE.eyeAz, FACE.eyeEl, 0.14, 0.08, 0.006); // sockets
    out += bump(0.75, FACE.noseEl, 0.35, 0.2, 0.004) + bump(-0.75, FACE.noseEl, 0.35, 0.2, 0.004); // cheekbones
    if (out !== 0) {
      _p.set(q.x - c.x, q.y - c.y, q.z - c.z).normalize();
      q.addScaledVector(_p, out);
    }
  });

  if (T.ears) {
    for (const s of [1, -1]) {
      const ear = new Vector3(s * hx * 0.97, p.headY - 0.006, c.z - 0.012);
      blob(m, ear, [0.008, 0.029, 0.018], 4, 6, () => W1("head"), { uvAt: () => skin });
    }
  }
}

function arm(m: Builder, p: Proportions, rest: Record<BoneName, V3>, o: Outfit, T: TierSpec, s: 1 | -1, look: Look): void {
  const L = s === 1 ? "L" : "R";
  const sh = v3(rest[`upperArm${L}`]);
  const el = v3(rest[`foreArm${L}`]);
  const wr = v3(rest[`hand${L}`]);
  const start = sh.clone().add(new Vector3(-s * 0.04, -0.004, 0));
  const bulk = o.top.sleeve === "long" ? (o.top.bulk ?? 0) * 0.6 : 0;
  const r = p.arm.map((x, i) => x + (i < 4 ? bulk : bulk * 0.5));
  const lenUp = start.distanceTo(el);
  const lenAll = lenUp + el.distanceTo(wr);
  const elbowT = lenUp / lenAll;
  const gloves = !!o.gear;
  rod(
    m,
    [start, el, wr.clone().add(new Vector3(0, -0.01, 0))],
    [r[0] * 0.92, r[0], r[1], r[2], r[3], r[4]],
    T.seg,
    Math.round(lerp(5, 14, T.ringK / 1.9)),
    (q) => {
      const t = clamp01(((start.y - q.y) / (start.y - wr.y)) * 1);
      const top = 1 - smooth(0.0, 0.12, t);
      const elbow = smooth(elbowT - 0.06, elbowT + 0.06, t);
      const wrist = smooth(0.95, 1.0, t);
      return [
        [`clav${L}`, top * 0.4],
        [`upperArm${L}`, (1 - elbow) * (1 - top * 0.4)],
        [`foreArm${L}`, elbow * (1 - wrist)],
        [`hand${L}`, wrist],
      ];
    },
    { rect: s === 1 ? UV.armL : UV.armR, vOf: (t) => 1 - t },
    { prefer: FWD, zB: [1.05, 1.08, 1, 1.06, 1, 0.95] },
  );
  hand(m, p, rest, T, s, gloves);
  void look;
}

function hand(m: Builder, p: Proportions, rest: Record<BoneName, V3>, T: TierSpec, s: 1 | -1, gloves: boolean): void {
  const L = s === 1 ? "L" : "R";
  const wr = v3(rest[`hand${L}`]);
  const uv = cellUv(gloves ? CELL.gloves : CELL.skin);
  const knY = wr.y - p.palm;
  // Palm: flat across X, wide across Z.
  rod(
    m,
    [wr.clone().add(new Vector3(0, 0.012, 0)), new Vector3(wr.x + s * 0.004, knY + (T.fingers ? 0.004 : -p.finger * 0.75), wr.z + 0.002)],
    T.fingers ? [0.022, 0.03, 0.033, 0.03] : [0.022, 0.032, 0.03, 0.022],
    T.fingers ? Math.max(6, T.seg - 2) : 6,
    T.fingers ? 4 : 4,
    (q) => {
      const t = clamp01((wr.y - q.y) / p.palm);
      return [[`foreArm${L}`, 1 - smooth(0, 0.25, t)], [`hand${L}`, smooth(0, 0.25, t)]];
    },
    { uvAt: () => uv },
    // front = +Z, so `flatten` thins the palm across X: palms face the thighs.
    { flatten: 0.45, capEnd: T.fingers ? 0.003 : 0.012 },
  );
  // Thumb.
  const t1 = v3(rest[`thumb1${L}`]);
  const t2 = v3(rest[`thumb2${L}`]);
  const tip = t2.clone().add(new Vector3(-s * 0.003, -0.025, 0.018));
  rod(
    m,
    [t1, t2, tip],
    [0.012, 0.0105, 0.0095, 0.008],
    T.fingers ? 6 : 5,
    T.fingers ? 5 : 3,
    (q) => {
      const d = q.distanceTo(t1);
      const k = smooth(0.025, 0.04, d);
      return [[`hand${L}`, 1 - smooth(0, 0.012, d)], [`thumb1${L}`, smooth(0, 0.012, d) * (1 - k)], [`thumb2${L}`, k]];
    },
    { uvAt: () => uv },
    { capEnd: 0.005, capStart: 0 },
  );
  if (!T.fingers) return;
  const names = ["index", "middle", "ring", "pinky"] as const;
  names.forEach((n, i) => {
    const k1 = v3(rest[`${n}1${L}`]);
    const k2 = v3(rest[`${n}2${L}`]);
    const len = p.finger * FINGER_LENGTH[i];
    const tip = new Vector3(k1.x, k1.y - len, k1.z);
    const r = i === 3 ? 0.0072 : 0.0085;
    rod(
      m,
      [k1.clone().add(new Vector3(0, 0.006, 0)), k2, tip],
      [r, r * 0.95, r * 0.88, r * 0.78],
      T.detail ? 6 : 5,
      T.detail ? 6 : 4,
      (q) => {
        const d = k1.y - q.y;
        const mid = smooth(-0.004, 0.006, q.distanceTo(k2) < 0.012 ? k2.y - q.y : d - (k1.y - k2.y));
        return [[`hand${L}`, 1 - smooth(-0.004, 0.004, d)], [`${n}1${L}`, smooth(-0.004, 0.004, d) * (1 - mid)], [`${n}2${L}`, mid]];
      },
      { uvAt: () => uv },
      { capEnd: 0.0045, flatten: 0.9 },
    );
  });
}

function leg(m: Builder, p: Proportions, rest: Record<BoneName, V3>, o: Outfit, T: TierSpec, s: 1 | -1): void {
  const L = s === 1 ? "L" : "R";
  const hip = v3(rest[`thigh${L}`]);
  const knee = v3(rest[`shin${L}`]);
  const ankle = v3(rest[`foot${L}`]);
  const top = hip.clone().add(new Vector3(-s * 0.012, 0.07, -0.005));
  const kind = o.bottom.kind;
  const loose = kind === "cargo" ? 0.014 : kind === "trousers" ? 0.008 : kind === "jeans" ? 0.004 : 0;
  const boots = o.shoes.kind === "boots";
  const r = p.leg.map((x, i) => x + loose * (i < 4 ? 1 : 0.6) + (boots && i >= 3 ? 0.012 : 0));
  const lenTop = top.distanceTo(knee);
  const lenAll = lenTop + knee.distanceTo(ankle);
  const kneeT = lenTop / lenAll;
  rod(
    m,
    [top, knee, ankle.clone().add(new Vector3(0, -0.015, 0))],
    [r[0] * 1.08, r[0], r[1] * 1.04, r[1], r[2], r[3] * 1.04, r[4]],
    T.seg,
    Math.round(lerp(6, 16, T.ringK / 1.9)),
    (q) => {
      const t = clamp01((top.y - q.y) / (top.y - ankle.y));
      const hipK = 1 - smooth(0.0, 0.12, t);
      const kn = smooth(kneeT - 0.05, kneeT + 0.05, t);
      const an = smooth(0.94, 1.0, t);
      return [["hips", hipK * 0.45], [`thigh${L}`, (1 - kn) * (1 - hipK * 0.45)], [`shin${L}`, kn * (1 - an)], [`foot${L}`, an]];
    },
    { rect: s === 1 ? UV.legL : UV.legR, vOf: (t) => 1 - t },
    // Calves bulge at the back, thighs at the front.
    { prefer: FWD, zF: [1.05, 1.08, 1.04, 0.98, 0.95, 0.95, 1], zB: [1, 0.98, 0.95, 1.15, 1.2, 1.02, 1] },
  );
  if (o.gear?.pads) {
    const pad = knee.clone().add(new Vector3(0, -0.01, r[1] * 0.95));
    blob(m, pad, [0.05, 0.055, 0.022], 4, 8, () => W1(`shin${L}`), { uvAt: () => cellUv(CELL.pads) });
  }
}

function foot(m: Builder, p: Proportions, rest: Record<BoneName, V3>, o: Outfit, T: TierSpec, s: 1 | -1): void {
  const L = s === 1 ? "L" : "R";
  const an = v3(rest[`foot${L}`]);
  const [len, w, h] = p.foot;
  const kind = o.shoes.kind;
  const heel = kind === "heels" ? 0.065 : 0;
  const sole = kind === "sneakers" ? 0.022 : kind === "boots" ? 0.02 : 0.012;
  const back = an.z - 0.055;
  const front = back + len;
  const seg = Math.max(6, T.seg - 1);
  // The shoe: heel → toe, flat underneath, a rounded upper.
  rod(
    m,
    [new Vector3(an.x, h * 0.5 + heel, back), new Vector3(an.x + s * 0.004, h * 0.5 + heel * 0.6, back + len * 0.45), new Vector3(an.x + s * 0.008, h * 0.42, front)],
    [w * 0.85, w, w * 1.05, w * 0.92, w * 0.6],
    seg,
    Math.round(lerp(4, 9, T.ringK / 1.9)),
    (q) => {
      const t = clamp01((q.z - back) / len);
      return [[`shin${L}`, (1 - smooth(0, 0.3, t)) * 0.3], [`foot${L}`, 1 - (1 - smooth(0, 0.3, t)) * 0.3]];
    },
    {
      uvAt: (q) => {
        const groundY = heel * (1 - clamp01((q.z - back) / (len * 0.6)));
        const isSole = q.y < groundY + sole + 0.002;
        if (kind === "sandals" && !isSole) return cellUv(q.z > back + len * 0.55 || Math.abs(q.z - (back + len * 0.3)) < 0.015 ? CELL.strap : CELL.skin);
        return cellUv(isSole ? CELL.sole : CELL.shoe);
      },
    },
    {
      prefer: UP,
      capStart: 0.02,
      capEnd: 0.03,
      zF: [1.1, 1.0, 0.95, 0.8, 0.7],
      zB: [0.55, 0.5, 0.5, 0.5, 0.45],
    },
  );
  if (heel > 0) {
    // A slim heel under the back.
    rod(m, [new Vector3(an.x, heel + 0.01, back + 0.012), new Vector3(an.x, 0.002, back + 0.008)], [0.009, 0.005], 5, 2, () => W1(`foot${L}`), {
      uvAt: () => cellUv(CELL.sole),
    }, { capEnd: 0 });
  }
  if (kind === "boots") {
    const sh = v3(rest[`shin${L}`]);
    rod(
      m,
      [new Vector3(an.x, h * 0.6, an.z - 0.005), new Vector3(an.x, an.y + (sh.y - an.y) * 0.45, an.z + 0.002)],
      [p.leg[4] + 0.02, p.leg[3] + 0.022],
      T.seg,
      3,
      (q) => [[`foot${L}`, 1 - smooth(0.1, 0.2, q.y)], [`shin${L}`, smooth(0.1, 0.2, q.y)]],
      { uvAt: () => cellUv(CELL.shoe) },
      { capEnd: 0 },
    );
  }
}

/** Where a skirt or dress's lower part starts and ends (metres). */
export function skirtSpan(p: Proportions, o: Outfit): [topY: number, hemY: number] {
  const b = o.bottom;
  const topY = b.kind === "dress" ? p.hipY + 0.06 : p.waistY - 0.01;
  const hemY = b.length === "knee" ? p.hipY - p.thigh - 0.02 : b.length === "calf" ? p.hipY - p.thigh - 0.17 : p.hipY - p.thigh * 0.55;
  return [topY, hemY];
}

function skirt(m: Builder, p: Proportions, o: Outfit, T: TierSpec): void {
  const b = o.bottom;
  const [topY, hemY] = skirtSpan(p, o);
  const flare = b.flare ?? 0;
  const ring = p.torso;
  // Hip size at the skirt's top, from the torso rings.
  const at = (y: number, k: 1 | 2 | 3) => {
    let i = 0;
    while (i < ring.length - 2 && ring[i + 1][0] < y) i++;
    const f = clamp01((y - ring[i][0]) / (ring[i + 1][0] - ring[i][0]));
    return lerp(ring[i][k], ring[i + 1][k], f);
  };
  const legSpan = p.hipX + p.leg[1] + 0.012;
  // The top ring sits just INSIDE the torso, so no gap shows at the waist.
  const hx0 = at(topY, 1) - 0.003;
  const hzf0 = at(topY, 2) - 0.003;
  const hzb0 = at(topY, 3) - 0.003;
  const hipMax = Math.max(at(p.hipY, 1), legSpan) + 0.012;
  sweep(m, {
    rings: Math.round(lerp(4, 10, T.ringK / 1.9)),
    seg: T.torsoSeg,
    rect: UV.skirt,
    vOf: (t) => 1 - t,
    frame: (t, f) => {
      const y = lerp(topY, hemY, t);
      const swell = Math.sin(clamp01(t * 1.6) * Math.PI * 0.5);
      // The thigh's radius at this height (legs taper from hip to knee).
      const k = clamp01((p.hipY + 0.07 - y) / (p.thigh + 0.07));
      const thighR = lerp(p.leg[0] * 1.1, p.leg[1] * 1.05, k);
      const needX = p.hipX * (1 - k * 0.08) + thighR + 0.014;
      const needZ = thighR * 1.12 + 0.012;
      f.c.set(0, y, -0.005);
      f.right.set(1, 0, 0);
      f.front.set(0, 0, 1);
      f.rx = Math.max(lerp(hx0, hipMax, swell), needX) + flare * 0.09 * t * t;
      f.rzF = Math.max(lerp(hzf0, hzf0, swell), needZ) + flare * 0.07 * t * t;
      f.rzB = Math.max(lerp(hzb0, hzb0 * 0.98, swell), needZ + 0.006) + flare * 0.07 * t * t;
    },
    // Down the skirt, each side follows its own leg; the middle splits the difference.
    weights: (q, t) => {
      const follow = (flare < 0.1 ? 0.75 : 0.55) * smooth(0.15, 1, t);
      const left = 0.5 + 0.5 * Math.max(-1, Math.min(1, q.x / (hipMax * 0.8)));
      return [["hips", 1 - follow], ["thighL", follow * left], ["thighR", follow * (1 - left)]];
    },
  });
}

function gear(m: Builder, p: Proportions, rest: Record<BoneName, V3>, o: Outfit, T: TierSpec): void {
  // Tactical vest: a thicker shell over the chest and back.
  const ring = p.torso;
  const y0 = p.waistY - 0.02;
  const y1 = p.shoulderY - 0.02;
  const at = (y: number, k: 1 | 2 | 3) => {
    let i = 0;
    while (i < ring.length - 2 && ring[i + 1][0] < y) i++;
    const f = clamp01((y - ring[i][0]) / (ring[i + 1][0] - ring[i][0]));
    return lerp(ring[i][k], ring[i + 1][k], f);
  };
  const vest = cellUv(CELL.vest);
  const bulk = (o.top.bulk ?? 0) + 0.022;
  sweep(m, {
    rings: 4,
    seg: T.torsoSeg,
    uvAt: () => vest,
    capStart: 0,
    capEnd: 0,
    frame: (t, f) => {
      const y = lerp(y0, y1, t);
      f.c.set(0, y, 0);
      f.right.set(1, 0, 0);
      f.front.set(0, 0, 1);
      f.rx = at(y, 1) * 0.92 + bulk * 0.6;
      f.rzF = at(y, 2) + bulk;
      f.rzB = at(y, 3) + bulk * 0.8;
    },
    weights: (q) => [["spine", 1 - smooth(p.waistY, p.chestY, q.y)], ["chest", smooth(p.waistY, p.chestY, q.y)]],
  });
  if (T.detail) {
    // Pouches across the front.
    const pouch = cellUv(CELL.pouch);
    for (const x of [-0.08, 0, 0.08]) {
      const y = p.waistY + 0.07;
      const z = at(y, 2) + bulk + 0.012;
      blob(m, new Vector3(x, y, z), [0.032, 0.04, 0.014], 4, 6, () => W1("spine"), { uvAt: () => pouch });
    }
  }
  void rest;
}

// ── Hair ──────────────────────────────────────────────────────────────────────

/** A shell over the head up to a hairline. `reach(az)` = polar angle where the hair stops. */
function cap(
  m: Builder,
  p: Proportions,
  thick: number,
  rows: number,
  seg: number,
  reach: (az: number) => number,
  opts: { grow?: [number, number, number]; offset?: Vector3; noise?: number } = {},
): void {
  const [hx, hy, hz] = p.head;
  const c = new Vector3(0, p.headY, 0.008).add(opts.offset ?? new Vector3());
  const g = opts.grow ?? [0, 0, 0];
  const S = seg;
  const R = rows;
  const base = m.count;
  const P: Vector3[][] = [];
  for (let i = 0; i <= R; i++) {
    const row: Vector3[] = [];
    for (let j = 0; j <= S; j++) {
      const phi = ((j % S) / S) * Math.PI * 2;
      const az = phi - Math.PI;
      const th = Math.max(0.02, (i / R) * reach(az));
      const sn = Math.sin(th);
      // Volume is full at the crown and tucks in to the scalp at the hairline.
      const tuck = 1 - smooth(0.62, 1, i / R);
      let x = Math.sin(phi) * sn * (hx + thick + g[0] * tuck);
      let z = -Math.cos(phi) * sn * (hz + thick + g[2] * tuck);
      let y = Math.cos(th) * (hy + thick + g[1] * tuck);
      if (opts.noise) {
        const k = opts.noise * tuck * (Math.sin(phi * 7 + th * 5) * 0.5 + Math.sin(phi * 13 - th * 9) * 0.3 + Math.sin(th * 17) * 0.2);
        const l = Math.hypot(x, y, z) || 1;
        x += (x / l) * k;
        y += (y / l) * k;
        z += (z / l) * k;
      }
      // Tuck the bottom edge in so it meets the scalp.
      const edge = i === R ? 0.94 : 1;
      row.push(new Vector3(c.x + x * edge, c.y + y, c.z + z * edge));
    }
    P.push(row);
  }
  const W = S + 1;
  for (let i = 0; i <= R; i++) {
    for (let j = 0; j <= S; j++) {
      const q = P[i][j];
      _n.subVectors(q, c).normalize();
      const [u0, v0, u1, v1] = UV.hair;
      m.vert(q, _n, u0 + (j / S) * (u1 - u0), v1 - (i / R) * (v1 - v0), W1("head"));
    }
  }
  for (let i = 0; i < R; i++) {
    for (let j = 0; j < S; j++) {
      const a = base + i * W + j;
      const b = a + 1;
      const cc = a + W;
      const d = cc + 1;
      // Outward winding: rows go top → down, columns back → right → front.
      m.tri(a, b, cc);
      m.tri(b, d, cc);
    }
  }
}

/** Hairline: forehead in front, above the ears at the sides, the nape behind. */
const hairline = (front: number, side: number, back: number) => (az: number) => {
  const c = Math.cos(az); // 1 front, -1 back
  return c >= 0 ? lerp(side, front, c) : lerp(side, back, -c);
};

function hairUv(): [number, number] {
  const [u0, v0, u1, v1] = UV.hair;
  return [(u0 + u1) / 2, (v0 + v1) / 2];
}

function hair(m: Builder, p: Proportions, id: HairId, T: TierSpec): void {
  const rows = Math.max(3, Math.round(T.head[0] * 0.55));
  const seg = T.head[1];
  const [hx, hy, hz] = p.head;
  const strand = hairUv();
  switch (id) {
    case "bald":
      return;
    case "lowcut":
      cap(m, p, 0.0035, rows, seg, hairline(1.0, 1.5, 2.1));
      return;
    case "fade": {
      cap(m, p, 0.003, rows, seg, hairline(1.0, 1.45, 2.0));
      // The high top: a rounded block on the crown.
      const c = new Vector3(0, p.headY + hy * 0.72, -0.004);
      blob(m, c, [hx * 0.88, 0.05, hz * 0.86], Math.max(4, rows), seg, () => W1("head"), { uvAt: () => strand });
      return;
    }
    case "afro":
      cap(m, p, 0.012, rows + 2, seg, hairline(1.0, 1.78, 2.2), { grow: [0.075, 0.062, 0.072], offset: new Vector3(0, 0.014, -0.008), noise: T.detail ? 0.01 : 0.007 });
      return;
    case "bun": {
      cap(m, p, 0.005, rows, seg, hairline(0.98, 1.5, 2.05));
      blob(m, new Vector3(0, p.headY + hy * 0.95, -hz * 0.35), [0.048, 0.04, 0.046], Math.max(4, rows), Math.max(8, seg - 4), () => W1("head"), { uvAt: () => strand });
      return;
    }
    case "ponytail": {
      cap(m, p, 0.004, rows, seg, hairline(0.98, 1.52, 2.0));
      const a = new Vector3(0, p.headY + hy * 0.45, -hz * 0.92);
      blob(m, a, [0.022, 0.02, 0.02], 4, 8, () => W1("head"), { uvAt: () => strand });
      rod(
        m,
        [a, a.clone().add(new Vector3(0, -0.06, -0.035)), a.clone().add(new Vector3(0, -0.18, -0.045)), a.clone().add(new Vector3(0, -0.27, -0.03))],
        [0.022, 0.024, 0.019, 0.013, 0.005],
        Math.max(6, T.seg - 2),
        Math.round(lerp(4, 9, T.ringK / 1.9)),
        (q) => [["head", 1 - smooth(a.y - 0.08, a.y - 0.25, q.y) * 0.35], ["neck", smooth(a.y - 0.08, a.y - 0.25, q.y) * 0.35]],
        { uvAt: () => strand },
        { capEnd: 0.004 },
      );
      return;
    }
    case "braids": {
      const line = hairline(0.98, 1.55, 2.1);
      cap(m, p, 0.007, rows, seg, line);
      const n = T.detail ? 14 : T.fingers ? 9 : 5;
      for (let i = 0; i < n; i++) {
        // phi measured from the back of the head, as in cap(): spread around the back.
        const phi = ((i / (n - 1)) * 2 - 1) * 1.9;
        const th = line(phi - Math.PI) - 0.18;
        const s0 = new Vector3(
          Math.sin(phi) * Math.sin(th) * (hx + 0.006),
          p.headY + Math.cos(th) * (hy + 0.006),
          0.008 - Math.cos(phi) * Math.sin(th) * (hz + 0.006),
        );
        const out = new Vector3(s0.x, 0, s0.z - 0.008).normalize();
        const len = 0.24 + (i % 3) * 0.03;
        const pts = [s0, s0.clone().addScaledVector(out, 0.02).add(new Vector3(0, -0.06, 0)), s0.clone().addScaledVector(out, 0.035).add(new Vector3(0, -len, 0))];
        rod(m, pts, [0.0075, 0.007, 0.006], 4, T.detail ? 6 : 4, (q) => [["head", 1 - smooth(p.headY - 0.1, p.headY - 0.3, q.y) * 0.4], ["neck", smooth(p.headY - 0.1, p.headY - 0.3, q.y) * 0.4]], { uvAt: () => strand }, { capEnd: 0.004 });
      }
      return;
    }
    case "pigtails": {
      // The doll's bob: full, down to the jaw, straight bangs to the brows…
      cap(m, p, 0.012, rows + 2, seg, hairline(1.3, 1.95, 2.35), { grow: [0.016, 0.01, 0.016], offset: new Vector3(0, 0.004, -0.003) });
      // …and two pigtails high on the sides, each with a white band.
      for (const s of [1, -1]) {
        const a = new Vector3(s * (hx + 0.012), p.headY + hy * 0.42, -hz * 0.3);
        blob(m, a, [0.016, 0.02, 0.02], 4, 8, () => W1("head"), { uvAt: () => cellUv(CELL.white) });
        rod(
          m,
          [a, a.clone().add(new Vector3(s * 0.035, -0.025, -0.01)), a.clone().add(new Vector3(s * 0.06, -0.09, -0.02)), a.clone().add(new Vector3(s * 0.062, -0.15, -0.015))],
          [0.024, 0.03, 0.026, 0.016, 0.005],
          Math.max(6, T.seg - 2),
          Math.round(lerp(4, 8, T.ringK / 1.9)),
          () => W1("head"),
          { uvAt: () => strand },
          { capEnd: 0.004 },
        );
      }
      return;
    }
    case "locs": {
      cap(m, p, 0.008, rows, seg, hairline(0.98, 1.55, 2.05));
      const n = T.detail ? 22 : T.fingers ? 13 : 7;
      for (let i = 0; i < n; i++) {
        const az = (i / n) * Math.PI * 2 + 0.2;
        let th = 0.45 + (i % 4) * 0.28;
        if (Math.cos(az) > 0.3) th = Math.min(th, 0.62); // never over the forehead
        const dir = new Vector3(Math.sin(az) * Math.sin(th), Math.cos(th), Math.cos(az) * Math.sin(th));
        const s0 = new Vector3(dir.x * (hx + 0.008), p.headY + dir.y * (hy + 0.008), 0.008 + dir.z * (hz + 0.008));
        const tip = s0.clone().addScaledVector(dir, 0.035).add(new Vector3(0, -0.045, 0));
        rod(m, [s0, tip], [0.0085, 0.006], 4, 3, () => W1("head"), { uvAt: () => strand }, { capEnd: 0.003 });
      }
      return;
    }
  }
}

// ── Extras ────────────────────────────────────────────────────────────────────

function extra(m: Builder, p: Proportions, rest: Record<BoneName, V3>, id: Look["extras"][number], T: TierSpec): void {
  const [hx, hy, hz] = p.head;
  const hc = new Vector3(0, p.headY, 0.008);
  const head = () => W1("head");
  switch (id) {
    case "fila": {
      const capUv = cellUv(CELL.cap);
      const foldUv = cellUv(CELL.capFold);
      rod(m, [new Vector3(0, hc.y + hy * 0.42, hc.z - 0.004), new Vector3(0.006, hc.y + hy * 1.02, hc.z - 0.01)], [hx + 0.016, hx + 0.02, hx + 0.012], T.head[1], 3, head, { uvAt: () => capUv }, { capEnd: 0.01 });
      blob(m, new Vector3(-0.03, hc.y + hy * 1.12, hc.z - 0.012), [hx * 0.9, 0.035, hz * 0.85], 4, T.head[1], head, { uvAt: () => foldUv });
      return;
    }
    case "gele": {
      const g = cellUv(CELL.gele);
      const sh = cellUv(CELL.geleShine);
      // The wrap: a tight band round the head …
      cap(m, p, 0.016, 5, T.head[1], hairline(0.82, 1.4, 1.8), { grow: [0.012, 0.03, 0.014], offset: new Vector3(0, 0.012, -0.006), noise: 0.004 });
      // … and the stiff fan of pleats standing up behind it.
      const n = T.detail ? 9 : T.fingers ? 7 : 5;
      for (let i = 0; i < n; i++) {
        const a = Math.PI + (i / (n - 1) - 0.5) * 2.6; // round the back and sides
        const out = new Vector3(Math.sin(a), 0, Math.cos(a));
        const circ = new Vector3(Math.cos(a), 0, -Math.sin(a));
        const base = new Vector3(out.x * hx * 0.75, hc.y + hy * 0.72, hc.z + out.z * hz * 0.75);
        const mid = base.clone().addScaledVector(out, 0.045).add(new Vector3(0, 0.07, 0));
        const tip = base.clone().addScaledVector(out, 0.075).add(new Vector3(0, 0.12 - Math.abs(i / (n - 1) - 0.5) * 0.05, 0));
        rod(m, [base, mid, tip], [0.035, 0.06, 0.055, 0.012], 6, 4, head, { uvAt: () => (i % 2 ? g : sh) }, { prefer: circ, flatten: 0.22, capEnd: 0.004, capStart: 0 });
      }
      return;
    }
    case "shades":
    case "glasses": {
      const frame = cellUv(CELL.black);
      const lens = cellUv(id === "shades" ? CELL.lensDark : CELL.black);
      const y = hc.y + Math.sin(FACE.eyeEl) * hy;
      for (const s of [1, -1]) {
        const ex = s * Math.sin(FACE.eyeAz) * hx * 0.98;
        const ez = hc.z + Math.cos(FACE.eyeAz) * hz + 0.011;
        if (id === "shades") blob(m, new Vector3(ex, y, ez), [0.023, 0.017, 0.004], 4, 8, head, { uvAt: () => lens });
        else torus(m, new Vector3(ex, y, ez), new Vector3(0, 0, 1), 0.019, 0.0022, 10, head(), CELL.black);
        // Arm back to the ear.
        rod(m, [new Vector3(s * hx * 0.62, y + 0.004, ez - 0.004), new Vector3(s * (hx + 0.006), y + 0.002, hc.z - 0.01)], [0.0025, 0.0025], 4, 2, head, { uvAt: () => frame });
      }
      rod(m, [new Vector3(-0.012, y + 0.004, hc.z + hz + 0.012), new Vector3(0.012, y + 0.004, hc.z + hz + 0.012)], [0.0025, 0.0025], 4, 2, head, { uvAt: () => frame });
      return;
    }
    case "headset": {
      const hs = cellUv(CELL.headset);
      const pts: Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const a = -Math.PI / 2 + (i / 8) * Math.PI;
        pts.push(new Vector3(Math.sin(a) * (hx + 0.02), hc.y + Math.cos(a) * (hy + 0.016) - 0.005, hc.z - 0.01));
      }
      rod(m, pts, [0.009, 0.01, 0.009], 5, 9, head, { uvAt: () => hs }, { prefer: FWD, flatten: 0.6 });
      for (const s of [1, -1]) {
        const cup = new Vector3(s * (hx + 0.016), hc.y - 0.012, hc.z - 0.01);
        blob(m, cup, [0.018, 0.034, 0.03], 4, 10, head, { uvAt: () => hs });
      }
      // Mic boom.
      rod(m, [new Vector3(hx + 0.02, hc.y - 0.03, hc.z), new Vector3(hx * 0.5, hc.y - 0.07, hc.z + hz + 0.01)], [0.003, 0.0035], 4, 3, head, { uvAt: () => cellUv(CELL.black) }, { capEnd: 0.004 });
      return;
    }
    case "earrings": {
      for (const s of [1, -1]) {
        torus(m, new Vector3(s * hx * 0.99, p.headY - 0.04, hc.z - 0.006), new Vector3(1, 0, 0), 0.012, 0.0018, T.detail ? 12 : 8, head(), CELL.gold);
      }
      return;
    }
    case "watch": {
      const wr = v3(rest.handL);
      const at = wr.clone().add(new Vector3(-0.004, 0.03, 0));
      torus(m, at, new Vector3(0.12, 1, 0), p.arm[4] + 0.004, 0.006, T.detail ? 12 : 8, [["foreArmL", 1]], CELL.metal);
      blob(m, at.clone().add(new Vector3(0, 0, p.arm[4] + 0.008)), [0.011, 0.011, 0.004], 3, 8, () => [["foreArmL", 1]], { uvAt: () => cellUv(CELL.black) });
      return;
    }
  }
}
