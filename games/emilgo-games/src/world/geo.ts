// Low-poly geometry helpers.
//
// Everything static in the street is built from three.js primitives, coloured
// per vertex and merged into ONE mesh. That is the whole performance story of
// the scene: one draw call for the entire street, no texture downloads, no
// model files — the game is playable as soon as its script has loaded.
//
// Flat shading comes from geometry, not the material: each primitive is made
// non-indexed so no two faces share a vertex, then normals are recomputed, so
// every face is lit as one flat facet. That is the low-poly look.

import {
  BufferGeometry,
  Color,
  Euler,
  type EulerOrder,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";

export type V3 = [number, number, number];

export interface Xform {
  p?: V3;
  r?: V3;
  /** Euler order for `r` (default XYZ). "YXZ" = tilt first, then spin about Y. */
  o?: EulerOrder;
  s?: number | V3;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();

export function matrixOf(x: Xform, out = new Matrix4()): Matrix4 {
  _p.set(...(x.p ?? [0, 0, 0]));
  const r = x.r ?? [0, 0, 0];
  _e.set(r[0], r[1], r[2], x.o ?? "XYZ");
  _q.setFromEuler(_e);
  const s = x.s ?? 1;
  if (typeof s === "number") _s.set(s, s, s);
  else _s.set(...s);
  return out.compose(_p, _q, _s);
}

/**
 * A transformed, flat-shaded, vertex-coloured copy of `geo`.
 * `shade` multiplies the colour (0.2 = a dark version of it) — used for
 * shoes, hair and windows inside a single-coloured instanced part.
 */
export function part(geo: BufferGeometry, color: number | string, x: Xform = {}, shade = 1): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute("uv");
  g.deleteAttribute("normal");
  g.applyMatrix4(matrixOf(x, _m));
  g.computeVertexNormals();
  paint(g, color, shade);
  return g;
}

/** Fill a geometry's colour attribute with one colour. */
export function paint(g: BufferGeometry, color: number | string, shade = 1): BufferGeometry {
  _c.set(color).multiplyScalar(shade);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  return g;
}

/** Re-place an already-built part (or merged group of parts). Returns a new geometry. */
export function moved(g: BufferGeometry, x: Xform): BufferGeometry {
  const c = g.clone();
  c.applyMatrix4(matrixOf(x, _m));
  return c;
}

/**
 * Concatenate parts that all have position/normal/color (and optionally uv).
 * Cheaper and stricter than BufferGeometryUtils: a part missing an attribute is
 * a bug, so it throws instead of quietly dropping it.
 */
export function merge(parts: BufferGeometry[], withUv = false): BufferGeometry {
  let count = 0;
  for (const p of parts) count += p.attributes.position.count;

  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const uv = withUv ? new Float32Array(count * 2) : null;

  let o = 0;
  for (const p of parts) {
    const n = p.attributes.position.count;
    const a = p.attributes;
    if (!a.normal || !a.color || (withUv && !a.uv)) throw new Error("merge: part is missing an attribute");
    pos.set(a.position.array as Float32Array, o * 3);
    nor.set(a.normal.array as Float32Array, o * 3);
    col.set(a.color.array as Float32Array, o * 3);
    if (uv) uv.set(a.uv.array as Float32Array, o * 2);
    o += n;
  }

  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  if (uv) g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

/**
 * A flat quad (two triangles) with UVs mapped to a rectangle of a texture
 * atlas: [u0, v0, u1, v1]. Lies in the XY plane, centred, facing +Z.
 */
export function atlasQuad(w: number, h: number, cell: [number, number, number, number], x: Xform = {}): BufferGeometry {
  const [u0, v0, u1, v1] = cell;
  const hw = w / 2;
  const hh = h / 2;
  const g = new BufferGeometry();
  g.setAttribute(
    "position",
    new Float32BufferAttribute([-hw, -hh, 0, hw, -hh, 0, hw, hh, 0, -hw, -hh, 0, hw, hh, 0, -hw, hh, 0], 3),
  );
  g.setAttribute("uv", new Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1], 2));
  g.applyMatrix4(matrixOf(x, _m));
  g.computeVertexNormals();
  paint(g, 0xffffff);
  return g;
}

/** Linear-space colour from an sRGB hex, for vertex/instance colours. */
export function linear(hex: number | string): Color {
  return new Color(hex);
}
