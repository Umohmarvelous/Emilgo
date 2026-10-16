// Normal maps for people, generated (SPEC-V2 §5.2): detail without triangles.
//
// A height field is computed straight from the UV layout (layout.ts) — cloth
// weave by pattern (denim twill, knit ribs, plain weave, smooth sheen), side
// seams, a zip, waist and knee and elbow folds, skin pores, hair strands and
// coils — then turned into a tangent-space normal map (+X along u, +Y along v,
// the OpenGL convention three.js expects).
//
// Cached by what changes the relief: body, outfit, hair and size. A whole room
// in the black uniform shares a few maps. Medium uses 256 px, High 512 px.

import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, RepeatWrapping, UnsignedByteType } from "three";

import { UV, type Rect } from "./layout";
import { skirtSpan } from "./mesh";
import { PROPORTIONS, restPositions, type Proportions } from "./skeleton";
import { OUTFIT_BY_ID, type Look, type Outfit, type Pattern } from "./wardrobe";

const cache = new Map<string, DataTexture>();

export function normalMapFor(look: Look, size: number): DataTexture {
  const key = `${size}|${look.body}|${look.outfit}|${look.hair}`;
  let t = cache.get(key);
  if (!t) {
    t = build(look, size);
    cache.set(key, t);
    if (cache.size > 24) {
      const first = cache.keys().next().value!;
      cache.get(first)!.dispose();
      cache.delete(first);
    }
  }
  return t;
}

// ── Relief primitives (all return −1..1, multiplied by an amplitude) ─────────

const TAU = Math.PI * 2;
/** A soft groove centred on 0 (width in the same units as d). */
const groove = (d: number, w: number) => -Math.exp(-(d * d) / (w * w));
const ridge = (d: number, w: number) => Math.exp(-(d * d) / (w * w));
/** Cheap hash noise in 0..1. */
function n2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Cloth texture at metric position (x round, y along), metres. `mpp` is metres
 * per texel: anything finer than four texels would alias into stripes, so a
 * fine weave is left to the painted texture and only coarse relief stays.
 */
function weave(p: Pattern, x: number, y: number, mpp: number): number {
  const ok = (period: number) => period / mpp >= 4;
  switch (p.kind) {
    case "denim":
      // Diagonal twill.
      return ok(0.012) ? Math.sin(((x + y) / 0.012) * TAU) * 0.35 : 0;
    case "knit":
      // Ribs.
      return ok(0.012) ? Math.sin((x / 0.012) * TAU) * 0.8 : 0;
    default:
      return 0;
  }
}

/**
 * A few soft creases bunching round a joint at height `at` (metres along),
 * `span` wide: wide, uneven and fading out, so they read as cloth, not ribbing.
 */
function folds(x: number, y: number, at: number, span: number, seed: number): number {
  const d = (y - at) / span;
  if (Math.abs(d) > 1.8) return 0;
  const env = Math.exp(-d * d * 1.5);
  const bend = Math.sin(x * 9 + seed) * 0.012 + Math.sin(x * 23 + seed * 2.7) * 0.004;
  return Math.sin(((y + bend) / 0.032) * TAU + seed) * env * (0.6 + 0.4 * Math.sin(x * 5 + seed * 1.9));
}

/** Skin: the faintest grain (anything stronger reads as a rash at game distance). */
const skinPores = (x: number, y: number) => (n2(Math.floor(x / 0.003), Math.floor(y / 0.003)) - 0.5) * 0.1;

// ── Building ─────────────────────────────────────────────────────────────────

type HeightFn = (u: number, v: number) => number;

function build(look: Look, size: number): DataTexture {
  const p = PROPORTIONS[look.body];
  const o = OUTFIT_BY_ID[look.outfit];
  const regions: [Rect, HeightFn][] = [
    [UV.torso, torsoH(p, o, size)],
    [UV.armL, armH(p, o, size)],
    [UV.armR, armH(p, o, size)],
    [UV.legL, legH(p, o, size)],
    [UV.legR, legH(p, o, size)],
    [UV.skirt, skirtH(p, o, size)],
    [UV.head, (u, v) => skinPores(u * 0.6, v * 0.5)],
    [UV.hair, hairH(look.hair)],
  ];
  // Height field, row 0 = v 0 (DataTexture: no flip).
  const H = new Float32Array(size * size);
  for (const [r, fn] of regions) {
    const x0 = Math.floor(r[0] * size);
    const x1 = Math.ceil(r[2] * size);
    const y0 = Math.floor(r[1] * size);
    const y1 = Math.ceil(r[3] * size);
    const w = r[2] - r[0];
    const h = r[3] - r[1];
    for (let py = y0; py < y1; py++) {
      const v = ((py + 0.5) / size - r[1]) / h;
      for (let px = x0; px < x1; px++) {
        const u = ((px + 0.5) / size - r[0]) / w;
        H[py * size + px] = fn(u, v);
      }
    }
  }
  // Heights → normals. Strength in "height units per texel": gentle, so the
  // painted look still leads and only the light picks out the relief.
  const k = size >= 512 ? 1.6 : 1.1;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const ya = Math.max(0, y - 1) * size;
    const yb = Math.min(size - 1, y + 1) * size;
    for (let x = 0; x < size; x++) {
      const xa = Math.max(0, x - 1);
      const xb = Math.min(size - 1, x + 1);
      const du = (H[y * size + xb] - H[y * size + xa]) * k;
      const dv = (H[yb + x] - H[ya + x]) * k;
      let nx = -du;
      let ny = -dv;
      let nz = 1;
      const l = 1 / Math.hypot(nx, ny, nz);
      nx *= l;
      ny *= l;
      nz *= l;
      const i = (y * size + x) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// ── Regions (u round from the back seam, v along; see paint.ts) ──────────────

function torsoMetrics(p: Proportions): { circ: number; len: number; y0: number } {
  const r = p.torso;
  let c = 0;
  for (const [, rx, f, b] of r) c += Math.PI * (rx + (f + b) / 2);
  return { circ: c / r.length, len: r[r.length - 1][0] - r[0][0], y0: r[0][0] };
}

/** Metres per texel across a region of `circ` metres. */
const mppOf = (rect: Rect, circ: number, size: number) => circ / ((rect[2] - rect[0]) * size);

function torsoH(p: Proportions, o: Outfit, size: number): HeightFn {
  const { circ, len, y0 } = torsoMetrics(p);
  const mpp = mppOf(UV.torso, circ, size);
  const waistV = (p.waistY - y0) / len;
  const bottom = o.bottom.kind !== "dress";
  return (u, v) => {
    const x = u * circ;
    const y = v * len;
    // Below the waist the bottom garment, above it the top.
    const pat = bottom && v < waistV ? o.bottom.pattern : o.top.pattern;
    let h = weave(pat, x, y, mpp) * 0.35;
    // Side seams.
    h += groove(u - 0.25, 0.006) * 0.9 + groove(u - 0.75, 0.006) * 0.9;
    // Waistband ridge, and folds above it.
    if (bottom) h += ridge(v - waistV, 0.018) * 0.7 + folds(x, y, (waistV + 0.06) * len, 0.04, 1.3) * 0.18;
    // The uniform's zip, centre front.
    if (o.uniform) h += groove(u - 0.5, 0.0035) * 1.2 + ridge(Math.abs(u - 0.5) - 0.006, 0.002) * 0.4;
    return h;
  };
}

function armH(p: Proportions, o: Outfit, size: number): HeightFn {
  const rest = restPositions(p);
  const len = rest.upperArmL.y + 0.025 - (rest.handL.y - 0.01);
  const circ = Math.PI * 2 * p.arm[1];
  const elbowV = 1 - p.upperArm / len;
  const sl = o.top.sleeve;
  const mpp = mppOf(UV.armL, circ, size);
  const from = sl === "long" ? 0.012 / len : sl === "short" ? 1 - (p.upperArm / len) * 0.55 : 1.01;
  return (u, v) => {
    const x = u * circ;
    const y = v * len;
    if (v < from) return skinPores(x, y);
    let h = weave(o.top.pattern, x, y, mpp) * 0.35;
    if (sl === "long") h += folds(x, y, elbowV * len, 0.045, 2.1) * 0.25;
    // Cuff ridge.
    h += ridge(v - from - 0.02, 0.01) * 0.4;
    return h;
  };
}

function legH(p: Proportions, o: Outfit, size: number): HeightFn {
  const top = p.hipY + 0.07;
  const bottom = p.ankleY - 0.015;
  const len = top - bottom;
  const circ = Math.PI * 2 * p.leg[0];
  const kneeV = (p.hipY - p.thigh - bottom) / len;
  const b = o.bottom;
  const mpp = mppOf(UV.legL, circ, size);
  const skirt = b.kind === "skirt" || b.kind === "dress";
  const clothFrom = skirt ? (skirtSpan(p, o)[1] + 0.03 - bottom) / len : b.kind === "shorts" ? (p.hipY - p.thigh * 0.55 - bottom) / len : b.length === "knee" ? kneeV - 0.02 : 0;
  return (u, v) => {
    const x = u * circ;
    const y = v * len;
    if (v < clothFrom) return skinPores(x, y);
    let h = weave(b.pattern, x, y, mpp) * 0.35;
    h += groove(u - 0.25, 0.007) * 0.8 + groove(u - 0.75, 0.007) * 0.8;
    if (!skirt) h += folds(x, y, kneeV * len, 0.05, 0.7) * 0.22 + folds(x, y, 0.04, 0.035, 3.3) * 0.18;
    return h;
  };
}

function skirtH(p: Proportions, o: Outfit, size: number): HeightFn {
  if (o.bottom.kind !== "skirt" && o.bottom.kind !== "dress") return () => 0;
  const [topY, hemY] = skirtSpan(p, o);
  const len = topY - hemY;
  const circ = Math.PI * 2 * (p.hipX + p.leg[1] + 0.06);
  const flare = o.bottom.flare ?? 0;
  const mpp = mppOf(UV.skirt, circ, size);
  return (u, v) => {
    const x = u * circ;
    const y = v * len;
    return weave(o.bottom.pattern, x, y, mpp) * 0.35 + Math.sin(u * TAU * 10) * (0.2 + flare * 0.8) * (1 - v * 0.7);
  };
}

function hairH(id: Look["hair"]): HeightFn {
  if (id === "afro" || id === "locs" || id === "fade") {
    // Coils: little domes on a jittered grid.
    return (u, v) => {
      const s = id === "locs" ? 34 : 60;
      const cx = Math.floor(u * s);
      const cy = Math.floor(v * s * 0.5);
      const jx = cx + 0.5 + (n2(cx, cy) - 0.5) * 0.5;
      const jy = cy + 0.5 + (n2(cy, cx) - 0.5) * 0.5;
      const d = Math.hypot(u * s - jx, v * s * 0.5 - jy);
      return Math.max(0, 1 - d * 1.8) * 1.2 - 0.4;
    };
  }
  if (id === "braids") return (u, v) => Math.abs(Math.sin(u * TAU * 16)) * 1.2 + Math.sin((v * 40 + u * 16) * TAU) * 0.3;
  if (id === "bald") return (u, v) => skinPores(u * 0.4, v * 0.3);
  // Strands, front to back.
  return (u, v) => Math.sin(u * TAU * 90 + Math.sin(v * 9) * 2) * 0.35 + (n2(Math.floor(u * 160), 0) - 0.5) * 0.4;
}
