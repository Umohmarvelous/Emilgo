// The backpack you wear (SPEC-V3 §3.3): one small merged mesh on the chest
// bone, so it follows every lean, crouch and fall. Shared geometry and
// material for every body: a body pays one draw for it, and only when near.

import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Mesh, MeshLambertMaterial, Vector3 } from "three";

import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

import { merge, paint, part } from "../geo";
import { BONES, type BoneName, type V3 } from "./skeleton";

let geo: BufferGeometry | null = null;
let mat: MeshLambertMaterial | null = null;
/** v7 (2.11): each body's pack, its straps fitted to that body (keyed by its rest joints). */
const fitted = new WeakMap<object, BufferGeometry>();

/** A box with its corners rounded off, the way a stuffed bag's are. */
function soft(w: number, h: number, d: number, r: number): BufferGeometry {
  const g = new BoxGeometry(w, h, d, 3, 4, 2);
  const p = g.attributes.position;
  const ix = w / 2 - r;
  const iy = h / 2 - r;
  const iz = d / 2 - r;
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k);
    const y = p.getY(k);
    const z = p.getZ(k);
    const cx = Math.max(-ix, Math.min(ix, x));
    const cy = Math.max(-iy, Math.min(iy, y));
    const cz = Math.max(-iz, Math.min(iz, z));
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;
    const l = Math.hypot(dx, dy, dz) || 1;
    p.setXYZ(k, cx + (dx / l) * r, cy + (dy / l) * r, cz + (dz / l) * r);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * v5 (the owner: "make it look realistic, it should not be big"): a small
 * everyday backpack in the chest bone's space (metres; the back is −Z): the
 * main body with soft corners, a front pocket, zip lines, a grab handle, side
 * compression straps, and padded straps over the shoulders. About 22 × 30 × 10 cm.
 */
const BAG = 0x2b2d30;
const PANEL = 0x212326;
const STRAP = 0x141516;
const WEB = 0x1c1d20;
const ZIP = 0x4a4d52;

/** The bag itself, without its shoulder straps. */
function bagParts(): BufferGeometry[] {
  return [
    // Main body, snug against the back, and the panel that sits on it.
    part(soft(0.22, 0.3, 0.095, 0.035), BAG, { p: [0, -0.02, -0.165] }),
    part(soft(0.19, 0.27, 0.02, 0.008), PANEL, { p: [0, -0.02, -0.115] }),
    // Front pocket and its zip.
    part(soft(0.17, 0.13, 0.035, 0.014), PANEL, { p: [0, -0.085, -0.222] }),
    part(new BoxGeometry(0.135, 0.005, 0.004), ZIP, { p: [0, -0.03, -0.24] }),
    // The main zip, over the top and down both sides.
    part(new BoxGeometry(0.17, 0.004, 0.006), ZIP, { p: [0, 0.128, -0.165] }),
    part(new BoxGeometry(0.004, 0.2, 0.006), ZIP, { p: [0.109, 0.02, -0.165] }),
    part(new BoxGeometry(0.004, 0.2, 0.006), ZIP, { p: [-0.109, 0.02, -0.165] }),
    // Grab handle.
    part(new BoxGeometry(0.06, 0.012, 0.018), STRAP, { p: [0, 0.146, -0.135] }),
    // Side compression straps.
    part(new BoxGeometry(0.006, 0.014, 0.07), STRAP, { p: [0.111, -0.05, -0.165] }),
    part(new BoxGeometry(0.006, 0.014, 0.07), STRAP, { p: [-0.111, -0.05, -0.165] }),
  ];
}

/** The v5 straps (flat pads over the shoulders): only for a body the fit can't read. */
function plainStraps(): BufferGeometry[] {
  return [
    part(soft(0.042, 0.016, 0.16, 0.006), STRAP, { p: [0.082, 0.17, -0.055], r: [0.12, 0, 0] }),
    part(soft(0.042, 0.016, 0.16, 0.006), STRAP, { p: [-0.082, 0.17, -0.055], r: [0.12, 0, 0] }),
    part(new BoxGeometry(0.03, 0.22, 0.012), STRAP, { p: [0.086, 0.055, 0.125], r: [0.1, 0, 0] }),
    part(new BoxGeometry(0.03, 0.22, 0.012), STRAP, { p: [-0.086, 0.055, 0.125], r: [0.1, 0, 0] }),
  ];
}

function packGeometry(): BufferGeometry {
  return toCreasedNormals(merge([...bagParts(), ...plainStraps()]), 0.7);
}

// ── v7 (2.11, the owner: the straps "follow the shoulder and upper arm's curve") ──
//
// Each strap is swept along the body it is on: read off that body's rest mesh
// (its torso, never its arms or head), in the chest bone's space. A padded
// strap leaves the top of the bag, lies over the shoulder's own curve between
// the neck and the shoulder's point, runs down the chest, and at a buckle turns
// into webbing that wraps round the side of the ribs, under the arm, back to
// the bag's lower corner. A sternum strap joins the two across the chest. Once
// per kind of body (bodies are shared), a few milliseconds; still one draw.

/** The torso's skin as triangles (9 numbers each), in the chest bone's space. */
interface Cloud {
  t: Float32Array;
  n: number;
}

const TORSO: BoneName[] = ["root", "hips", "spine", "chest", "neck", "clavL", "clavR"];
/** How far a strap's underside sits off the skin (cloth, and no flicker). */
const CLEAR = 0.006;

function torsoCloud(geometry: BufferGeometry, rest: Record<BoneName, V3>): Cloud | null {
  const pos = geometry.attributes.position;
  const si = geometry.attributes.skinIndex;
  const sw = geometry.attributes.skinWeight;
  if (!pos || !si || !sw) return null;
  const keep = new Set(TORSO.map((b) => BONES.indexOf(b)));
  const main = (i: number): number => {
    let b = si.getX(i);
    let w = sw.getX(i);
    if (sw.getY(i) > w) (w = sw.getY(i)), (b = si.getY(i));
    if (sw.getZ(i) > w) (w = sw.getZ(i)), (b = si.getZ(i));
    if (sw.getW(i) > w) (w = sw.getW(i)), (b = si.getW(i));
    return b;
  };
  const idx = geometry.index;
  const count = idx ? idx.count : pos.count;
  const c = rest.chest;
  const t = new Float32Array(count * 3);
  let n = 0;
  for (let k = 0; k + 2 < count; k += 3) {
    const v = [0, 1, 2].map((j) => (idx ? idx.getX(k + j) : k + j));
    // A torso triangle: no corner on an arm or the head.
    if (!v.every((i) => keep.has(main(i)))) continue;
    v.forEach((i, j) => {
      t[n * 9 + 3 * j] = pos.getX(i) - c.x;
      t[n * 9 + 3 * j + 1] = pos.getY(i) - c.y;
      t[n * 9 + 3 * j + 2] = pos.getZ(i) - c.z;
    });
    n++;
  }
  return n > 100 ? { t, n } : null;
}

/** The farthest skin along a ray from (ox, oy, oz) in the direction (dx, dy, dz) (unit), or NaN: the outside of the torso. */
function cast(c: Cloud, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
  let far = NaN;
  const t = c.t;
  for (let k = 0; k < c.n; k++) {
    const o = k * 9;
    const e1x = t[o + 3] - t[o];
    const e1y = t[o + 4] - t[o + 1];
    const e1z = t[o + 5] - t[o + 2];
    const e2x = t[o + 6] - t[o];
    const e2y = t[o + 7] - t[o + 1];
    const e2z = t[o + 8] - t[o + 2];
    // Möller–Trumbore.
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const sx = ox - t[o];
    const sy = oy - t[o + 1];
    const sz = oz - t[o + 2];
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (d > 0 && !(d <= far)) far = d;
  }
  return far;
}

/** In the side plane x = px: the skin's distance from (oy, oz) in the direction phi (0 up, +π/2 front). */
function sagittal(c: Cloud, px: number, oy: number, oz: number, phi: number): number {
  return cast(c, px, oy, oz, 0, Math.cos(phi), Math.sin(phi));
}

/** At height py: the skin's distance from (cx, cz) in the direction theta (0 front, +π/2 toward +x). */
function around(c: Cloud, py: number, cx: number, cz: number, theta: number): number {
  return cast(c, cx, py, cz, Math.sin(theta), 0, Math.cos(theta));
}

/** The skin's front (largest z) at (px, py), or NaN. */
function frontZ(c: Cloud, px: number, py: number): number {
  const d = cast(c, px, py, -1, 0, 0, 1);
  return Number.isFinite(d) ? d - 1 : NaN;
}

/** The middle of the torso's depth at (px, py), or NaN. */
function midZ(c: Cloud, px: number, py: number): number {
  const f = cast(c, px, py, -1, 0, 0, 1);
  const b = cast(c, px, py, 1, 0, 0, -1);
  return Number.isFinite(f) && Number.isFinite(b) ? (f - 1 + (1 - b)) / 2 : NaN;
}

/** Fill the gaps (NaN) from the neighbours, then smooth: skin read in bins is ragged. */
function settle(v: number[], passes = 2): number[] {
  const n = v.length;
  const known = v.map((a, i) => (Number.isFinite(a) ? i : -1)).filter((i) => i >= 0);
  if (!known.length) return v;
  const out = v.slice();
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(out[i])) continue;
    const a = [...known].reverse().find((k) => k < i);
    const b = known.find((k) => k > i);
    out[i] = a === undefined ? v[b!] : b === undefined ? v[a] : v[a] + ((v[b] - v[a]) * (i - a)) / (b - a);
  }
  for (let p = 0; p < passes; p++) {
    const s = out.slice();
    for (let i = 1; i < n - 1; i++) out[i] = (s[i - 1] + 2 * s[i] + s[i + 1]) / 4;
  }
  return out;
}

interface Station {
  p: Vector3;
  /** Away from the skin. */
  n: Vector3;
  /** Width across the strap, and its thickness. */
  w: number;
  h: number;
}

/**
 * A strap swept along its stations: a flat band, `w` wide and `h` thick, its
 * underside on the path, its top away from the skin. Triangles, coloured.
 */
function sweep(st: Station[], color: number): BufferGeometry | null {
  if (st.length < 2) return null;
  const tan = new Vector3();
  const side = new Vector3();
  const up = new Vector3();
  // Each station's four corners: inner left, inner right, outer right, outer left.
  const ring: Vector3[][] = st.map((s, i) => {
    const a = st[Math.max(0, i - 1)].p;
    const b = st[Math.min(st.length - 1, i + 1)].p;
    tan.subVectors(b, a).normalize();
    side.crossVectors(tan, s.n).normalize();
    up.crossVectors(side, tan).normalize();
    const hw = s.w / 2;
    return [
      s.p.clone().addScaledVector(side, -hw),
      s.p.clone().addScaledVector(side, hw),
      s.p.clone().addScaledVector(side, hw).addScaledVector(up, s.h),
      s.p.clone().addScaledVector(side, -hw).addScaledVector(up, s.h),
    ];
  });
  const pos: number[] = [];
  const tri = (a: Vector3, b: Vector3, c: Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3) => (tri(a, b, c), tri(a, c, d));
  for (let i = 0; i < ring.length - 1; i++) {
    const r0 = ring[i];
    const r1 = ring[i + 1];
    for (let k = 0; k < 4; k++) {
      const k1 = (k + 1) % 4;
      quad(r0[k], r1[k], r1[k1], r0[k1]);
    }
  }
  // The two ends closed.
  const e0 = ring[0];
  const e1 = ring[ring.length - 1];
  quad(e0[3], e0[2], e0[1], e0[0]);
  quad(e1[0], e1[1], e1[2], e1[3]);
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  // Facing out whichever way the path ran: a band's corners are wound by its side vector.
  g.computeVertexNormals();
  const flip = ring.length > 1 && (() => {
    const n = g.attributes.normal;
    // The outer face's first triangle (k = 2: outer right to outer left) should point away from the skin.
    const fi = 2 * 6 * 3;
    return n.getX(fi / 3) * st[0].n.x + n.getY(fi / 3) * st[0].n.y + n.getZ(fi / 3) * st[0].n.z < 0;
  })();
  if (flip) {
    const a = g.attributes.position.array as Float32Array;
    for (let i = 0; i < a.length; i += 9) {
      for (let j = 0; j < 3; j++) {
        const t = a[i + 3 + j];
        a[i + 3 + j] = a[i + 6 + j];
        a[i + 6 + j] = t;
      }
    }
    g.computeVertexNormals();
  }
  // Coloured as every other part is (the colour in the working space).
  return paint(g, color);
}

/** One side's strap (sgn: +1 or −1 along x), fitted; null if this body's shape can't be read there. */
function sideStraps(c: Cloud, rest: Record<BoneName, V3>, side: "L" | "R"): { parts: BufferGeometry[]; front: Station } | null {
  const ch = rest.chest;
  const arm = rest[`upperArm${side}` as BoneName];
  const ax = arm.x - ch.x;
  const ay = arm.y - ch.y;
  const sgn = Math.sign(ax) || (side === "L" ? 1 : -1);
  // Over the shoulder halfway between the neck and the shoulder's point.
  const xs = sgn * Math.max(0.07, Math.min(0.11, Math.abs(ax) * 0.5));
  const oy = ay - 0.07;
  const oz = midZ(c, xs, oy);
  if (!Number.isFinite(oz)) return null;

  // The shoulder's curve, from the upper back over the top to the upper chest.
  const PHI0 = -1.75;
  const PHI1 = 1.6;
  const steps = 22;
  const phis: number[] = [];
  for (let i = 0; i <= steps; i++) phis.push(PHI0 + ((PHI1 - PHI0) * i) / steps);
  const rs = settle(phis.map((f) => sagittal(c, xs, oy, oz, f)), 3);
  if (rs.some((r) => !Number.isFinite(r) || r < 0.03 || r > 0.25)) return null;
  const pad: Station[] = [];
  // Out of the bag's top, by the panel that sits on the back.
  const top = new Vector3(sgn * 0.072, 0.105, -0.142);
  pad.push({ p: top, n: new Vector3(0, 0.3, -1).normalize(), w: 0.046, h: 0.012 });
  phis.forEach((f, i) => {
    const d = new Vector3(0, Math.cos(f), Math.sin(f));
    const p = new Vector3(xs, oy, oz).addScaledVector(d, rs[i] + CLEAR);
    // Leave out the stretch the bag already covers.
    if (f < -1.2 && p.y < top.y + 0.02) return;
    pad.push({ p, n: d, w: 0.046, h: 0.012 });
  });

  // Down the chest, splaying a little outward, to the buckle.
  const start = pad[pad.length - 1].p;
  const yb = ay - 0.16;
  const down: number[] = [];
  const ys: number[] = [];
  const xsDown: number[] = [];
  const DN = 6;
  for (let i = 1; i <= DN; i++) {
    const y = start.y + ((yb - start.y) * i) / DN;
    const x = xs + sgn * 0.022 * (i / DN);
    ys.push(y);
    xsDown.push(x);
    down.push(frontZ(c, x, y));
  }
  const zs = settle(down, 2);
  if (zs.some((z) => !Number.isFinite(z))) return null;
  for (let i = 0; i < DN; i++) {
    const a = i ? zs[i - 1] : start.z - CLEAR;
    // The skin's slope down the chest tips the strap's top toward it.
    const dy = ys[i] - (i ? ys[i - 1] : start.y);
    const n = new Vector3(sgn * 0.15, -(zs[i] - a) / (dy || -1e-3), 1).normalize();
    pad.push({ p: new Vector3(xsDown[i], ys[i], zs[i] + CLEAR), n, w: 0.046 - 0.01 * ((i + 1) / DN), h: 0.012 - 0.003 * ((i + 1) / DN) });
  }
  const front = pad[pad.length - 1];

  // The webbing: round the ribs, under the arm, to the bag's lower corner.
  const end = new Vector3(sgn * 0.1, -0.13, -0.16);
  const czF = midZ(c, 0, front.p.y);
  const czE = midZ(c, 0, end.y);
  if (!Number.isFinite(czF) || !Number.isFinite(czE)) return null;
  const th0 = Math.atan2(front.p.x, front.p.z - czF);
  const th1 = Math.atan2(end.x, end.z - czE);
  const WN = 10;
  const web: Station[] = [];
  const thetas: number[] = [];
  const yw: number[] = [];
  const czs: number[] = [];
  for (let i = 0; i <= WN; i++) {
    const u = i / WN;
    const y = front.p.y + (end.y - front.p.y) * Math.pow(u, 1.4);
    thetas.push(th0 + (th1 - th0) * u);
    yw.push(y);
    czs.push(settleOne(midZ(c, 0, y), czF + (czE - czF) * u));
  }
  const rw = settle(thetas.map((t, i) => around(c, yw[i], 0, czs[i], t)), 2);
  if (rw.some((r) => !Number.isFinite(r))) return null;
  for (let i = 0; i <= WN; i++) {
    const n = new Vector3(Math.sin(thetas[i]), 0, Math.cos(thetas[i]));
    const p = new Vector3(0, yw[i], czs[i]).addScaledVector(n, rw[i] + CLEAR);
    // The last stretch goes into the bag's side.
    if (i === WN) p.copy(end);
    web.push({ p, n, w: 0.024, h: 0.004 });
  }
  web[0].p.copy(front.p).addScaledVector(front.n, 0.002);

  const parts: BufferGeometry[] = [];
  const a = sweep(pad, STRAP);
  const b = sweep(web, WEB);
  if (!a || !b) return null;
  parts.push(a, b);
  // The buckle where the pad meets the webbing.
  const dir = new Vector3().subVectors(front.p, pad[pad.length - 2].p).normalize();
  const buckle = sweep(
    [
      { p: front.p.clone().addScaledVector(dir, -0.012), n: front.n, w: 0.036, h: 0.016 },
      { p: front.p.clone().addScaledVector(dir, 0.012), n: front.n, w: 0.036, h: 0.016 },
    ],
    ZIP,
  );
  if (buckle) parts.push(buckle);
  // The sternum strap: a third of the way down the chest.
  return { parts, front: pad[Math.max(1, pad.length - DN + 1)] };
}

function settleOne(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

/** The sternum strap: across the chest between the two pads, on the skin. */
function sternum(c: Cloud, l: Station, r: Station): BufferGeometry | null {
  const y = (l.p.y + r.p.y) / 2;
  const N = 8;
  const zs: number[] = [];
  const xs: number[] = [];
  for (let i = 0; i <= N; i++) {
    const x = l.p.x + ((r.p.x - l.p.x) * i) / N;
    xs.push(x);
    zs.push(frontZ(c, x, y));
  }
  const z = settle(zs, 2);
  if (z.some((v) => !Number.isFinite(v))) return null;
  // Taut across the chest: never dipping between the pads below the line that joins them.
  const st: Station[] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const chord = l.p.z + (r.p.z - l.p.z) * u + l.h;
    st.push({ p: new Vector3(xs[i], y, Math.max(z[i] + CLEAR, chord)), n: new Vector3(0, 0, 1), w: 0.016, h: 0.004 });
  }
  const mid = st[N >> 1];
  const g = sweep(st, WEB);
  const clip = sweep(
    [
      { p: mid.p.clone().add(new Vector3(-0.016, 0, 0)), n: mid.n, w: 0.022, h: 0.01 },
      { p: mid.p.clone().add(new Vector3(0.016, 0, 0)), n: mid.n, w: 0.022, h: 0.01 },
    ],
    ZIP,
  );
  return g && clip ? merge([g, clip]) : g;
}

/** This body's pack: the bag and its straps fitted to it (the plain straps if its shape can't be read). */
function fittedGeometry(body: { geometry: BufferGeometry; rest: Record<BoneName, V3> }): BufferGeometry {
  const have = fitted.get(body.rest);
  if (have) return have;
  let out: BufferGeometry;
  const c = torsoCloud(body.geometry, body.rest);
  const l = c && sideStraps(c, body.rest, "L");
  const r = c && sideStraps(c, body.rest, "R");
  if (c && l && r) {
    const st = sternum(c, l.front, r.front);
    out = toCreasedNormals(merge([...bagParts(), ...l.parts, ...r.parts, ...(st ? [st] : [])]), 0.7);
  } else out = (geo ??= packGeometry());
  fitted.set(body.rest, out);
  return out;
}

/** The pack; with a body, its straps fitted to that body (v7 2.11). */
/** Fit the pack to the body it is on now (a body swap: the operator's suit, a finer scan). */
export function refitPack(m: Mesh, body: { geometry: BufferGeometry; rest: Record<BoneName, V3> }): void {
  m.geometry = fittedGeometry(body);
}

export function packMesh(body?: { geometry: BufferGeometry; rest: Record<BoneName, V3> }): Mesh {
  mat ??= new MeshLambertMaterial({ vertexColors: true });
  const m = new Mesh(body ? fittedGeometry(body) : (geo ??= packGeometry()), mat);
  m.name = "pack";
  m.frustumCulled = false;
  return m;
}
