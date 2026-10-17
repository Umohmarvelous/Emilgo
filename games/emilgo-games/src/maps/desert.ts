// The Desert Field's props (SPEC-V2 §6.1): cacti, abandoned cars, bones, tyres,
// barrels, a signpost, grass patches and tufts. Smooth-shaded where it reads
// as a curved thing (cacti, bones, tyres), within the props budget per tier
// (1,000 / 1,500 / 2,500 triangles at most for the biggest, the cars).
//
// Every prop sits at the ground's height where it stands (`y`), and never
// inside the field: the referee has no notion of obstacles.

import { BufferGeometry, BoxGeometry, Color, CylinderGeometry, Float32BufferAttribute, SphereGeometry, TorusGeometry } from "three";

import { matrixOf, merge, paint, part, type V3, type Xform } from "../world/geo";
import type { Kit, Level } from "./kit";

/** A transformed, SMOOTH-shaded, vertex-coloured copy (curved props). */
function smooth(geo: BufferGeometry, color: string, x: Xform): BufferGeometry {
  const g = geo.clone();
  g.applyMatrix4(matrixOf(x));
  g.computeVertexNormals();
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute("uv");
  return paint(n, color);
}

/** Vertex colours varied by a seeded noise: sun-bleached, dusty, never flat. */
function weather(g: BufferGeometry, k: Kit, amount = 0.12): BufferGeometry {
  const c = g.attributes.color;
  const p = g.attributes.position;
  for (let i = 0; i < c.count; i++) {
    const n = 1 + (Math.sin(p.getX(i) * 7.1 + p.getY(i) * 3.3) * 0.5 + Math.sin(p.getZ(i) * 5.7 - p.getY(i) * 2.1) * 0.5) * amount;
    c.setXYZ(i, c.getX(i) * n, c.getY(i) * n, c.getZ(i) * n);
  }
  void k;
  return g;
}

function put(k: Kit, parts: BufferGeometry[], level: Level, z: number, worn = 0.1): void {
  const g = weather(merge(parts), k, worn);
  k.put(g, level, z);
}

const seg = (k: Kit, lo: number, mid: number, hi: number) => (k.tier === 0 ? lo : k.tier === 1 ? mid : hi);

/** A saguaro: ribbed trunk, one or two arms, rounded tops. */
export function cactus(k: Kit, p: V3, h = 4, arms = 2): void {
  const r = k.rng;
  const s = seg(k, 8, 10, 14);
  const green = r.pick(["#4f7a3a", "#56803e", "#48703a"]);
  const body = new CylinderGeometry(0.28, 0.32, 1, s, 3);
  const cap = new SphereGeometry(0.28, s, Math.max(4, s / 2), 0, Math.PI * 2, 0, Math.PI / 2);
  const out: BufferGeometry[] = [smooth(body, green, { p: [p[0], p[1] + h / 2, p[2]], s: [1, h, 1] }), smooth(cap, green, { p: [p[0], p[1] + h, p[2]] })];
  for (let i = 0; i < arms; i++) {
    const side = i === 0 ? 1 : -1;
    const a = r.range(0, Math.PI * 2) * 0 + (side > 0 ? 0 : Math.PI) + r.range(-0.4, 0.4);
    const y = p[1] + h * r.range(0.38, 0.6);
    const out1 = 0.55;
    const up = h * r.range(0.25, 0.4);
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    // Out, then up.
    out.push(smooth(new CylinderGeometry(0.17, 0.19, 1, s), green, { p: [p[0] + dx * out1 * 0.5, y, p[2] + dz * out1 * 0.5], r: [dz * Math.PI * 0.5, 0, -dx * Math.PI * 0.5], s: [1, out1, 1] }));
    out.push(smooth(new SphereGeometry(0.18, s, Math.max(4, s / 2)), green, { p: [p[0] + dx * out1, y, p[2] + dz * out1] }));
    out.push(smooth(new CylinderGeometry(0.16, 0.18, 1, s), green, { p: [p[0] + dx * out1, y + up / 2, p[2] + dz * out1], s: [1, up, 1] }));
    out.push(smooth(cap.clone().scale(0.6, 0.6, 0.6), green, { p: [p[0] + dx * out1, y + up, p[2] + dz * out1] }));
  }
  put(k, out, "main", p[2], 0.14);
}

/** A low prickly pear: flat pads in a cluster. */
export function pricklyPear(k: Kit, p: V3): void {
  const r = k.rng;
  const s = seg(k, 6, 8, 10);
  const out: BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = r.range(0, Math.PI * 2);
    const y = p[1] + 0.25 + r.range(0, 0.55);
    out.push(smooth(new SphereGeometry(0.22, s, Math.max(4, s - 2)), r.pick(["#5f8a44", "#6b9450"]), { p: [p[0] + Math.cos(a) * r.range(0, 0.4), y, p[2] + Math.sin(a) * r.range(0, 0.4)], r: [r.range(-0.4, 0.4), a, r.range(-0.3, 0.3)], s: [1, 1.15, 0.28] }));
  }
  put(k, out, "detail", p[2]);
}

/** An abandoned car: rusted shell, no wheels on one side, half sunk in a drift of sand. */
export function wreck(k: Kit, p: V3, ry: number): void {
  const r = k.rng;
  const paint0 = r.pick(["#8a4a2a", "#6a5a3a", "#7a3a30", "#4a5a5a"]);
  const rust = "#6a3a1e";
  const dark = "#1a1612";
  const tilt: Xform["r"] = [r.range(-0.08, 0.08), ry, r.range(-0.12, 0.06)];
  const at = (x: number, y: number, z: number): V3 => {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    return [p[0] + x * c + z * s, p[1] + y, p[2] - x * s + z * c];
  };
  const out: BufferGeometry[] = [];
  const box = (color: string, size: V3, q: V3, rr: V3 = [0, 0, 0]) => out.push(part(new BoxGeometry(1, 1, 1, 2, 1, 2), color, { p: at(...q), r: [tilt![0] + rr[0], ry + rr[1], tilt![2] + rr[2]], s: size }));
  box(paint0, [1.8, 0.6, 4.2], [0, 0.5, 0]); // body
  box(paint0, [1.62, 0.5, 2.1], [0, 1.05, -0.2]); // cabin
  box(dark, [1.5, 0.42, 0.06], [0, 1.08, 0.86], [-0.35, 0, 0]); // windscreen hole
  box(dark, [1.5, 0.38, 0.06], [0, 1.08, -1.27], [0.4, 0, 0]); // rear window
  box(rust, [1.84, 0.12, 4.26], [0, 0.25, 0]); // rusted sill
  box(rust, [1.6, 0.08, 1.2], [0, 0.82, 1.5], [0.06, 0, 0]); // bonnet, ajar
  // Two wheels left, flat; two gone.
  const s = seg(k, 10, 14, 18);
  for (const [x, z] of [[0.92, 1.35], [0.92, -1.35]] as const) out.push(smooth(new TorusGeometry(0.3, 0.13, Math.max(6, s / 2), s), "#262220", { p: at(x, 0.32, z), r: [0, ry + Math.PI / 2, 0], s: [1, 0.85, 1] }));
  // Sand drifted against it.
  out.push(smooth(new SphereGeometry(1, s, Math.max(6, s / 2), 0, Math.PI * 2, 0, Math.PI / 2), "#d9b880", { p: at(-1.1, 0, 0.3), s: [1.2, 0.55, 2.6] }));
  put(k, out, "main", p[2], 0.16);
  k.colliders.push({ x: p[0], z: p[2], hx: 2.2, hz: 2.2, h: 1.4 });
}

/** A cow skull with horns, bleached. */
export function skull(k: Kit, p: V3, ry: number): void {
  const s = seg(k, 8, 10, 14);
  const bone = "#ece2cc";
  const c = Math.cos(ry);
  const sn = Math.sin(ry);
  const at = (x: number, y: number, z: number): V3 => [p[0] + x * c + z * sn, p[1] + y, p[2] - x * sn + z * c];
  const out: BufferGeometry[] = [
    smooth(new SphereGeometry(0.2, s, Math.max(6, s - 2)), bone, { p: at(0, 0.16, 0), r: [0, ry, 0], s: [1, 0.8, 1.3] }),
    smooth(new CylinderGeometry(0.07, 0.11, 0.42, s), bone, { p: at(0, 0.1, 0.3), r: [Math.PI / 2 - 0.25, ry, 0] }),
    smooth(new SphereGeometry(0.045, 6, 4), "#2a241c", { p: at(0.09, 0.2, 0.17) }),
    smooth(new SphereGeometry(0.045, 6, 4), "#2a241c", { p: at(-0.09, 0.2, 0.17) }),
  ];
  for (const side of [1, -1]) {
    out.push(smooth(new CylinderGeometry(0.012, 0.05, 0.42, s), "#d8c8a4", { p: at(side * 0.28, 0.32, -0.05), r: [0, ry, -side * 1.05] }));
  }
  put(k, out, "detail", p[2], 0.06);
}

/** A ribcage half buried, and a couple of long bones. */
export function bones(k: Kit, p: V3, ry: number): void {
  const r = k.rng;
  const s = seg(k, 8, 12, 16);
  const bone = "#e6dcc4";
  const c = Math.cos(ry);
  const sn = Math.sin(ry);
  const at = (x: number, y: number, z: number): V3 => [p[0] + x * c + z * sn, p[1] + y, p[2] - x * sn + z * c];
  const out: BufferGeometry[] = [smooth(new CylinderGeometry(0.05, 0.05, 1.4, Math.max(5, s / 2)), bone, { p: at(0, 0.12, 0), r: [Math.PI / 2, ry, 0] })];
  for (let i = 0; i < 6; i++) {
    out.push(smooth(new TorusGeometry(0.34 - i * 0.02, 0.025, 5, s, Math.PI * 0.9), bone, { p: at(0, 0.02, -0.55 + i * 0.22), r: [0, ry, Math.PI * 0.05] }));
  }
  for (let i = 0; i < 2; i++) {
    const q = at(r.range(0.6, 1.2), 0.04, r.range(-0.6, 0.6));
    const rr = r.range(0, Math.PI);
    out.push(smooth(new CylinderGeometry(0.035, 0.035, 0.7, Math.max(5, s / 2)), bone, { p: q, r: [Math.PI / 2, rr, 0] }));
    out.push(smooth(new SphereGeometry(0.06, 6, 4), bone, { p: [q[0] + Math.sin(rr) * 0.35, q[1], q[2] + Math.cos(rr) * 0.35] }));
  }
  put(k, out, "detail", p[2], 0.05);
}

/** An old tyre, half sunk. */
export function tyre(k: Kit, p: V3): void {
  const s = seg(k, 12, 16, 22);
  k.put(smooth(new TorusGeometry(0.42, 0.16, Math.max(6, s / 2), s), "#24201c", { p: [p[0], p[1] + 0.12, p[2]], r: [Math.PI / 2 + k.rng.range(-0.5, 0.5), k.rng.range(0, 3), 0] }), "detail", p[2]);
}

/** A rusted oil drum, standing or fallen. */
export function barrel(k: Kit, p: V3): void {
  const r = k.rng;
  const s = seg(k, 10, 14, 18);
  const fallen = r.chance(0.4);
  const col = r.pick(["#7a3a24", "#4a5a6a", "#8a6a2a"]);
  const g = smooth(new CylinderGeometry(0.3, 0.3, 0.88, s, 3), col, { p: [p[0], p[1] + (fallen ? 0.3 : 0.44), p[2]], r: fallen ? [Math.PI / 2, r.range(0, 3), 0] : [0, 0, 0] });
  k.put(weather(g, k, 0.25), "main", p[2]);
}

/** A leaning wooden signpost with a blank board (no words: SPEC-V2). */
export function signpost(k: Kit, p: V3, ry: number): void {
  const out = [
    part(new BoxGeometry(0.12, 2.4, 0.12), "#6a4a2e", { p: [p[0], p[1] + 1.2, p[2]], r: [0.06, ry, 0.08] }),
    part(new BoxGeometry(1.3, 0.34, 0.05), "#8a6a44", { p: [p[0], p[1] + 2.05, p[2]], r: [0.06, ry + 0.4, 0.1] }),
  ];
  put(k, out, "main", p[2], 0.2);
}

/** A patch of dry grass: a flat stain of greener sand, and tufts of blades on it. */
export function grassPatch(k: Kit, p: V3, size: number): void {
  const r = k.rng;
  // The stain: an irregular fan just above the ground.
  const n = 12;
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const radii = Array.from({ length: n }, () => size * r.range(0.6, 1));
  // A stain darker and greener than the sand under it (sRGB → linear via Color).
  const c = new Color(r.pick(["#9a9152", "#8f8a4e", "#a59a5c"]));
  const base = [c.r, c.g, c.b];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    pos.push(p[0], p[1] + 0.012, p[2], p[0] + Math.cos(a1) * radii[(i + 1) % n], p[1] + 0.012, p[2] + Math.sin(a1) * radii[(i + 1) % n], p[0] + Math.cos(a0) * radii[i], p[1] + 0.012, p[2] + Math.sin(a0) * radii[i]);
    for (let v = 0; v < 3; v++) {
      col.push(...base);
      nor.push(0, 1, 0);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  const out: BufferGeometry[] = [g];
  // Tufts: a few crossed blades.
  const tufts = Math.round(size * 2.5);
  for (let t = 0; t < tufts; t++) {
    const a = r.range(0, Math.PI * 2);
    const d = r.range(0, size * 0.8);
    const x = p[0] + Math.cos(a) * d;
    const z = p[2] + Math.sin(a) * d;
    const h = r.range(0.18, 0.42);
    const green = r.pick(["#7a8a3a", "#8a9444", "#9a9a52", "#6a7a34"]);
    for (let b = 0; b < 2; b++) {
      const ang = (b / 2) * Math.PI + r.range(-0.2, 0.2);
      out.push(part(new BoxGeometry(0.16, 1, 0.01), green, { p: [x, p[1] + h / 2, z], r: [r.range(-0.15, 0.15), ang, r.range(-0.15, 0.15)], s: [1, h, 1] }));
    }
  }
  k.put(merge(out), "detail", p[2]);
}
