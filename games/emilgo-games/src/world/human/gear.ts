// The tactical operator (v4 Phase 4): hard gear on the scanned body, and the
// armour ladder's look (no growth: the owner's answer; heavier armour only).
//
// Every piece is a low-poly primitive weighted rigidly to the bone it rides,
// written straight into the body's own geometry, so a dressed body is still
// ONE draw (and its LOD levels each have their own, lighter gear). The gear's
// vertices read the palette's gear cell (pure white) and carry their colour
// per vertex; the body shader (dress.ts) leaves them as they are.
//
//   T0 Operator    helmet (rails, comms, NVG mount), plate carrier with mag
//                  pouches and straps, belt and holster, knee pads
//   T1 Plated      + pauldrons, vambraces, greaves
//   T2 Juggernaut  heavier plates, a collar, a visor with a slit
//   T3 Warlord     black plate, spikes, ember glow round the slit
//   T4 Titan       obsidian and gold, horns, a crown, a glowing core

import {
  BoxGeometry,
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Uint16BufferAttribute,
  Vector3,
  Euler,
  Sphere,
} from "three";

import { BONE_INDEX, BONES, type BoneName } from "./skeleton";
import { scellUv, SCELL } from "./scanbody";
import type { Detail } from "./mesh";

export interface Kit {
  id: string;
  /** Camo: four colours (dress.ts). */
  camo: readonly [string, string, string, string];
  webbing: string;
  helmet: string;
  glove: string;
  boot: string;
  knit: string;
  metal: string;
}

/** Original camos only (no real-world patterns or brands). */
export const KITS: readonly Kit[] = [
  { id: "ironwood", camo: ["#5b5a43", "#7a6e50", "#3a3d2c", "#2a2722"], webbing: "#4b4c37", helmet: "#4a4b3a", glove: "#222220", boot: "#3a3026", knit: "#232320", metal: "#2a2a2c" },
  { id: "ash", camo: ["#5d6066", "#7c7f83", "#3b3e43", "#24262a"], webbing: "#2b2d30", helmet: "#2f3134", glove: "#1b1b1c", boot: "#1f1e1c", knit: "#18191b", metal: "#1e1f21" },
  { id: "dune", camo: ["#a08b68", "#bba57e", "#7d6a4e", "#5e5140"], webbing: "#8a7552", helmet: "#8b7a5c", glove: "#5a4a38", boot: "#6b5a44", knit: "#3b3226", metal: "#3a3530" },
];

/** The armour ladder: names, and the armour points each tier starts at (guns: up to 150). */
export const ARMOUR_TIERS = [
  { name: "Operator", from: 0 },
  { name: "Plated", from: 25 },
  { name: "Juggernaut", from: 60 },
  { name: "Warlord", from: 100 },
  { name: "Titan", from: 140 },
] as const;

export function armourTier(points: number): number {
  let t = 0;
  for (let k = 0; k < ARMOUR_TIERS.length; k++) if (points >= ARMOUR_TIERS[k].from) t = k;
  return t;
}

type V3 = { x: number; y: number; z: number };
interface Box {
  min: Vector3;
  max: Vector3;
}
/** A body's measurements: bone rest positions and the box of the vertices each bone moves most. */
interface Fit {
  rest: Record<BoneName, V3>;
  box: Partial<Record<BoneName, Box>>;
}

const fits = new WeakMap<BufferGeometry, Fit>();

function fitOf(geometry: BufferGeometry, rest: Record<BoneName, V3>): Fit {
  let f = fits.get(geometry);
  if (f) return f;
  const pos = geometry.attributes.position;
  const si = geometry.attributes.skinIndex;
  const sw = geometry.attributes.skinWeight;
  const box: Fit["box"] = {};
  for (let i = 0; i < pos.count; i++) {
    let bi = si.getX(i);
    let bw = sw.getX(i);
    if (sw.getY(i) > bw) (bw = sw.getY(i)), (bi = si.getY(i));
    if (sw.getZ(i) > bw) (bw = sw.getZ(i)), (bi = si.getZ(i));
    if (sw.getW(i) > bw) (bw = sw.getW(i)), (bi = si.getW(i));
    const name = BONES[bi];
    const b = (box[name] ??= { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) });
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    b.min.set(Math.min(b.min.x, x), Math.min(b.min.y, y), Math.min(b.min.z, z));
    b.max.set(Math.max(b.max.x, x), Math.max(b.max.y, y), Math.max(b.max.z, z));
  }
  f = { rest, box };
  fits.set(geometry, f);
  return f;
}

/** Linear colour from hex, × k (over 1 glows in dress.ts). */
function lin(hex: string, k = 1): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.pow(v / 255, 2.2) * k;
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)];
}

/** Gear vertices, then merged after the body's. */
class Acc {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  idx: number[] = [];
  private readonly uv = scellUv(SCELL.gear);

  /** Add a primitive (transformed by `m`), riding `bone` (or blended into `bone2` by `w2`), in one colour. */
  add(g: BufferGeometry, m: Matrix4, bone: BoneName, color: [number, number, number], bone2?: BoneName, w2 = 0): void {
    const geo = g.index ? g : g;
    geo.applyMatrix4(m);
    const p = geo.attributes.position;
    const n = geo.attributes.normal;
    const base = this.pos.length / 3;
    const b1 = BONE_INDEX[bone];
    const b2 = bone2 ? BONE_INDEX[bone2] : 0;
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(color[0], color[1], color[2]);
      this.si.push(b1, b2, 0, 0);
      this.sw.push(1 - w2, w2, 0, 0);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) this.idx.push(base + geo.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    g.dispose();
  }

  get uvCell(): [number, number] {
    return this.uv;
  }
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
function M(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): Matrix4 {
  _e.set(rx, ry, rz, "YXZ");
  _q.setFromEuler(_e);
  return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/**
 * The gear for a tier, as extra vertices for the body's geometry. `level`:
 * the body's detail (0 far: the helmet and plates only, in few faces).
 */
function buildGear(fit: Fit, tier: number, level: Detail, kit: Kit): Acc {
  const a = new Acc();
  const R = fit.rest;
  const hb = fit.box.head;
  const cb = fit.box.chest;
  const sb = fit.box.spine;
  if (!hb || !cb) return a;
  const far = level === 0;
  const seg = far ? 6 : level === 1 ? 10 : 14;
  // Colours by tier.
  const webbing = lin(tier >= 3 ? "#1b1a1c" : tier === 2 ? "#3e4247" : kit.webbing);
  const shell = lin(tier === 4 ? "#141416" : tier === 3 ? "#1d1b1e" : tier === 2 ? "#4a4f55" : kit.helmet);
  const plate = lin(tier === 4 ? "#18181b" : tier === 3 ? "#232024" : tier === 2 ? "#5a5f66" : kit.webbing);
  const metal = lin(kit.metal);
  const trim = tier === 4 ? lin("#d4a017") : tier === 3 ? lin("#6e1d14") : lin("#1a1a18");
  const glow = tier === 4 ? lin("#ffc04a", 5) : lin("#ff5a1a", 4);

  // ── Helmet: a shell over the crown, its rim at the brow, sitting back a little. ──
  const hc = new Vector3().addVectors(hb.min, hb.max).multiplyScalar(0.5);
  const hr = new Vector3().subVectors(hb.max, hb.min).multiplyScalar(0.5);
  const eyeY = (R.eyeL.y + R.eyeR.y) / 2;
  const eyeZ = Math.max(R.eyeL.z, R.eyeR.z);
  const rx = hr.x * 1.2;
  const rz = hr.z * 1.16;
  const ry = (hb.max.y - eyeY) * 1.02;
  const top = hb.max.y + 0.022;
  const cy = top - ry;
  a.add(new SphereGeometry(1, seg, Math.max(3, seg / 2), 0, Math.PI * 2, 0, Math.PI * (tier >= 2 ? 0.62 : 0.5)), M(hc.x, cy, hc.z - 0.005, -0.12, 0, 0, rx, ry * (tier >= 2 ? 1.0 : 1.08), rz), "head", shell);
  if (!far) {
    // Rails on both sides, comms cups over the ears, the NVG mount at the front.
    for (const s of [-1, 1]) {
      a.add(new BoxGeometry(0.014, 0.022, 0.11), M(hc.x + s * rx * 0.98, cy + ry * 0.12, hc.z, 0, 0, 0), "head", metal);
      if (tier < 2) a.add(new CylinderGeometry(0.038, 0.038, 0.03, 8), M(hc.x + s * (hr.x + 0.012), eyeY - 0.02, hc.z - 0.01, 0, 0, Math.PI / 2), "head", lin(kit.webbing));
    }
    if (tier < 2) a.add(new BoxGeometry(0.045, 0.035, 0.025), M(hc.x, cy + ry * 0.55, hc.z + rz * 0.92, -0.4), "head", metal);
  }
  // T2+: a visor below the rim with a slit at the eyes (the eyes still show); T3 an ember glow round it.
  if (tier >= 2) {
    const vz = eyeZ + 0.03;
    a.add(new BoxGeometry(rx * 1.7, 0.05, 0.03), M(hc.x, eyeY - 0.045, vz - 0.005, 0.12), "head", shell);
    a.add(new BoxGeometry(rx * 1.75, 0.02, 0.03), M(hc.x, eyeY + 0.026, vz, 0), "head", trim);
    if (tier >= 3) for (const e of [R.eyeL, R.eyeR]) a.add(new BoxGeometry(0.032, 0.006, 0.004), M(e.x, e.y - 0.014, vz + 0.017), "head", glow);
  }
  if (tier >= 3 && !far) {
    // Spikes (Warlord), horns and a crown (Titan).
    if (tier === 3) for (let k = -1; k <= 1; k++) a.add(new ConeGeometry(0.018, 0.07, 6), M(hc.x + k * 0.05, top + 0.02, hc.z, -0.2), "head", trim);
    else {
      for (const s of [-1, 1]) a.add(new ConeGeometry(0.026, 0.16, 7), M(hc.x + s * rx * 0.85, cy + ry * 0.7, hc.z - 0.01, 0, 0, -s * 0.9), "head", trim);
      a.add(new TorusGeometry(rx * 0.72, 0.012, 4, 14), M(hc.x, top - 0.01, hc.z, Math.PI / 2), "head", trim);
    }
  }

  // ── Plate carrier: front and back plates over the chest, straps, the cummerbund, mag pouches. ──
  const cMinY = sb ? Math.min(cb.min.y, sb.max.y) : cb.min.y;
  const y0 = cMinY + (cb.max.y - cMinY) * 0.12;
  const y1 = R.neck.y - 0.06;
  const ch = y1 - y0;
  const cyc = (y0 + y1) / 2;
  const cx = (cb.min.x + cb.max.x) / 2;
  const w = (cb.max.x - cb.min.x) * (tier >= 2 ? 0.86 : 0.74);
  const zF = cb.max.z + 0.012;
  const zB = cb.min.z - 0.012;
  const thick = tier >= 2 ? 0.06 : 0.035;
  // The lower half of a plate leans on the spine (it bends with the waist).
  a.add(new BoxGeometry(w, ch, thick), M(cx, cyc, zF + thick / 2 - 0.006), "chest", plate, "spine", 0.25);
  a.add(new BoxGeometry(w, ch, thick), M(cx, cyc, zB - thick / 2 + 0.006), "chest", plate, "spine", 0.25);
  if (!far) {
    // Straps over the shoulders and the cummerbund at the sides.
    const sy = R.neck.y - 0.03;
    for (const s of [-1, 1]) {
      a.add(new BoxGeometry(0.05, 0.03, zF - zB + 0.02), M(cx + s * w * 0.32, sy, (zF + zB) / 2), "chest", webbing);
      a.add(new BoxGeometry(0.03, ch * 0.55, (zF - zB) * 0.8), M(cx + s * ((cb.max.x - cb.min.x) / 2 + 0.008), y0 + ch * 0.3, (zF + zB) / 2), "chest", webbing, "spine", 0.4);
    }
    // Three mag pouches low on the front (Warlord/Titan: a trim plate instead).
    if (tier < 3) for (let k = -1; k <= 1; k++) a.add(new BoxGeometry(w * 0.24, ch * 0.32, 0.045), M(cx + k * w * 0.29, y0 + ch * 0.2, zF + thick + 0.018), "chest", webbing, "spine", 0.3);
    else a.add(new BoxGeometry(w * 0.92, 0.025, thick + 0.01), M(cx, y1 - 0.02, zF + thick / 2), "chest", trim);
    if (tier >= 2) a.add(new TorusGeometry(0.085, tier >= 3 ? 0.03 : 0.024, 5, 12), M(R.neck.x, R.neck.y - 0.01, R.neck.z, Math.PI / 2 + 0.2), "chest", plate);
    if (tier === 4) a.add(new SphereGeometry(0.035, 8, 6), M(cx, cyc + ch * 0.1, zF + thick + 0.01), "chest", glow);
  }

  // ── Boots: a shell over each foot (no toes), a cuff at the ankle; a darker sole. ──
  for (const side of ["L", "R"] as const) {
    const fb = fit.box[`foot${side}`];
    if (!fb) continue;
    const bx = (fb.min.x + fb.max.x) / 2;
    const bzc = (fb.min.z + fb.max.z) / 2;
    const fw = fb.max.x - fb.min.x + 0.018;
    const fl = fb.max.z - fb.min.z + 0.022;
    const fh = Math.max(0.07, fb.max.y - Math.max(0, fb.min.y)) + 0.012;
    const boot = lin(tier >= 3 ? "#121112" : kit.boot);
    const y0 = Math.max(0, fb.min.y);
    // The heel and the upper (the back 60%), then a lower, rounded toe cap.
    a.add(new BoxGeometry(fw, fh, fl * 0.6), M(bx, y0 + fh / 2 - 0.004, fb.min.z - 0.007 + fl * 0.3), `foot${side}`, boot);
    a.add(new BoxGeometry(fw * 0.96, fh * 0.62, fl * 0.45), M(bx, y0 + fh * 0.31 - 0.004, fb.max.z + 0.011 - fl * 0.225, 0.08), `foot${side}`, boot);
    a.add(new BoxGeometry(fw + 0.006, 0.02, fl + 0.008), M(bx, Math.max(0, fb.min.y) + 0.008, bzc + 0.004), `foot${side}`, lin("#121110"));
    if (!far) a.add(new CylinderGeometry(fw * 0.62, fw * 0.6, 0.09, 8), M(bx, fb.max.y + 0.035, (fb.min.z + bzc) / 2), `shin${side}`, boot);
  }

  // ── Below the waist: the belt, a holster on the right thigh, knee pads. ──
  if (!far && sb) {
    const by = sb.min.y + 0.02;
    const bw = (sb.max.x - sb.min.x) * 1.08;
    const bd = (sb.max.z - sb.min.z) * 1.08;
    const bz = (sb.max.z + sb.min.z) / 2;
    a.add(new BoxGeometry(bw, 0.045, bd), M(cx, by, bz), "hips", webbing);
    const tR = fit.box.thighR;
    if (tR) a.add(new BoxGeometry(0.06, 0.16, 0.08), M(tR.min.x - 0.018, tR.max.y - 0.13, (tR.min.z + tR.max.z) / 2), "thighR", webbing);
    for (const side of ["L", "R"] as const) {
      const shin = fit.box[`shin${side}`];
      if (!shin) continue;
      const kx = (shin.min.x + shin.max.x) / 2;
      a.add(new BoxGeometry((shin.max.x - shin.min.x) * 0.9, 0.08, 0.03), M(kx, shin.max.y - 0.02, shin.max.z + 0.008), `shin${side}`, tier >= 1 ? plate : webbing);
      // T1+: greaves down the shin.
      if (tier >= 1) a.add(new BoxGeometry((shin.max.x - shin.min.x) * 0.85, (shin.max.y - shin.min.y) * 0.6, 0.022), M(kx, (shin.min.y + shin.max.y) / 2 - 0.02, shin.max.z + 0.006), `shin${side}`, plate);
    }
  }

  // ── T1+: pauldrons on the shoulders, vambraces on the forearms. ──
  if (tier >= 1 && !far) {
    for (const side of ["L", "R"] as const) {
      const sh = R[`upperArm${side}`];
      const s = side === "L" ? 1 : -1;
      const big = tier >= 2 ? 1.25 : 1;
      a.add(new SphereGeometry(0.075 * big, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.5), M(sh.x + s * 0.03, sh.y + 0.005, sh.z, 0, 0, -s * 0.35, 1, 0.75, 1.05), `upperArm${side}`, plate);
      if (tier >= 3) a.add(new ConeGeometry(0.016, 0.07, 5), M(sh.x + s * 0.06, sh.y + 0.06, sh.z, 0, 0, -s * 0.5), `upperArm${side}`, trim);
      const fa = fit.box[`foreArm${side}`];
      if (fa) {
        const len = Math.max(fa.max.x - fa.min.x, fa.max.y - fa.min.y) * 0.5;
        const e = R[`foreArm${side}`];
        const hnd = R[`hand${side}`];
        const mid = new Vector3((e.x + hnd.x) / 2, (e.y + hnd.y) / 2, (e.z + hnd.z) / 2);
        const dir = new Vector3(hnd.x - e.x, hnd.y - e.y, hnd.z - e.z).normalize();
        const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
        const mm = new Matrix4().compose(mid, q, new Vector3(1, 1, 1));
        a.add(new CylinderGeometry(0.042, 0.036, len, 7, 1, true), mm, `foreArm${side}`, plate);
      }
    }
  }
  return a;
}

const merged = new Map<string, BufferGeometry>();

/**
 * The body's geometry with the gear for `tier` in it (cached by the body's
 * geometry, the tier and the kit). Same bones, same skin attributes.
 */
export function dressedGeometry(body: BufferGeometry, rest: Record<BoneName, V3>, tier: number, level: Detail, kit: Kit): BufferGeometry {
  return mergeInto(body, `${body.uuid}|${tier}|${kit.id}`, () => buildGear(fitOf(body, rest), tier, level, kit));
}

/** The body's geometry with extra pieces written after it (cached by `key`). */
function mergeInto(body: BufferGeometry, key: string, make: () => Acc): BufferGeometry {
  let g = merged.get(key);
  if (g) return g;
  const a = make();
  const n0 = body.attributes.position.count;
  const n1 = a.pos.length / 3;
  const cat = (name: string, extra: number[], size: number, fill?: (i: number) => number[]) => {
    const src = body.attributes[name];
    const out = new Float32Array((n0 + n1) * size);
    if (src) out.set(src.array as Float32Array, 0);
    else if (fill) for (let i = 0; i < n0; i++) out.set(fill(i), i * size);
    out.set(extra, n0 * size);
    return out;
  };
  const uv = new Float32Array(n1 * 2);
  const [u, v] = a.uvCell;
  for (let i = 0; i < n1; i++) (uv[i * 2] = u), (uv[i * 2 + 1] = v);
  g = body.clone();
  g.setAttribute("position", new Float32BufferAttribute(cat("position", a.pos, 3), 3));
  g.setAttribute("normal", new Float32BufferAttribute(cat("normal", a.nor, 3), 3));
  g.setAttribute("uv", new Float32BufferAttribute(cat("uv", Array.from(uv), 2), 2));
  g.setAttribute("color", new Float32BufferAttribute(cat("color", a.col, 3, () => [1, 1, 1]), 3));
  const si = new Uint16Array((n0 + n1) * 4);
  si.set(body.attributes.skinIndex.array as Uint16Array, 0);
  si.set(a.si, n0 * 4);
  g.setAttribute("skinIndex", new Uint16BufferAttribute(si, 4));
  g.setAttribute("skinWeight", new Float32BufferAttribute(cat("skinWeight", a.sw, 4), 4));
  const idx = Array.from(body.index!.array as ArrayLike<number>);
  for (const i of a.idx) idx.push(i + n0);
  g.setIndex(idx);
  g.boundingSphere = new Sphere(new Vector3(0, 0.9, 0), 1.3);
  merged.set(key, g);
  // A handful of bodies × tiers × kits × levels: keep the newest 120.
  if (merged.size > 120) {
    const first = merged.keys().next().value!;
    merged.get(first)!.dispose();
    merged.delete(first);
  }
  return g;
}

/** Triangles the gear adds at a tier and level (for the crowd's budget; measured once). */
export function gearTriangles(g: BufferGeometry, body: BufferGeometry): number {
  return ((g.index?.count ?? 0) - (body.index?.count ?? 0)) / 3;
}

// ── Zombie pieces (v4 Phase 5): what rot alone can't show ─────────────────────

/** A zombie kind's extra pieces: a gas mask (Masked), a swollen belly (Bloater), ribs or a forearm bone showing. */
function buildZombie(fit: Fit, kind: string, level: Detail): Acc {
  const a = new Acc();
  const R = fit.rest;
  const hb = fit.box.head;
  const cb = fit.box.chest;
  if (!hb || !cb || level === 0) return a;
  const bone = lin("#c9c2ac");
  const gore = lin("#2a0806");
  const fleshC = lin("#5e6148");
  const eyeY = (R.eyeL.y + R.eyeR.y) / 2;
  const eyeZ = Math.max(R.eyeL.z, R.eyeR.z);
  const hc = new Vector3().addVectors(hb.min, hb.max).multiplyScalar(0.5);
  if (kind === "masked") {
    // A cracked modern gas mask (never a traditional mask): a face seal, two lenses, a filter, the straps.
    const rubber = lin("#1c1c1a");
    a.add(new SphereGeometry(1, 10, 6, 0, Math.PI, 0, Math.PI), M(hc.x, eyeY - 0.035, eyeZ - 0.035, 0, -Math.PI / 2, 0, (hb.max.x - hb.min.x) * 0.5, 0.075, 0.07), "head", rubber);
    for (const e of [R.eyeL, R.eyeR]) a.add(new CylinderGeometry(0.019, 0.02, 0.012, 10), M(e.x, e.y, eyeZ + 0.032, Math.PI / 2), "head", lin("#3d4a45"));
    a.add(new CylinderGeometry(0.026, 0.03, 0.05, 10), M(hc.x, eyeY - 0.07, eyeZ + 0.035, Math.PI / 2 - 0.5), "head", lin("#2b2b29"));
    a.add(new TorusGeometry((hb.max.x - hb.min.x) * 0.52, 0.006, 4, 16), M(hc.x, eyeY + 0.02, hc.z, 0.1, 0, 0, 1, 1, 1.05), "head", rubber);
  }
  if (kind === "bloater") {
    // A swollen belly over the hoodie's front.
    const sb = fit.box.spine ?? cb;
    a.add(new SphereGeometry(1, 10, 8), M((cb.min.x + cb.max.x) / 2, (sb.min.y + cb.min.y) / 2 + 0.03, cb.max.z - 0.02, 0, 0, 0, (cb.max.x - cb.min.x) * 0.42, 0.17, 0.13), "spine", fleshC, "chest", 0.3);
  }
  if (kind === "runner" || kind === "screamer" || kind === "lurker" || kind === "brute") {
    // Ribs showing through a hole on the chest's left: the dark wound, four ribs across it.
    const x = (cb.min.x + cb.max.x) / 2 + (cb.max.x - cb.min.x) * 0.18;
    const y = (cb.min.y + cb.max.y) / 2;
    const z = cb.max.z + 0.004;
    a.add(new BoxGeometry(0.11, 0.13, 0.008), M(x, y, z), "chest", gore);
    for (let k = 0; k < 4; k++) a.add(new BoxGeometry(0.105, 0.012, 0.012), M(x, y - 0.045 + k * 0.03, z + 0.008, 0, 0, (k - 1.5) * 0.06), "chest", bone);
  }
  if (kind === "shambler" || kind === "brute") {
    // A forearm torn open to the bone (the left).
    const e = R.foreArmL;
    const hnd = R.handL;
    const mid = new Vector3((e.x * 0.6 + hnd.x * 0.4), (e.y * 0.6 + hnd.y * 0.4), (e.z * 0.6 + hnd.z * 0.4));
    const dir = new Vector3(hnd.x - e.x, hnd.y - e.y, hnd.z - e.z).normalize();
    const mm = new Matrix4().compose(mid, new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir), new Vector3(1, 1, 1));
    a.add(new CylinderGeometry(0.036, 0.034, 0.12, 7), mm.clone(), "foreArmL", gore);
    a.add(new CylinderGeometry(0.012, 0.012, 0.16, 6), mm.clone().multiply(new Matrix4().makeTranslation(0.022, 0, 0.02)), "foreArmL", bone);
  }
  return a;
}

/** A zombie's geometry: the body with its kind's pieces in it (cached). */
export function zombieGeometry(body: BufferGeometry, rest: Record<BoneName, V3>, kind: string, level: Detail): BufferGeometry {
  return mergeInto(body, `${body.uuid}|z:${kind}`, () => buildZombie(fitOf(body, rest), kind, level));
}

// ── v6 max (3.7): growth's armour on the operators ─────────────────────────────
//
// The owner: "same size, no giant; make the armour fiercer, like a real robotic
// sci-fi helmet, and more as they keep getting more". Each Titan Serum level
// adds to it, on the operator's own bones (its own skinned mesh: Human.setArmour):
//
//   level 1  a robotic half-helmet: a faceted gunmetal crown, cheek plates, and
//            a red T-visor glowing across the eyes; small shoulder caps
//   level 2  the full helmet: a jaw guard, ear pods with glowing rings, a fin at
//            the back; a chest plate with a red reactor core; gauntlets with
//            light strips; bigger pauldrons
//   level 3  the war crest: swept-back horn fins and a ridge of plates, red light
//            lines along the helmet; spiked pauldrons; thigh and knee plates
//
// Colours above 1 glow (the material adds them as light: no real lights).

const GUN = lin("#4d535c");
const CARBON = lin("#26282d");
const EDGE = lin("#8f98a3");
const RED = lin("#ff1408", 3.2);
const RED_DIM = lin("#ff2410", 2.2);

/** A curved plate: an arc of an open cylinder (radius r, `arc` radians wide, `h` tall), its middle facing +z. */
function shellArc(r: number, h: number, arc: number, seg = 6): CylinderGeometry {
  return new CylinderGeometry(r, r, h, seg, 1, true, -arc / 2, arc);
}

function buildGrowth(fit: Fit, lv: number, level: Detail): Acc {
  const a = new Acc();
  const R = fit.rest;
  const hb = fit.box.head;
  const cb = fit.box.chest;
  if (!hb || !cb || lv <= 0) return a;
  const far = level === 0;
  const seg = far ? 6 : 8;
  const hc = new Vector3().addVectors(hb.min, hb.max).multiplyScalar(0.5);
  const hr = new Vector3().subVectors(hb.max, hb.min).multiplyScalar(0.5);
  const eyeY = (R.eyeL.y + R.eyeR.y) / 2;
  const eyeZ = Math.max(R.eyeL.z, R.eyeR.z);
  const rx = hr.x * 1.18;
  const rz = hr.z * 1.14;
  const top = hb.max.y + 0.02;
  const ry = (top - eyeY) * 1.0;
  const cy = top - ry;
  // ── Level 1: the half-helmet and the T-visor. ──
  // A faceted crown (few segments: the hard, machined look), down to the brow at the front.
  a.add(new SphereGeometry(1, seg, 4, 0, Math.PI * 2, 0, Math.PI * (lv >= 2 ? 0.66 : 0.56)), M(hc.x, cy + 0.006, hc.z - 0.006, -0.14, 0, 0, rx, ry * 1.06, rz), "head", GUN);
  const vz = eyeZ + 0.026;
  // The visor: a band across the eyes, glowing, and its stem down the nose (the T).
  a.add(new BoxGeometry(rx * 1.62, 0.022, 0.018), M(hc.x, eyeY + 0.002, vz), "head", RED);
  if (!far) {
    a.add(new BoxGeometry(0.014, 0.034, 0.016), M(hc.x, eyeY - 0.026, vz - 0.002), "head", RED_DIM);
    // The visor's frame, above and below the light.
    a.add(new BoxGeometry(rx * 1.72, 0.012, 0.022), M(hc.x, eyeY + 0.02, vz - 0.002, 0.1), "head", CARBON);
    // Cheek plates.
    for (const s of [-1, 1]) a.add(new BoxGeometry(0.018, 0.06, 0.07), M(hc.x + s * rx * 0.86, eyeY - 0.03, hc.z + rz * 0.45, 0, s * 0.35, s * 0.08), "head", EDGE);
  }
  // Shoulder caps.
  for (const side of ["L", "R"] as const) {
    const sh = R[`upperArm${side}`];
    const s = side === "L" ? 1 : -1;
    const big = lv >= 3 ? 1.45 : lv >= 2 ? 1.25 : 1;
    a.add(new SphereGeometry(0.07 * big, 6, 3, 0, Math.PI * 2, 0, Math.PI * 0.5), M(sh.x + s * 0.028, sh.y + 0.008, sh.z, 0, 0, -s * 0.38, 1, 0.7, 1.05), `upperArm${side}`, GUN);
    if (!far && lv >= 2) a.add(new BoxGeometry(0.008, 0.008, 0.11 * big), M(sh.x + s * 0.06 * big, sh.y + 0.03, sh.z, 0, 0, -s * 0.38), `upperArm${side}`, RED_DIM);
    if (!far && lv >= 3) for (let k = 0; k < 2; k++) a.add(new ConeGeometry(0.014, 0.075, 5), M(sh.x + s * (0.05 + k * 0.03), sh.y + 0.075 - k * 0.01, sh.z - 0.02 + k * 0.035, 0, 0, -s * (0.55 + k * 0.2)), `upperArm${side}`, EDGE);
  }
  if (lv < 2) return a;
  // ── Level 2: the full helmet, the reactor, the gauntlets. ──
  // The jaw guard: an angled wedge under the visor, round to the ears.
  a.add(new CylinderGeometry(rx * 0.92, rx * 0.72, 0.075, seg, 1, true, -Math.PI * 0.62, Math.PI * 1.24), M(hc.x, eyeY - 0.06, hc.z + 0.01, 0.12, 0, 0, 1, 1, rz / rx), "head", GUN);
  if (!far) {
    // Ear pods with a glowing ring.
    for (const s of [-1, 1]) {
      a.add(new CylinderGeometry(0.034, 0.034, 0.03, 8), M(hc.x + s * (hr.x + 0.016), eyeY - 0.005, hc.z - 0.008, 0, 0, Math.PI / 2), "head", CARBON);
      a.add(new TorusGeometry(0.024, 0.004, 3, 10), M(hc.x + s * (hr.x + 0.033), eyeY - 0.005, hc.z - 0.008, 0, Math.PI / 2, 0), "head", RED_DIM);
    }
    // A fin down the back of the head.
    a.add(new BoxGeometry(0.012, 0.05, rz * 1.3), M(hc.x, top - 0.012, hc.z - rz * 0.25, -0.25), "head", EDGE);
  }
  // The chest plate and its reactor core.
  const cx = (cb.min.x + cb.max.x) / 2;
  const zF = cb.max.z + 0.016;
  const pw = (cb.max.x - cb.min.x) * 0.66;
  const py = R.neck.y - 0.13;
  // Curved round the front of the chest (an arc of a cylinder its own depth), the core set in it.
  const cr = (cb.max.z - cb.min.z) * 0.62;
  const ccz = zF - cr;
  a.add(shellArc(cr, 0.16, pw / cr, 8), M(cx, py, ccz, -0.08), "chest", GUN);
  a.add(new CylinderGeometry(0.03, 0.03, 0.012, 10), M(cx, py + 0.005, zF + 0.012, Math.PI / 2 - 0.08), "chest", RED);
  if (!far) {
    a.add(new TorusGeometry(0.038, 0.006, 3, 12), M(cx, py + 0.005, zF + 0.011, -0.08), "chest", EDGE);
    // Its edge, top and bottom.
    a.add(shellArc(cr + 0.004, 0.012, pw / cr, 8), M(cx, py + 0.08, ccz, -0.08), "chest", EDGE);
    // Gauntlets with a light strip along each.
    for (const side of ["L", "R"] as const) {
      const e = R[`foreArm${side}`];
      const hnd = R[`hand${side}`];
      const mid = new Vector3((e.x + hnd.x) / 2, (e.y + hnd.y) / 2, (e.z + hnd.z) / 2);
      const dir = new Vector3(hnd.x - e.x, hnd.y - e.y, hnd.z - e.z);
      const len = dir.length() * 0.8;
      dir.normalize();
      const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
      a.add(new CylinderGeometry(0.045, 0.038, len, 6, 1, true), new Matrix4().compose(mid, q, new Vector3(1, 1, 1)), `foreArm${side}`, GUN);
      const strip = mid.clone().add(new Vector3(0, 0, 0.044).applyQuaternion(q));
      a.add(new BoxGeometry(0.008, len * 0.85, 0.006), new Matrix4().compose(strip, q, new Vector3(1, 1, 1)), `foreArm${side}`, RED_DIM);
    }
  }
  if (lv < 3) return a;
  // ── Level 3: the war crest, the light lines, thigh and knee plates. ──
  for (const s of [-1, 1]) {
    // Swept-back horn fins from the temples.
    a.add(new ConeGeometry(0.02, 0.17, 5), M(hc.x + s * rx * 0.78, cy + ry * 0.62, hc.z - 0.03, -0.9, 0, -s * 0.5), "head", EDGE);
    if (!far) a.add(new BoxGeometry(0.006, 0.006, rz * 1.5), M(hc.x + s * rx * 0.55, cy + ry * 0.78, hc.z - 0.01, -0.2, 0, -s * 0.3), "head", RED_DIM);
  }
  if (!far) {
    // A ridge of plates over the crown.
    for (let k = 0; k < 4; k++) a.add(new BoxGeometry(0.016, 0.03 - k * 0.004, 0.035), M(hc.x, top + 0.008 - k * 0.012, hc.z + 0.04 - k * 0.04, -0.3 - k * 0.25), "head", GUN);
    for (const side of ["L", "R"] as const) {
      const th = fit.box[`thigh${side}`];
      const shin = fit.box[`shin${side}`];
      if (th) {
        // A curved plate round the front of the thigh.
        const tr = Math.max(th.max.x - th.min.x, th.max.z - th.min.z) * 0.5;
        const tz = (th.min.z + th.max.z) / 2;
        a.add(shellArc(tr, (th.max.y - th.min.y) * 0.3, 1.3, 6), M((th.min.x + th.max.x) / 2, (th.min.y + th.max.y) / 2 + 0.02, tz, 0.05), `thigh${side}`, GUN);
      }
      if (shin) {
        // A knee cop: a small curved shell with a red slit.
        const kx = (shin.min.x + shin.max.x) / 2;
        const kr = (shin.max.x - shin.min.x) * 0.55;
        const kz = (shin.min.z + shin.max.z) / 2;
        a.add(shellArc(kr, 0.09, 1.8, 6), M(kx, shin.max.y - 0.02, kz + 0.006), `shin${side}`, EDGE);
        a.add(new BoxGeometry(0.03, 0.006, 0.006), M(kx, shin.max.y - 0.02, kz + kr + 0.01), `shin${side}`, RED);
      }
    }
  }
  return a;
}

const growthCache = new Map<string, BufferGeometry>();

/**
 * v6 max (3.7): growth level `lv`'s armour for an operator's body (its own geometry, the body's bones and skin
 * attributes; colours per vertex, those above 1 glowing). Cached by the body and the level.
 */
export function growthGeometry(body: BufferGeometry, rest: Record<BoneName, V3>, lv: number, level: Detail): BufferGeometry {
  const key = `${body.uuid}|${lv}`;
  let g = growthCache.get(key);
  if (g) return g;
  const a = buildGrowth(fitOf(body, rest), lv, level);
  g = new (body.constructor as new () => BufferGeometry)();
  g.setAttribute("position", new Float32BufferAttribute(a.pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(a.nor, 3));
  g.setAttribute("color", new Float32BufferAttribute(a.col, 3));
  g.setAttribute("skinIndex", new Uint16BufferAttribute(a.si, 4));
  g.setAttribute("skinWeight", new Float32BufferAttribute(a.sw, 4));
  g.setIndex(a.idx);
  g.boundingSphere = new Sphere(new Vector3(0, 0.9, 0), 1.3);
  growthCache.set(key, g);
  if (growthCache.size > 48) {
    const first = growthCache.keys().next().value!;
    growthCache.get(first)!.dispose();
    growthCache.delete(first);
  }
  return g;
}
