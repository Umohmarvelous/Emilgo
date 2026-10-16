// The map kit: everything a map recipe builds with.
//
// A recipe calls the kit's primitives and props; the kit sorts every piece by
// WHERE it is (a 50 m chunk along the run) and HOW IMPORTANT it is:
//
//   mass     the shapes you'd see from far away (a building's volume, a trunk)
//   main     what reads at middle distance (windows, roofs, cars)
//   detail   small stuff only worth drawing up close (AC units, pots, crates)
//   foliage  leaves and fronds: drawn with a wind-sway shader
//   glow     unlit: lit windows, lamps, neon, lava — they shine at night
//   tex:*    textured surfaces (brick, glass, concrete…), tinted by vertex colour
//
// Each chunk becomes a THREE.LOD with three levels: everything (near), mass +
// main (middle), mass only (far). Everything static in a chunk is merged, so a
// whole map costs a couple of dozen draw calls however much is in it.

import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  SphereGeometry,
} from "three";

import { DOLL_Z, FIELD } from "../config";
import { Rng } from "../core/rng";
import type { Collider } from "../world/camera";
import { matrixOf, merge, moved, paint, part, type V3, type Xform } from "../world/geo";

export type Level = "mass" | "main" | "detail" | "foliage" | "glow";
export type TexKind = "brick" | "plaster" | "glass" | "concrete" | "wood" | "mud" | "thatch" | "zinc";

export const CHUNK = 50;
/** First chunk's near edge (behind the start). */
export const Z0 = 40;

export interface Chunk {
  mass: BufferGeometry[];
  main: BufferGeometry[];
  detail: BufferGeometry[];
  foliage: BufferGeometry[];
  glow: BufferGeometry[];
  tex: Partial<Record<TexKind, BufferGeometry[]>>;
}

const BOX = new BoxGeometry(1, 1, 1);
const CYL6 = new CylinderGeometry(1, 1, 1, 6);
const CYL10 = new CylinderGeometry(1, 1, 1, 10);
const CYL16 = new CylinderGeometry(1, 1, 1, 16);
const CONE6 = new ConeGeometry(1, 1, 6);
const CONE10 = new ConeGeometry(1, 1, 10);
const BLOB = new DodecahedronGeometry(1, 0);
const BLOB1 = new IcosahedronGeometry(1, 1);
const BALL = new SphereGeometry(1, 10, 8);

export class Kit {
  readonly rng: Rng;
  readonly chunks = new Map<number, Chunk>();
  /** Always drawn, no LOD (the far backdrop: skylines, mountains). */
  readonly far: BufferGeometry[] = [];
  readonly farGlow: BufferGeometry[] = [];
  readonly colliders: Collider[] = [];
  /** Lamp heads, for night halos. */
  readonly lamps: V3[] = [];
  /** Where the eyes in the dark are (Dark Forest), for blinking glows. */
  readonly eyes: V3[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  chunkAt(z: number): Chunk {
    const i = Math.floor((Z0 - z) / CHUNK);
    let c = this.chunks.get(i);
    if (!c) {
      c = { mass: [], main: [], detail: [], foliage: [], glow: [], tex: {} };
      this.chunks.set(i, c);
    }
    return c;
  }

  /** Put an already-built piece (world coordinates) where it belongs. */
  put(g: BufferGeometry, level: Level, z: number): void {
    this.chunkAt(z)[level].push(g);
  }

  putTex(g: BufferGeometry, kind: TexKind, z: number): void {
    const c = this.chunkAt(z);
    (c.tex[kind] ??= []).push(g);
  }

  // ── Primitives (vertex-coloured, flat-shaded) ─────────────────────────────

  box(color: string | number, size: V3, p: V3, level: Level = "main", r?: V3, shade = 1): void {
    this.put(part(BOX, color, { p, r, s: size }, shade), level, p[2]);
  }

  cyl(color: string | number, radius: number, height: number, p: V3, level: Level = "main", opts: { r?: V3; sides?: 6 | 10 | 16; top?: number } = {}): void {
    const base = opts.top !== undefined ? new CylinderGeometry(opts.top, 1, 1, opts.sides ?? 10) : opts.sides === 6 ? CYL6 : opts.sides === 16 ? CYL16 : CYL10;
    this.put(part(base, color, { p, r: opts.r, s: [radius, height, radius] }), level, p[2]);
  }

  cone(color: string | number, radius: number, height: number, p: V3, level: Level = "main", r?: V3, sides: 6 | 10 = 10): void {
    this.put(part(sides === 6 ? CONE6 : CONE10, color, { p, r, s: [radius, height, radius] }), level, p[2]);
  }

  blob(color: string | number, s: V3, p: V3, level: Level = "foliage", smooth = false): void {
    this.put(part(smooth ? BLOB1 : BLOB, color, { p, s }), level, p[2]);
  }

  ball(color: string | number, r: number, p: V3, level: Level = "main"): void {
    this.put(part(BALL, color, { p, s: r }), level, p[2]);
  }

  /** A glowing quad-ish box (windows at night, neon, lamp heads). */
  glow(color: string | number, size: V3, p: V3, r?: V3): void {
    this.put(part(BOX, color, { p, r, s: size }), "glow", p[2]);
  }

  /** A textured box: UVs in metres / `tile` so the pattern keeps its size. */
  texBox(kind: TexKind, tint: string | number, size: V3, p: V3, tile = 4, r?: V3): void {
    const g = BOX.clone();
    const uv = g.attributes.uv as Float32BufferAttribute;
    const [sx, sy, sz] = size;
    // Face order: +x, −x, +y, −y, +z, −z; 4 vertices each.
    const dims: [number, number][] = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
    for (let f = 0; f < 6; f++) {
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, uv.getX(i) * (dims[f][0] / tile), uv.getY(i) * (dims[f][1] / tile));
      }
    }
    const ng = g.toNonIndexed();
    ng.applyMatrix4(matrixOf({ p, r, s: size }));
    ng.computeVertexNormals();
    paint(ng, tint);
    this.putTex(ng, kind, p[2]);
  }

  /** A box the camera can't pass through (also drawn as `mass`). */
  solid(color: string | number, size: V3, p: V3, r?: V3): void {
    this.box(color, size, p, "mass", r);
    this.colliders.push({ x: p[0], z: p[2], hx: size[0] / 2, hz: size[2] / 2, h: p[1] + size[1] / 2 });
  }

  /** Far backdrop (no chunks). */
  farBox(color: string | number, size: V3, p: V3, r?: V3, shade = 1): void {
    this.far.push(part(BOX, color, { p, r, s: size }, shade));
  }

  farCone(color: string | number, radius: number, height: number, p: V3, sides: 6 | 10 = 6): void {
    this.far.push(part(sides === 6 ? CONE6 : CONE10, color, { p, s: [radius, height, radius] }));
  }

  farGlowBox(color: string | number, size: V3, p: V3): void {
    this.farGlow.push(part(BOX, color, { p, s: size }));
  }

  /** Place a prebuilt piece (vertex-coloured) at `x`. */
  place(g: BufferGeometry, x: Xform, level: Level = "main"): void {
    this.put(moved(g, x), level, x.p?.[2] ?? 0);
  }

  // ── Props ────────────────────────────────────────────────────────────────

  /**
   * A street building on side `s` (−1 left, +1 right), front face at |x| = front,
   * spanning z..z−w. Returns the depth used.
   */
  building(o: {
    s: 1 | -1;
    front: number;
    z: number;
    w: number;
    d?: number;
    floors: number;
    floorH?: number;
    color: string;
    tex?: TexKind;
    texTile?: number;
    roof?: "flat" | "zinc" | "pitched" | "tiles" | "dome" | "none";
    roofColor?: string;
    windows?: { color: string; lit: string; litChance: number; frame?: string; shutter?: string; tall?: boolean } | null;
    shop?: { canopy: string; sign?: string; open?: string } | null;
    balcony?: string | null;
    fireEscape?: boolean;
    ac?: boolean;
    tank?: boolean;
    trim?: string;
  }): number {
    const r = this.rng;
    const fh = o.floorH ?? 3;
    const d = o.d ?? r.range(6, 9);
    const h = o.floors * fh + 0.4;
    const cz = o.z - o.w / 2;
    const fx = o.s * o.front;
    const cx = o.s * (o.front + d / 2);
    // Volume: textured or plain.
    if (o.tex) this.texBox(o.tex, o.color, [d, h, o.w], [cx, h / 2, cz], o.texTile ?? 4);
    else this.box(o.color, [d, h, o.w], [cx, h / 2, cz], "mass");
    this.colliders.push({ x: cx, z: cz, hx: d / 2, hz: o.w / 2, h });
    this.box(o.trim ?? o.color, [d + 0.14, 0.6, o.w + 0.06], [cx, 0.3, cz], "main", undefined, o.trim ? 1 : 0.72);
    // Roof.
    const roof = o.roof ?? "flat";
    if (roof === "flat") this.box(o.trim ?? o.color, [d + 0.2, 0.25, o.w + 0.2], [cx, h + 0.12, cz], "main", undefined, o.trim ? 1 : 0.85);
    else if (roof === "zinc" || roof === "pitched" || roof === "tiles") {
      const rc = o.roofColor ?? (roof === "zinc" ? "#8a6a52" : roof === "tiles" ? "#9c4a32" : "#55504a");
      const rg = new ConeGeometry(1, 1, 4);
      rg.rotateY(Math.PI / 4);
      this.put(part(rg, rc, { p: [cx, h + 1.1, cz], s: [d * 0.78, 2.2, o.w * 0.78] }), "mass", cz);
    } else if (roof === "dome") {
      this.put(part(new SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), o.roofColor ?? "#d8c9a8", { p: [cx, h, cz], s: [Math.min(d, o.w) * 0.4, Math.min(d, o.w) * 0.35, Math.min(d, o.w) * 0.4] }), "main", cz);
    }
    // Windows.
    if (o.windows) {
      const W = o.windows;
      const cols = Math.max(1, Math.floor((o.w - 0.8) / 1.8));
      const startF = o.shop ? 1 : 0;
      for (let f = startF; f < o.floors; f++) {
        for (let c = 0; c < cols; c++) {
          const wz = cz - o.w / 2 + (o.w / cols) * (c + 0.5);
          const lit = r.chance(W.litChance);
          const wh = W.tall ? fh * 0.6 : fh * 0.42;
          const y = f * fh + fh * 0.52;
          if (lit) this.glow(W.lit, [0.06, wh, 0.95], [fx - o.s * 0.02, y, wz]);
          else this.box(W.color, [0.06, wh, 0.95], [fx - o.s * 0.02, y, wz], "main");
          if (W.frame) this.box(W.frame, [0.1, 0.1, 1.15], [fx - o.s * 0.04, y - wh / 2 - 0.05, wz], "detail");
          if (W.shutter) {
            this.box(W.shutter, [0.06, wh, 0.35], [fx - o.s * 0.05, y, wz - 0.68], "detail");
            this.box(W.shutter, [0.06, wh, 0.35], [fx - o.s * 0.05, y, wz + 0.68], "detail");
          }
          if (o.ac && r.chance(0.16)) this.box("#e4e7ea", [0.5, 0.42, 0.75], [fx - o.s * 0.26, f * fh + 0.6, wz], "detail");
        }
        if (o.balcony && f >= 1 && (f % 2 === 1 || W.tall)) {
          this.box(o.balcony, [1.0, 0.1, o.w * 0.8], [fx - o.s * 0.5, f * fh + 0.05, cz], "main");
          this.box(o.balcony, [0.05, 0.9, o.w * 0.8], [fx - o.s * 0.98, f * fh + 0.5, cz], "detail");
        }
      }
      if (o.fireEscape) {
        for (let f = 1; f < o.floors; f++) {
          this.box("#2b2b2e", [1.1, 0.08, 2.4], [fx - o.s * 0.55, f * fh + 0.05, cz], "main");
          this.box("#2b2b2e", [0.05, 0.9, 2.4], [fx - o.s * 1.08, f * fh + 0.5, cz], "detail");
          this.box("#2b2b2e", [0.06, fh * 1.05, 0.08], [fx - o.s * 0.6, f * fh - fh / 2 + 0.3, cz + (f % 2 ? 0.9 : -0.9)], "detail", [f % 2 ? 0.55 : -0.55, 0, 0]);
        }
      }
    }
    // Ground floor shop.
    if (o.shop) {
      this.box(o.shop.open ?? "#2e221b", [0.06, 2.3, o.w * 0.72], [fx - o.s * 0.02, 1.2, cz], "main");
      this.box(o.shop.canopy, [1.6, 0.1, o.w * 0.86], [fx - o.s * 0.78, 2.75, cz], "main", [0, 0, o.s * 0.22]);
      if (o.shop.sign) this.box(o.shop.sign, [0.08, 0.8, Math.min(o.w * 0.8, 5)], [fx - o.s * 0.06, 3.4, cz], "main");
    }
    if (o.tank && r.chance(0.6)) this.cyl("#1d2124", 0.6, 1.2, [cx + r.range(-1, 1), h + 0.85, cz + r.range(-1, 1)], "main");
    return d;
  }

  /** Walk from zNear to zFar in random widths, calling `make` for each slot. */
  row(zNear: number, zFar: number, make: (z: number, w: number) => number | void, wMin = 5, wMax = 9, gap: [number, number] = [0, 0.4]): void {
    let z = zNear;
    while (z > zFar) {
      const w = Math.min(this.rng.range(wMin, wMax), z - zFar);
      if (w < 2) break;
      make(z, w);
      z -= w + this.rng.range(gap[0], gap[1]);
    }
  }

  // Vehicles and street things, built along +Z (nose at +Z), placed with p/r.

  danfo(p: V3, ry = 0): void {
    const Y = "#f5bd02";
    const K = "#151515";
    const G = "#26323a";
    const parts = [
      part(BOX, Y, { p: [0, 1.03, 0], s: [1.9, 1.45, 4.6] }),
      part(BOX, Y, { p: [0, 2.0, -0.12], s: [1.84, 0.55, 4.3] }),
      part(BOX, G, { p: [0, 1.98, -0.3], s: [1.93, 0.5, 3.4] }),
      part(BOX, G, { p: [0, 1.95, 2.0], r: [-0.18, 0, 0], s: [1.6, 0.55, 0.06] }),
      part(BOX, K, { p: [0, 1.18, 0], s: [1.93, 0.12, 4.62] }),
      part(BOX, K, { p: [0, 0.86, 0], s: [1.93, 0.1, 4.62] }),
      part(BOX, K, { p: [0, 0.42, 2.32], s: [1.95, 0.22, 0.2] }),
      part(BOX, "#8d6e63", { p: [0, 2.33, -0.4], s: [1.5, 0.12, 2.2] }),
    ];
    for (const [x, z] of [[0.9, 1.55], [-0.9, 1.55], [0.9, -1.5], [-0.9, -1.5]]) parts.push(part(CYL10, K, { p: [x, 0.34, z], r: [0, 0, Math.PI / 2], s: [0.34, 0.26, 0.34] }));
    this.place(merge(parts), { p, r: [0, ry, 0] });
  }

  car(p: V3, ry: number, color: string, kind: "sedan" | "cab" | "suv" = "sedan"): void {
    const K = "#141414";
    const G = "#2a3540";
    const h = kind === "suv" ? 0.4 : 0;
    const parts = [
      part(BOX, color, { p: [0, 0.65 + h / 2, 0], s: [1.8, 0.7 + h, 4.3] }),
      part(BOX, color, { p: [0, 1.25 + h, -0.2], s: [1.6, 0.55, kind === "suv" ? 3.2 : 2.3] }),
      part(BOX, G, { p: [0, 1.25 + h, -0.2], s: [1.64, 0.4, kind === "suv" ? 3.0 : 2.1] }),
      part(BOX, "#fff6d0", { p: [0.6, 0.72 + h / 2, 2.16], s: [0.32, 0.14, 0.04] }),
      part(BOX, "#fff6d0", { p: [-0.6, 0.72 + h / 2, 2.16], s: [0.32, 0.14, 0.04] }),
      part(BOX, "#9a1c1c", { p: [0, 0.72 + h / 2, -2.16], s: [1.4, 0.12, 0.04] }),
    ];
    if (kind === "cab") parts.push(part(BOX, "#222222", { p: [0, 1.62 + h, -0.2], s: [0.7, 0.22, 0.3] }), part(BOX, "#111111", { p: [0, 0.95, 0], s: [1.84, 0.12, 4.32] }));
    for (const [x, z] of [[0.86, 1.35], [-0.86, 1.35], [0.86, -1.35], [-0.86, -1.35]]) parts.push(part(CYL10, K, { p: [x, 0.33, z], r: [0, 0, Math.PI / 2], s: [0.33, 0.24, 0.33] }));
    this.place(merge(parts), { p, r: [0, ry, 0] });
    this.colliders.push({ x: p[0], z: p[2], hx: 1.3, hz: 1.3, h: 1.6 });
  }

  /** London's red double-decker. */
  bus(p: V3, ry: number): void {
    const R = "#c4161c";
    const G = "#1f2a33";
    const parts = [
      part(BOX, R, { p: [0, 1.25, 0], s: [2.5, 2.1, 10] }),
      part(BOX, R, { p: [0, 3.35, 0], s: [2.5, 2.0, 10] }),
      part(BOX, G, { p: [0, 1.75, 0], s: [2.54, 0.8, 9.4] }),
      part(BOX, G, { p: [0, 3.55, 0], s: [2.54, 0.8, 9.6] }),
      part(BOX, "#f2f2f2", { p: [0, 2.35, 0], s: [2.55, 0.12, 10.02] }),
      part(BOX, "#141414", { p: [0, 0.32, 0], s: [2.4, 0.3, 9.8] }),
    ];
    for (const z of [3.6, -3.4]) for (const x of [1.1, -1.1]) parts.push(part(CYL10, "#141414", { p: [x, 0.5, z], r: [0, 0, Math.PI / 2], s: [0.5, 0.3, 0.5] }));
    this.place(merge(parts), { p, r: [0, ry, 0] }, "mass");
  }

  lamp(p: V3, side: 1 | -1, style: "modern" | "classic" | "lantern" | "caged" = "modern", color = "#2f3438"): void {
    const [x, , z] = p;
    if (style === "classic") {
      this.cyl(color, 0.08, 4.2, [x, 2.1, z], "main", { sides: 6 });
      this.cyl(color, 0.18, 0.5, [x, 0.25, z], "detail", { sides: 6 });
      this.glow("#ffe2a6", [0.36, 0.5, 0.36], [x, 4.45, z]);
      this.cone(color, 0.32, 0.3, [x, 4.85, z], "main", undefined, 6);
      this.lamps.push([x, 4.45, z]);
    } else if (style === "lantern") {
      this.glow("#ff5a3c", [0.4, 0.55, 0.4], [x, p[1] || 3.2, z]);
      this.lamps.push([x, p[1] || 3.2, z]);
    } else if (style === "caged") {
      this.box("#2a2c2e", [0.3, 0.3, 0.3], [x, p[1] || 3, z], "main");
      this.glow("#ffd27a", [0.2, 0.2, 0.2], [x - side * 0.16, p[1] || 3, z]);
      this.lamps.push([x - side * 0.2, p[1] || 3, z]);
    } else {
      this.cyl(color, 0.07, 5.6, [x, 2.8, z], "main", { sides: 6 });
      this.box(color, [1.3, 0.08, 0.08], [x - side * 0.6, 5.55, z], "main");
      this.glow("#fff2c0", [0.42, 0.06, 0.26], [x - side * 1.2, 5.42, z]);
      this.lamps.push([x - side * 1.2, 5.3, z]);
    }
  }

  /** A market stall: table, goods, umbrella or zinc roof. */
  stall(p: V3, ry: number, cover: string, goods: string[]): void {
    const r = this.rng;
    const parts = [
      part(BOX, "#7a5a3a", { p: [0, 0.8, 0], s: [2.2, 0.1, 1.2] }),
      part(BOX, "#5a4028", { p: [0, 0.4, 0], s: [2.0, 0.8, 1.0] }),
      part(CYL6, "#6d5a45", { p: [0, 1.4, 0], s: [0.04, 2.8, 0.04] }),
      part(CONE6, cover, { p: [0, 2.8, 0], s: [1.6, 0.6, 1.6] }),
    ];
    for (let i = 0; i < 6; i++) parts.push(part(BLOB, r.pick(goods), { p: [-0.8 + (i % 3) * 0.8, 0.98, -0.25 + Math.floor(i / 3) * 0.5], s: [0.3, 0.16, 0.25] }));
    this.place(merge(parts), { p, r: [0, ry, 0] });
  }

  palm(p: V3, h = 7): void {
    const r = this.rng;
    const lean = r.range(-0.12, 0.12);
    const segs = 4;
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      this.put(part(CYL6, "#8d7563", { p: [p[0] + lean * t * h * 0.6, (i + 0.5) * (h / segs), p[2]], r: [0, 0, -lean], s: [0.22 - t * 0.08, h / segs + 0.05, 0.22 - t * 0.08] }, i % 2 ? 0.9 : 1), "mass", p[2]);
    }
    const top: V3 = [p[0] + lean * h * 0.6, h, p[2]];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + r.range(-0.2, 0.2);
      const len = r.range(2.4, 3.2);
      this.put(
        part(new ConeGeometry(0.45, len, 4), k % 2 ? "#2e7d32" : "#4caf50", { p: [top[0] + Math.sin(a) * len * 0.42, top[1] - 0.35, top[2] + Math.cos(a) * len * 0.42], r: [Math.PI / 2 + 0.55, a, 0], o: "YXZ", s: [1, 1, 0.16] }),
        "foliage",
        p[2],
      );
    }
  }

  /** The baobab of trees1 / IMG_7779: a bottle trunk and a flat, stubby crown. */
  baobab(p: V3, scale = 1): void {
    const r = this.rng;
    const s = scale;
    const tg = new CylinderGeometry(1.4 * s, 2.1 * s, 8 * s, 10, 4);
    const pos = tg.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const k = 1 + Math.sin(((pos.getY(i) + 4 * s) / (8 * s)) * Math.PI) * 0.35;
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
    }
    this.put(part(tg, "#a8937c", { p: [p[0], 4 * s, p[2]] }), "mass", p[2]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + r.range(-0.2, 0.2);
      this.put(part(CYL6, "#9a8670", { p: [p[0] + Math.cos(a) * 1.3 * s, 8.8 * s, p[2] + Math.sin(a) * 1.3 * s], r: [-Math.sin(a) * 0.75, 0, Math.cos(a) * 0.75], s: [0.35 * s, 3 * s, 0.35 * s] }), "main", p[2]);
      this.blob(r.pick(["#5f7f35", "#6f8f3a", "#577a2f"]), [1.9 * s, 0.75 * s, 1.9 * s], [p[0] + Math.cos(a) * 2.6 * s, 10 * s, p[2] + Math.sin(a) * 2.6 * s]);
    }
  }

  /** A broadleaf tree (iroko, oak, plane tree). */
  tree(p: V3, h = 8, colors = ["#2e7d32", "#388e3c", "#33691e"], trunk = "#5d4037"): void {
    const r = this.rng;
    this.cyl(trunk, 0.32 * (h / 8), h * 0.6, [p[0], h * 0.3, p[2]], "mass", { sides: 6, top: 0.65 });
    const n = 3 + r.int(0, 2);
    for (let i = 0; i < n; i++) {
      const rr = h * r.range(0.22, 0.32);
      this.blob(r.pick(colors), [rr, rr * 0.75, rr], [p[0] + r.range(-1, 1) * h * 0.15, h * r.range(0.65, 0.95), p[2] + r.range(-1, 1) * h * 0.15]);
    }
  }

  pine(p: V3, h = 9, snowy = false): void {
    this.cyl("#4e3a2a", 0.22 * (h / 9), h * 0.3, [p[0], h * 0.15, p[2]], "mass", { sides: 6 });
    for (let i = 0; i < 4; i++) {
      const t = i / 4;
      const c = snowy && i === 3 ? "#e8eef4" : i % 2 ? "#1f4a32" : "#2a5a3c";
      this.put(part(CONE6, c, { p: [p[0], h * (0.35 + t * 0.2) + h * 0.12, p[2]], s: [h * (0.32 - t * 0.06), h * 0.34, h * (0.32 - t * 0.06)] }), "foliage", p[2]);
      if (snowy) this.put(part(CONE6, "#f4f8fb", { p: [p[0], h * (0.35 + t * 0.2) + h * 0.2, p[2]], s: [h * (0.24 - t * 0.05), h * 0.14, h * (0.24 - t * 0.05)] }), "foliage", p[2]);
    }
  }

  deadTree(p: V3, h = 7, color = "#2b2622"): void {
    const r = this.rng;
    this.cyl(color, 0.3, h, [p[0], h / 2, p[2]], "mass", { sides: 6, top: 0.5 });
    for (let i = 0; i < 5; i++) {
      const a = r.range(0, Math.PI * 2);
      const y = h * r.range(0.45, 0.95);
      const len = r.range(1.5, 3.2);
      const tilt = r.range(0.6, 1.1);
      this.put(part(CYL6, color, { p: [p[0] + Math.cos(a) * len * 0.45 * Math.sin(tilt), y + len * 0.4 * Math.cos(tilt), p[2] + Math.sin(a) * len * 0.45 * Math.sin(tilt)], r: [-Math.sin(a) * tilt, 0, Math.cos(a) * tilt], s: [0.08, len, 0.08] }), "main", p[2]);
    }
  }

  /** Jungle plant: big drooping leaves from the ground. */
  bigLeaves(p: V3, size = 1): void {
    const r = this.rng;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + r.range(-0.3, 0.3);
      const len = r.range(1.4, 2.4) * size;
      this.put(part(new ConeGeometry(0.5 * size, len, 4), r.pick(["#2f7a2a", "#3d8f30", "#256b22"]), { p: [p[0] + Math.sin(a) * len * 0.4, len * 0.35, p[2] + Math.cos(a) * len * 0.4], r: [Math.PI / 2 - 0.6, a, 0], o: "YXZ", s: [1, 1, 0.12] }), "foliage", p[2]);
    }
  }

  bush(p: V3, size = 1, color = "#3f6b2a"): void {
    this.blob(color, [0.9 * size, 0.6 * size, 0.9 * size], [p[0], 0.45 * size, p[2]]);
  }

  rock(p: V3, size = 1, color = "#6d6660"): void {
    this.put(part(BLOB, color, { p: [p[0], size * 0.35, p[2]], r: [this.rng.next(), this.rng.next() * 3, 0], s: [size, size * 0.7, size * 0.85] }), "main", p[2]);
  }

  /** Round mud hut with a thatch cone. */
  hut(p: V3, r = 2.2): void {
    this.cyl("#a5714a", r, 2.4, [p[0], 1.2, p[2]], "mass", { sides: 10 });
    this.put(part(CONE10, "#a88a4c", { p: [p[0], 3.4, p[2]], s: [r * 1.3, 2.2, r * 1.3] }), "mass", p[2]);
    this.box("#3b2416", [0.1, 1.6, 0.9], [p[0] + (p[0] > 0 ? -r : r), 0.8, p[2]], "main");
  }

  /** A fence line along z on side s at |x| = x. */
  fence(x: number, z0: number, z1: number, style: "wood" | "iron" | "wall" | "rope" | "hedge", color?: string): void {
    const len = Math.abs(z0 - z1);
    const mid = (z0 + z1) / 2;
    if (style === "wall") {
      this.solid(color ?? "#d9cdb8", [0.35, 2.2, len], [x, 1.1, mid]);
      return;
    }
    if (style === "hedge") {
      for (let z = z0; z > z1; z -= 2.2) this.blob(color ?? "#3a5f2a", [1.1, 0.8, 1.3], [x, 0.7, z - 1.1]);
      return;
    }
    const step = style === "iron" ? 0.35 : 2;
    const c = color ?? (style === "iron" ? "#1c1c1f" : style === "rope" ? "#c9b48a" : "#7a5a3a");
    for (let z = z0; z > z1; z -= step) this.box(c, [0.06, style === "iron" ? 1.8 : 1.1, 0.06], [x, style === "iron" ? 0.9 : 0.55, z], style === "iron" ? "detail" : "main");
    this.box(c, [0.06, 0.08, len], [x, style === "iron" ? 1.7 : 0.95, mid], "main");
    if (style !== "rope") this.box(c, [0.06, 0.08, len], [x, style === "iron" ? 0.3 : 0.5, mid], "main");
  }

  // ── Terrain bits ─────────────────────────────────────────────────────────

  mountains(color: string, snowCap: string | null, z: number, n = 9, spread = 160, hMin = 40, hMax = 110): void {
    for (let i = 0; i < n; i++) {
      const x = -spread / 2 + (i + this.rng.next() * 0.6) * (spread / n);
      const h = this.rng.range(hMin, hMax);
      const rad = h * this.rng.range(0.8, 1.2);
      const zz = z - this.rng.range(0, 60);
      this.farCone(color, rad, h, [x, h / 2 - 2, zz], 6);
      if (snowCap) this.farCone(snowCap, rad * 0.32, h * 0.32, [x, h - h * 0.16 - 2, zz], 6);
    }
  }

  /** A far city skyline of boxes, optionally with lit windows. */
  skyline(colors: string[], z0: number, z1: number, n: number, hMin: number, hMax: number, xs = 80, lit: string | null = null): void {
    for (let i = 0; i < n; i++) {
      const x = this.rng.range(-xs, xs);
      const z = this.rng.range(z0, z1);
      const w = this.rng.range(6, 16);
      const h = this.rng.range(hMin, hMax);
      this.farBox(this.rng.pick(colors), [w, h, w * this.rng.range(0.6, 1.2)], [x, h / 2, z]);
      if (lit) for (let k = 0; k < 4; k++) this.farGlowBox(lit, [w * 0.12, 0.6, 0.1], [x + this.rng.range(-w / 3, w / 3), this.rng.range(3, h - 2), z + (w * 0.6) / 2 + 0.06]);
    }
  }
}

// ── The course: what every map shares ────────────────────────────────────────

/** The track and stage: start line, chequered finish, the plaza, Mama's plinth. */
export function courseParts(o: { edge: string; line: string; plaza: string; stage: string; markings: boolean }): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  const w = FIELD.halfWidth * 2;
  out.push(part(BOX, o.line, { p: [0, 0.016, FIELD.startZ], s: [w, 0.035, 0.45] }));
  const sq = 0.46;
  const n = Math.ceil(w / sq);
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < n; i++) out.push(part(BOX, (i + row) % 2 ? "#111111" : "#fafafa", { p: [-FIELD.halfWidth + (i + 0.5) * sq, 0.017, FIELD.finishZ - row * sq + sq / 2], s: [sq, 0.035, sq] }));
  }
  if (o.markings) {
    for (const s of [-1, 1]) out.push(part(BOX, o.edge, { p: [s * (FIELD.halfWidth + 0.1), 0.012, (FIELD.backLimitZ + FIELD.finishZ) / 2], s: [0.16, 0.03, FIELD.backLimitZ - FIELD.finishZ] }));
  }
  out.push(part(BOX, o.plaza, { p: [0, 0.008, FIELD.finishZ - 13], s: [w + 4, 0.02, 24] }));
  out.push(part(CYL16, o.stage, { p: [0, 0.25, DOLL_Z], s: [3.4, 0.5, 3.4] }));
  out.push(part(CYL16, o.stage, { p: [0, 0.06, DOLL_Z], s: [3.6, 0.12, 3.6] }, 0.8));
  return out;
}

/** The start gantry posts (the banner quads are added by the world). */
export function gantryParts(color: string): BufferGeometry[] {
  return [
    part(CYL10, color, { p: [-9.7, 5, 0.4], s: [0.14, 10, 0.14] }),
    part(CYL10, color, { p: [9.7, 5, 0.4], s: [0.14, 10, 0.14] }),
    part(BOX, color, { p: [0, 9.9, 0.4], s: [19.8, 0.25, 0.25] }),
  ];
}

