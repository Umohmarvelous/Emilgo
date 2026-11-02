// Dev only (concept renders): hard-surface armour for the ladder's upper
// tiers. Plates are bevelled extrusions bent round the body (a few hundred
// triangles each, faceted on purpose so edges catch the light); horns are
// tapered tubes; capes are torn cloth. On a phone each tier's plates merge
// into one mesh per material on the body's bones: 2–3 extra draws.

import {
  CatmullRomCurve3,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  CylinderGeometry,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { fbm, paint, tex } from "./tex";

export interface PlateOpts {
  w: number;
  h: number;
  t?: number;
  /** Bend radius round Y (wraps the width); 0 = flat. */
  bend?: number;
  /** Bend radius round X (domes the height); 0 = flat. */
  dome?: number;
  bevel?: number;
  /** Corner radius of the outline. */
  corner?: number;
  /** Holes (visor slits), in plate coordinates. */
  holes?: [number, number][][];
  /** Taper: the bottom edge's width as a fraction of the top's. */
  taper?: number;
}

/** A bevelled plate, bent round the body. Lies in XY, outer face toward +Z. */
export function plate(o: PlateOpts): BufferGeometry {
  const { w, h } = o;
  const c = Math.min(o.corner ?? Math.min(w, h) * 0.18, w / 2.1, h / 2.1);
  const tb = (o.taper ?? 1) * w;
  const s = new Shape();
  const x0 = -w / 2;
  const x1 = w / 2;
  const b0 = -tb / 2;
  const b1 = tb / 2;
  const y0 = -h / 2;
  const y1 = h / 2;
  s.moveTo(b0 + c, y0);
  s.lineTo(b1 - c, y0);
  s.quadraticCurveTo(b1, y0, b1 + (x1 - b1) * (c / h), y0 + c);
  s.lineTo(x1, y1 - c);
  s.quadraticCurveTo(x1, y1, x1 - c, y1);
  s.lineTo(x0 + c, y1);
  s.quadraticCurveTo(x0, y1, x0, y1 - c);
  s.lineTo(b0 + (x0 - b0) * (c / h), y0 + c);
  s.quadraticCurveTo(b0, y0, b0 + c, y0);
  for (const hole of o.holes ?? []) {
    const p = new Path();
    hole.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
    p.closePath();
    s.holes.push(p);
  }
  const t = o.t ?? 0.012;
  const bv = o.bevel ?? Math.min(0.006, t * 0.6);
  const g = new ExtrudeGeometry(s, { depth: t, bevelEnabled: true, bevelThickness: bv, bevelSize: bv, bevelSegments: 2, curveSegments: 6, steps: 1 });
  g.translate(0, 0, -t / 2);
  // Subdivide the bend by re-meshing would cost triangles; the outline's own
  // vertices (curve segments) are enough for gentle bends on small plates.
  const p = g.attributes.position;
  const R = o.bend ?? 0;
  const D = o.dome ?? 0;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    if (R) {
      const a = x / R;
      const rr = R + z;
      x = rr * Math.sin(a);
      z = rr * Math.cos(a) - R;
    }
    if (D) {
      const a = y / D;
      const rr = D + z;
      y = rr * Math.sin(a);
      z = rr * Math.cos(a) - D;
    }
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

/** A plate wide enough to bend smoothly: built from strips so the bend has vertices to follow. */
export function wrapPlate(o: PlateOpts & { strips?: number }): BufferGeometry {
  // Extrusions only have vertices on the outline; for wide bends, insert a
  // grid of points by extruding a shape whose top and bottom edges are polylines.
  const n = o.strips ?? 10;
  const { w, h } = o;
  const tb = (o.taper ?? 1) * w;
  const s = new Shape();
  s.moveTo(-tb / 2, -h / 2);
  for (let i = 1; i <= n; i++) s.lineTo(-tb / 2 + (tb * i) / n, -h / 2);
  s.lineTo(w / 2, h / 2);
  for (let i = n - 1; i >= 0; i--) s.lineTo(-w / 2 + (w * i) / n, h / 2);
  s.closePath();
  for (const hole of o.holes ?? []) {
    const p = new Path();
    hole.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
    p.closePath();
    s.holes.push(p);
  }
  const t = o.t ?? 0.012;
  const bv = o.bevel ?? Math.min(0.006, t * 0.6);
  const g = new ExtrudeGeometry(s, { depth: t, bevelEnabled: true, bevelThickness: bv, bevelSize: bv, bevelSegments: 2, curveSegments: 4, steps: 1 });
  g.translate(0, 0, -t / 2);
  const p = g.attributes.position;
  const R = o.bend ?? 0;
  const D = o.dome ?? 0;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    if (R) {
      const a = x / R;
      const rr = R + z;
      x = rr * Math.sin(a);
      z = rr * Math.cos(a) - R;
    }
    if (D) {
      const a = y / D;
      const rr = D + z;
      y = rr * Math.sin(a);
      z = rr * Math.cos(a) - D;
    }
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

/** A tube along points, tapering from r0 to r1 (horns, spikes that curve). */
export function horn(points: Vector3[], r0: number, r1: number, seg = 24, radial = 10): BufferGeometry {
  const curve = new CatmullRomCurve3(points);
  const g = new TubeGeometry(curve, seg, 1, radial, false);
  const p = g.attributes.position;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const c = curve.getPointAt(t);
    const r = r0 + (r1 - r0) * Math.pow(t, 0.8);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      const v = new Vector3(p.getX(k), p.getY(k), p.getZ(k)).sub(c).multiplyScalar(r).add(c);
      p.setXYZ(k, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

export function put(g: BufferGeometry, m: Material, pos: [number, number, number], q?: Quaternion): Mesh {
  const o = new Mesh(g, m);
  o.position.set(...pos);
  if (q) o.quaternion.copy(q);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const X = new Vector3(1, 0, 0);
export const rotY = (a: number) => new Quaternion().setFromAxisAngle(Y, a);
export const rotZ = (a: number) => new Quaternion().setFromAxisAngle(Z, a);
export const rotX = (a: number) => new Quaternion().setFromAxisAngle(X, a);
/** a, then b (world frame). */
export const then = (a: Quaternion, b: Quaternion) => b.clone().multiply(a);

// ── Materials per tier ───────────────────────────────────────────────────────

export interface ArmourMats {
  plate: Material;
  trim: Material;
  dark: Material;
  glow: Material;
  cape?: Material;
}

export function armourMats(tier: number, base: { plate: Material; metal: Material }): ArmourMats {
  const glowCol = tier <= 1 ? 0x9bd6ff : tier === 2 ? 0x7fd8ff : tier === 3 ? 0xff2a10 : 0xffa418;
  const glow = new MeshStandardMaterial({ color: 0x050505, emissive: glowCol, emissiveIntensity: tier >= 3 ? 9 : 4, roughness: 0.3 });
  const dark = new MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.5, metalness: 0.6 });
  if (tier >= 4) {
    const trim = new MeshPhysicalMaterial({ color: 0xd9a441, roughness: 0.22, metalness: 1, clearcoat: 0.6 });
    const cape = new MeshStandardMaterial({ color: 0x120c08, roughness: 0.95, side: DoubleSide, alphaTest: 0.5, alphaMap: torn() });
    return { plate: base.plate, trim, dark, glow, cape };
  }
  if (tier === 3) {
    const trim = new MeshPhysicalMaterial({ color: 0x6b1410, roughness: 0.35, metalness: 0.9, clearcoat: 0.4 });
    const cape = new MeshStandardMaterial({ color: 0x4a0b0b, roughness: 0.95, side: DoubleSide, alphaTest: 0.5, alphaMap: torn() });
    return { plate: base.plate, trim, dark, glow, cape };
  }
  return { plate: base.plate, trim: base.metal, dark, glow };
}

function torn() {
  return tex(
    paint(256, 512, (u, v) => {
      const edge = 0.86 + fbm(u * 6, 0.5, 4, 6) * 0.12 - (Math.abs(u - 0.5) > 0.4 ? 0.04 : 0);
      const hole = fbm(u * 9 + 3, v * 9, 3, 9) > 0.42 && v > 0.5;
      const a = v < edge && !hole ? 255 : 0;
      return [a, a, a];
    }),
    { srgb: false, clamp: true },
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

/** Layered pauldron over a shoulder (side +1 = the body's left, +X). */
export function pauldron(side: 1 | -1, tier: number, M: ArmourMats): Group {
  const g = new Group();
  const big = 1 + tier * 0.13;
  const lames = 2 + Math.min(3, tier);
  const face = then(rotY((side * Math.PI) / 2), rotZ(side * 0.95));
  // The cap over the top of the shoulder.
  const cap = wrapPlate({ w: 0.22 * big, h: 0.12 * big, t: 0.014, bend: 0.085 * big, dome: 0.12 * big, corner: 0.03, strips: 12 });
  g.add(put(cap, M.plate, [side * 0.045 * big, 0.0, 0], face));
  if (tier >= 3) {
    // A raised ridge and gold/red trim behind the cap.
    const trim = wrapPlate({ w: 0.235 * big, h: 0.13 * big, t: 0.008, bend: 0.088 * big, dome: 0.12 * big, corner: 0.03, strips: 12 });
    g.add(put(trim, M.trim, [side * 0.04 * big, -0.002, 0], face));
  }
  for (let k = 1; k <= lames; k++) {
    const lame = wrapPlate({ w: (0.21 - k * 0.012) * big, h: 0.07 * big, t: 0.012, bend: (0.08 - k * 0.004) * big, corner: 0.015, strips: 10, taper: 0.92 });
    const q = then(rotY((side * Math.PI) / 2), rotZ(side * (0.32 - k * 0.07)));
    g.add(put(lame, k === lames && tier === 3 ? M.trim : M.plate, [side * (0.05 + k * 0.01) * big, (0.0 - k * 0.048) * big, 0], q));
  }
  if (tier >= 3) {
    const n = tier === 3 ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const zz = (i - (n - 1) / 2) * 0.045 * big;
      const len = (0.06 + (tier - 3) * 0.035) * (1 - Math.abs(zz) * 3);
      const base = new Vector3(side * 0.09 * big, 0.03 * big, zz);
      const tip = base.clone().add(new Vector3(side * len * 0.8, len * 0.8, zz * 0.2));
      g.add(put(horn([base, base.clone().lerp(tip, 0.5).add(new Vector3(side * 0.01, 0, 0)), tip], 0.018 * big, 0.002, 10, 8), M.dark, [0, 0, 0]));
    }
  }
  return g;
}

/** The heavy helms: jugg (sealed bomb-suit helm), warlord (horned, slit eyes), titan (crowned, bull horns). */
export function helm(style: "jugg" | "warlord" | "titan", r: Vector3, eyes: [Vector3, Vector3], M: ArmourMats): Group {
  const g = new Group();
  const k = style === "jugg" ? 1.18 : style === "warlord" ? 1.22 : 1.3;
  // Crown: faceted dome over the top and the back.
  const crown = new SphereGeometry(1, style === "jugg" ? 18 : 12, 9, 0, Math.PI * 2, 0, Math.PI * 0.62);
  crown.scale(r.x * k * 1.12, r.y * k * 0.95, r.z * k * 1.12);
  const cm = put(crown, M.plate, [0, r.y * 0.12, -0.004]);
  (cm.material as MeshStandardMaterial).flatShading = style !== "jugg";
  g.add(cm);
  // Faceplate with the visor cut out.
  const eyeY = (eyes[0].y + eyes[1].y) / 2;
  const fw = r.x * 2 * k * 1.05;
  const fh = r.y * 2 * k * 0.86;
  const cy = eyeY - fh * 0.18;
  const ey = eyeY - cy;
  let holes: [number, number][][] = [];
  if (style === "jugg") {
    holes = [[[-fw * 0.36, ey - 0.02], [fw * 0.36, ey - 0.02], [fw * 0.33, ey + 0.026], [-fw * 0.33, ey + 0.026]]];
  } else if (style === "warlord") {
    for (const s of [-1, 1]) holes.push([[s * 0.012, ey - 0.008], [s * fw * 0.36, ey + 0.004], [s * fw * 0.34, ey + 0.018], [s * 0.016, ey + 0.004]]);
  } else {
    holes = [[[-fw * 0.38, ey - 0.006], [fw * 0.38, ey - 0.006], [fw * 0.36, ey + 0.012], [-fw * 0.36, ey + 0.012]], [[-0.008, ey - 0.006], [0.008, ey - 0.006], [0.006, ey - 0.06], [-0.006, ey - 0.06]]];
  }
  const face = wrapPlate({ w: fw, h: fh, t: 0.016, bend: r.z * k * 0.95, dome: style === "jugg" ? 0.35 : 0.22, taper: style === "jugg" ? 0.92 : 0.62, strips: 16, holes, corner: 0.02 });
  g.add(put(face, M.plate, [0, cy, r.z * k * 0.93]));
  if (style === "jugg") {
    // Dark visor glass behind the window, faintly lit; filters on the jaw.
    const glass = new Mesh(new PlaneGeometry(fw * 0.82, 0.075), new MeshPhysicalMaterial({ color: 0x050a0d, roughness: 0.05, metalness: 0.2, clearcoat: 1, emissive: 0x2a6f8f, emissiveIntensity: 0.9 }));
    glass.position.set(0, eyeY + 0.003, r.z * k * 0.9);
    g.add(glass);
    for (const s of [-1, 1]) {
      const f = put(new CylinderGeometry(0.036, 0.04, 0.034, 20), M.dark, [s * fw * 0.36, cy - fh * 0.3, r.z * k * 0.86]);
      f.quaternion.copy(then(rotX(Math.PI / 2), rotY(s * 0.55)));
      g.add(f);
    }
  } else {
    // Eyes glowing through the slits.
    for (const e of eyes) {
      const glow = new Mesh(new SphereGeometry(0.011, 10, 8), M.glow);
      glow.position.copy(e).add(new Vector3(0, 0.002, 0.012));
      g.add(glow);
    }
    // Brow ridge.
    const brow = wrapPlate({ w: fw * 1.02, h: 0.03, t: 0.02, bend: r.z * k * 0.98, taper: 0.9, strips: 12, corner: 0.008 });
    g.add(put(brow, M.trim, [0, eyeY + 0.03, r.z * k * 0.98]));
    // Crest fin over the crown.
    const fin = new Shape();
    const L = r.z * 2.4 * k;
    fin.moveTo(-L / 2, 0);
    fin.quadraticCurveTo(-L * 0.2, style === "titan" ? 0.14 : 0.08, L / 2, style === "titan" ? 0.05 : 0.03);
    fin.lineTo(L / 2, 0);
    fin.closePath();
    const fg = new ExtrudeGeometry(fin, { depth: 0.012, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 1 });
    fg.translate(0, 0, -0.006);
    g.add(put(fg, M.trim, [0, r.y * k * 1.02, 0], rotY(-Math.PI / 2)));
    // Horns.
    for (const s of [-1, 1]) {
      const base = new Vector3(s * r.x * k * 0.9, r.y * k * 0.55, -0.01);
      const pts =
        style === "titan"
          ? [base, base.clone().add(new Vector3(s * 0.09, 0.03, 0.02)), base.clone().add(new Vector3(s * 0.17, 0.13, 0.1)), base.clone().add(new Vector3(s * 0.15, 0.25, 0.2))]
          : [base, base.clone().add(new Vector3(s * 0.06, 0.06, -0.02)), base.clone().add(new Vector3(s * 0.09, 0.15, -0.06)), base.clone().add(new Vector3(s * 0.07, 0.22, -0.12))];
      g.add(put(horn(pts, style === "titan" ? 0.034 : 0.024, 0.002, 24, 10), style === "titan" ? M.trim : M.dark, [0, 0, 0]));
    }
    if (style === "titan") {
      // A crown of short spikes.
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI * 0.42 + (i / 6) * Math.PI * 0.84;
        const b = new Vector3(Math.sin(a) * r.x * k * 1.0, r.y * k * 0.78, Math.cos(a) * r.z * k * 0.95);
        const tip = b.clone().add(new Vector3(Math.sin(a) * 0.02, 0.07 - Math.abs(i - 3) * 0.012, Math.cos(a) * 0.02));
        g.add(put(horn([b, b.clone().lerp(tip, 0.5), tip], 0.012, 0.001, 6, 6), M.trim, [0, 0, 0]));
      }
    }
  }
  // Gorget (neck guard).
  const gor = wrapPlate({ w: r.x * 2 * k * 1.7, h: 0.07, t: 0.012, bend: r.x * k * 0.9, taper: 1.15, strips: 16, corner: 0.01 });
  g.add(put(gor, M.plate, [0, -r.y * 0.95, -0.01], rotY(Math.PI)));
  return g;
}

/** Chest plate with abdominal lames and the core socket. */
export function cuirass(width: number, height: number, depth: number, tier: number, M: ArmourMats): Group {
  const g = new Group();
  const k = 1 + (tier - 2) * 0.08;
  const front = wrapPlate({ w: width * 1.08 * k, h: height * 0.62, t: 0.018, bend: width * 0.62, dome: 0.5, taper: 0.8, strips: 14, corner: 0.03 });
  g.add(put(front, M.plate, [0, height * 0.18, depth / 2 + 0.03]));
  for (let i = 0; i < 3; i++) {
    const lame = wrapPlate({ w: width * (0.82 - i * 0.05) * k, h: height * 0.13, t: 0.012, bend: width * 0.6, strips: 12, corner: 0.012, taper: 0.94 });
    g.add(put(lame, i === 1 && tier >= 3 ? M.trim : M.plate, [0, -height * (0.18 + i * 0.12), depth / 2 + 0.03 - i * 0.004]));
  }
  const back = wrapPlate({ w: width * 1.05 * k, h: height * 0.8, t: 0.016, bend: width * 0.6, dome: 0.6, strips: 14, corner: 0.03 });
  g.add(put(back, M.plate, [0, height * 0.06, -depth / 2 - 0.03], rotY(Math.PI)));
  // Core.
  const ring = put(new TorusGeometry(0.05, 0.012, 10, 28), M.trim, [0, height * 0.22, depth / 2 + 0.058]);
  const disc = put(new CylinderGeometry(0.042, 0.042, 0.012, 28), M.glow, [0, height * 0.22, depth / 2 + 0.056]);
  disc.quaternion.copy(rotX(Math.PI / 2));
  g.add(ring, disc);
  return g;
}

/** Torn cape hanging from the shoulders. */
export function cape(width: number, length: number, M: ArmourMats): Mesh {
  const geo = new PlaneGeometry(width, length, 24, 24);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const t = (length / 2 - y) / length;
    const fold = Math.sin((x / width) * Math.PI * 7) * 0.025 * (0.3 + t);
    const wrap = -Math.pow(Math.abs(x) / (width / 2), 2) * 0.12 * (1 - t * 0.6);
    p.setZ(i, fold + wrap - t * 0.12);
  }
  geo.computeVertexNormals();
  const m = new Mesh(geo, M.cape!);
  m.castShadow = true;
  m.rotation.y = Math.PI;
  return m;
}

/** Tactical boot over the scanned foot (and toes): upper, toe cap, sole, shaft up the ankle. */
export function boot(len: number, wid: number, hgt: number, mat: Material, sole: Material, armoured: boolean, M?: ArmourMats): Group {
  const g = new Group();
  const upper = new RoundedBoxGeometry(wid, hgt, len, 3, Math.min(wid, hgt) * 0.45);
  g.add(put(upper, mat, [0, hgt / 2 + 0.018, 0]));
  const toe = new SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  toe.scale(wid * 0.5, hgt * 0.85, len * 0.22);
  g.add(put(toe, mat, [0, 0.02, len * 0.32], rotX(Math.PI / 2 - 0.2)));
  g.add(put(new RoundedBoxGeometry(wid * 1.06, 0.022, len * 1.04, 2, 0.008), sole, [0, 0.011, 0.004]));
  g.add(put(new CylinderGeometry(wid * 0.46, wid * 0.5, hgt * 1.3, 16), mat, [0, hgt * 1.15, -len * 0.18]));
  if (armoured && M) {
    const sab = wrapPlate({ w: wid * 0.95, h: len * 0.62, t: 0.01, bend: wid * 0.5, strips: 8, corner: 0.015 });
    g.add(put(sab, M.plate, [0, hgt + 0.03, len * 0.12], rotX(-1.25)));
  }
  return g;
}
