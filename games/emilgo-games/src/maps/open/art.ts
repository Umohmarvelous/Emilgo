// How the open worlds' prefabs LOOK (SPEC-V3 §6). Client only: the solids come
// from maps/open/prefabs.ts, and every wall, roof and stair drawn here is drawn
// from the same parts, so what you see is what stops you. On top of the parts
// go the things that don't stop anyone: roofs, windows, doors, signs, leaves.
//
// A prefab is drawn in its own axes into a scratch kit, then turned and moved
// to its placement and filed into the 50 m cell it stands in. Textured walls
// share one atlas (`TEX_KINDS`): the kind rides in the UV's integer part, so a
// whole cell's textured walls are one draw.

import { BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, Matrix4, OctahedronGeometry, PlaneGeometry } from "three";

import { Kit, type Chunk, type Level, type TexKind } from "../kit";
import { merge, part, type V3 } from "../../world/geo";
import { BOARD_DEPTH, BOARD_SIZE, COURTYARD, compoundP, houseP, hutP, mudP, officeP, parts, propOf, shopsP, storeyP, type Part, type Placement } from "./prefabs";

/** The atlas's tiles, in order (4 × 2). */
export const TEX_KINDS: TexKind[] = ["plaster", "concrete", "brick", "wood", "mud", "zinc", "glass", "thatch"];
/** The UV's integer offset per atlas tile. */
export const TEX_STRIDE = 1000;

/**
 * Wall tints (v4 rework: a global city, not a Nigerian street). The photo
 * textures carry the colour; these only tint them: white, light grey, warm
 * grey, stone, sand, slate, pale blue-grey, off-white.
 */
export const WALLS = ["#eeeeec", "#d6d6d4", "#cfc8bc", "#d8d0c0", "#e0d8c8", "#b8bcc0", "#c8d0d8", "#f2f0ea"];
/** Metal roofs: charcoal and dark greys. */
const ZINC = ["#5a5e62", "#4c5054", "#64686c", "#46494c"];
const TILES = "#5a5c60";
const DOOR = "#2e3236";
const WINDOW = "#1f272e";
const FRAME = "#c8c8c4";
const METAL = "#5a5f63";
const RUST = "#6a5a4e";
const WOOD = "#6a5848";
const EARTH = "#7a7064";
const QUAD = new PlaneGeometry(1, 1);

/** A cell's pieces: the kit's levels plus one atlas bucket. */
export interface OpenChunk extends Chunk {
  atlas: BufferGeometry[];
  /** Drawn only at the far level: the trees' stand-ins. */
  far: BufferGeometry[];
}

export function emptyChunk(): OpenChunk {
  return { mass: [], main: [], detail: [], foliage: [], glow: [], tex: {}, atlas: [], far: [] };
}

/** Prefabs whose leaves get a far stand-in. */
const VEG = new Set(["tree", "palm", "bush", "plaza", "pine", "snowpine", "mangrove"]);
const OCTA = new OctahedronGeometry(1, 0);
const TRUNK = new BoxGeometry(1, 1, 1);

/** A kit that draws one prefab at a time into a scratch chunk, in local axes. */
export class PrefabKit extends Kit {
  scratch: OpenChunk = emptyChunk();
  /** Prefabs another draw stands in for (the scanned boulders, build.ts): their own look is skipped. */
  skip: ReadonlySet<string> = new Set();
  /** The props (by table index) whose CC0 model is drawn instead (build.ts): the rest get a plain box for their solid. */
  props: ReadonlySet<number> = new Set();
  readonly localLamps: V3[] = [];

  override chunkAt(): Chunk {
    return this.scratch;
  }

  override putTex(g: BufferGeometry, kind: TexKind): void {
    const k = TEX_KINDS.indexOf(kind);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) + k * TEX_STRIDE);
    this.scratch.atlas.push(g);
  }

  /** Draw a placement and hand back its pieces in world axes. */
  draw(p: Placement, night: boolean): { chunk: OpenChunk; lamps: V3[] } {
    this.scratch = emptyChunk();
    this.lamps.length = 0;
    drawPrefab(this, p, night);
    if (VEG.has(p.prefab) && this.scratch.foliage.length) {
      // Far away a tree is one blob: its leaves move up to the middle level and a stand-in takes the far one.
      const ch = this.scratch;
      const b = merge(ch.foliage);
      b.computeBoundingBox();
      const bb = b.boundingBox!;
      const col = ch.foliage[0].attributes.color;
      ch.main.push(...ch.foliage);
      ch.foliage = [];
      // A palm's segmented trunk goes too; the stand-in brings a plain one.
      if (p.prefab === "palm") {
        ch.main.push(...ch.mass);
        ch.mass = [];
        ch.far.push(part(TRUNK, "#8d7563", { p: [0, bb.min.y / 2, 0], s: [0.36, bb.min.y, 0.36] }));
      }
      const sx = (bb.max.x - bb.min.x) / 2;
      const sy = (bb.max.y - bb.min.y) / 2;
      const sz = (bb.max.z - bb.min.z) / 2;
      const stand = part(OCTA, 0, { p: [(bb.max.x + bb.min.x) / 2, (bb.max.y + bb.min.y) / 2, (bb.max.z + bb.min.z) / 2], s: [sx, sy, sz] });
      const sc = stand.attributes.color;
      for (let i = 0; i < sc.count; i++) sc.setXYZ(i, col.getX(0), col.getY(0), col.getZ(0));
      ch.far.push(stand);
      b.dispose();
    }
    const m = new Matrix4().makeRotationY(p.rot).setPosition(p.x, 0, p.z);
    const ch = this.scratch;
    for (const list of [ch.mass, ch.main, ch.detail, ch.foliage, ch.glow, ch.atlas, ch.far]) for (const g of list) g.applyMatrix4(m);
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    const lamps = this.lamps.map(([x, y, z]): V3 => [p.x + x * c + z * s, y, p.z - x * s + z * c]);
    return { chunk: ch, lamps };
  }
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

/** A part drawn as itself: a box (textured or plain) or a flight of stairs. */
function solidPart(k: PrefabKit, q: Part, look: { tex?: TexKind; color: string; tile?: number; level?: Level }): void {
  if (q.kind === "ramp") {
    stairs(k, q, look.color);
    return;
  }
  const h = q.y1 - q.y0;
  if (h <= 0) return;
  const size: V3 = [q.hx * 2, h, q.hz * 2];
  const p: V3 = [q.x, q.y0 + h / 2, q.z];
  const r: V3 | undefined = q.rot ? [0, q.rot, 0] : undefined;
  // Plaster at a 5 m repeat: its stains read as weathering, not as a pattern.
  if (look.tex) k.texBox(look.tex, look.color, size, p, look.tile ?? (look.tex === "plaster" ? 5 : 3), r);
  else k.box(look.color, size, p, look.level ?? "mass", r);
}

/** Steps up a ramp part: from y1 at its −z end to y2 at its +z end (after its turn). */
function stairs(k: PrefabKit, q: Part, color: string): void {
  const y1 = q.y1;
  const y2 = q.y2 ?? q.y1;
  const rise = Math.abs(y2 - y1);
  const len = q.hz * 2;
  const slope = Math.atan2(y2 - y1, len);
  const c = Math.cos(q.rot ?? 0);
  const s = Math.sin(q.rot ?? 0);
  const ry = q.rot ?? 0;
  // The flight as one sloped slab (every distance) ...
  const mid = (y1 + y2) / 2;
  k.box(color, [q.hx * 2, 0.3, Math.hypot(len, rise)], [q.x, mid - 0.12, q.z], "mass", [-slope, ry, 0], 0.85);
  // ... and up close, its treads: a quad each.
  const n = Math.max(2, Math.round(rise / 0.2));
  const run = len / n;
  for (let i = 0; i < n; i++) {
    const lz = -q.hz + run * (i + 0.5);
    const top = y1 + (y2 - y1) * ((i + 0.5) / n);
    k.put(part(QUAD, color, { p: [q.x + lz * s, top + 0.01, q.z + lz * c], r: [-Math.PI / 2, ry, 0], o: "YXZ", s: [q.hx * 2, run, 1] }), "detail", 0);
  }
  // A rail on the open side.
  k.box("#3a3c3e", [0.06, 0.06, Math.hypot(len, rise)], [q.x + (q.hx - 0.05) * c, mid + 0.95, q.z - (q.hx - 0.05) * s], "detail", [-slope, ry, 0]);
}

/**
 * Windows and doors on a building's four faces, floor by floor. The front is
 * +z (where the door goes); `shopFront` swaps the ground floor for shutters.
 */
function facade(k: PrefabKit, cx: number, cz: number, w: number, d: number, floors: number, fh: number, o: { shopFront?: number; door?: boolean; lit?: number; night?: boolean; bars?: boolean } = {}): void {
  const r = k.rng;
  const face = (nx: number, nz: number, span: number, off: number, front: boolean) => {
    const cols = Math.max(1, Math.floor((span - 1) / 2.6));
    const ry = Math.atan2(nx, nz);
    // Flat on the wall, a hair out: two triangles each.
    const flat = (color: string, fw: number, fh2: number, t: number, y: number, out: number, level: Level, glow = false) => {
      const x = cx + nx * (off + out) + (nz !== 0 ? t : 0);
      const z = cz + nz * (off + out) + (nx !== 0 ? t : 0);
      if (glow) k.put(part(QUAD, color, { p: [x, y, z], r: [0, ry, 0], s: [fw, fh2, 1] }), "glow", 0);
      else k.put(part(QUAD, color, { p: [x, y, z], r: [0, ry, 0], s: [fw, fh2, 1] }), level, 0);
    };
    for (let f = 0; f < floors; f++) {
      for (let c = 0; c < cols; c++) {
        const t = -span / 2 + (span / cols) * (c + 0.5);
        const mid = c === Math.floor(cols / 2);
        if (f === 0 && front && o.shopFront) continue; // the shutters go here
        if (f === 0 && front && mid && o.door !== false) {
          flat(FRAME, 1.3, 2.3, t, 1.15, 0.02, "main");
          flat(DOOR, 1.05, 2.1, t, 1.05, 0.04, "main");
          continue;
        }
        const y = f * fh + fh * 0.55;
        const lit = o.night && r.chance(o.lit ?? 0.3);
        flat(FRAME, 1.35, 1.35, t, y, 0.02, "main");
        flat(lit ? "#ffd890" : WINDOW, 1.15, 1.15, t, y, 0.04, "main", lit);
        // (v4 rework: no burglar bars.)
      }
    }
  };
  face(0, 1, w, d / 2, true);
  face(0, -1, w, d / 2, false);
  face(1, 0, d, w / 2, false);
  face(-1, 0, d, w / 2, false);
  if (o.shopFront) {
    const units = o.shopFront;
    const uw = w / units;
    // v4 rework: glass shop windows in dark frames (no roller shutters), a door in each, a sign band over them.
    const zf = cz + d / 2;
    for (let i = 0; i < units; i++) {
      const x = cx - w / 2 + uw * (i + 0.5);
      const lit = !!o.night && r.chance(0.7);
      k.put(part(QUAD, "#2a2d30", { p: [x, 1.35, zf + 0.03], s: [uw - 0.3, 2.6, 1] }), "main", 0);
      const glass = (gx: number, gw: number) => {
        if (lit) k.put(part(QUAD, "#f4e2b8", { p: [gx, 1.35, zf + 0.05], s: [gw, 2.3, 1] }), "glow", 0);
        else k.put(part(QUAD, r.pick(["#34424c", "#2e3a44", "#3a4650"]), { p: [gx, 1.35, zf + 0.05], s: [gw, 2.3, 1] }), "main", 0);
      };
      const dw = 1.0;
      const gw = (uw - 0.6 - dw - 0.1) / 2;
      glass(x - dw / 2 - 0.05 - gw / 2, gw);
      glass(x + dw / 2 + 0.05 + gw / 2, gw);
      k.put(part(QUAD, DOOR, { p: [x, 1.1, zf + 0.06], s: [dw, 2.2, 1] }), "main", 0);
      k.put(part(QUAD, "#9aa4aa", { p: [x, 1.3, zf + 0.07], s: [dw - 0.25, 1.5, 1] }), "detail", 0);
      // The sign: a plain panel in the shop's colour (no words, no brand).
      k.put(part(QUAD, r.pick(["#e8e6e0", "#1f2a36", "#2f4a3a", "#5a1e22", "#d8d2c4"]), { p: [x, 3.0, zf + 0.05], s: [uw - 0.6, 0.55, 1] }), "main", 0);
    }
    // A slim charcoal canopy along the front.
    k.box(r.pick(["#2b2f33", "#1f2a36", "#3a3e42"]), [w, 0.1, 1.0], [cx, 2.7, zf + 0.5], "main", [0.08, 0, 0]);
  }
}

/** A pitched roof over a w × d box whose top is at h: zinc or tiles. */
function pitched(k: PrefabKit, cx: number, cz: number, w: number, d: number, h: number, color: string): void {
  const rg = new ConeGeometry(1, 1, 4);
  rg.rotateY(Math.PI / 4);
  k.put(partOf(rg, color, [cx, h + 0.8, cz], [w * 0.78, 1.6, d * 0.78]), "mass", 0);
  // The eaves.
  k.box(color, [w + 0.5, 0.08, d + 0.5], [cx, h + 0.04, cz], "main", undefined, 0.8);
}

function partOf(g: BufferGeometry, color: string, p: V3, s: V3): BufferGeometry {
  return part(g, color, { p, s });
}

/** Walls from parts, in a look: a prefab's fences, rooms and kerbs. */
function allParts(k: PrefabKit, ps: Part[], look: (q: Part) => { tex?: TexKind; color: string; tile?: number; level?: Level } | null): void {
  for (const q of ps) {
    const l = look(q);
    if (l) solidPart(k, q, l);
  }
}

/** The default look of a part, by what it's made of. */
function byMaterial(wall: string) {
  return (q: Part) =>
    q.surface === "metal" ? { color: METAL } : q.surface === "wood" ? { tex: "wood" as TexKind, color: "#a07850", tile: 2 } : q.surface === "sand" ? { color: EARTH } : { tex: "plaster" as TexKind, color: wall };
}

/** A steel street light (v4 rework: no wooden poles or wires): a tapered column, an arm, an LED head. */
function pole(k: PrefabKit, night: boolean): void {
  k.cyl("#5c6166", 0.14, 0.6, [0, 0.3, 0], "mass", { sides: 10 });
  k.cyl("#62676c", 0.09, 7.6, [0, 4.2, 0], "mass", { sides: 10 });
  k.box("#62676c", [0.08, 0.08, 1.7], [0, 7.95, 0.8], "main", [0.12, 0, 0]);
  k.box("#3a3e42", [0.34, 0.1, 0.7], [0, 7.8, 1.55], "main");
  if (night) k.glow("#f4f6ff", [0.26, 0.04, 0.56], [0, 7.74, 1.55]);
  k.lamps.push([0, 7.6, 1.55]);
}

/** A city panel van (the minibus's place, v4 rework): a long box, a windscreen, wheels. */
function van(k: PrefabKit, at: V3, color: string): void {
  const [x, , z] = at;
  k.box(color, [2.0, 1.9, 5.0], [x, 1.25, z], "mass");
  k.box(WINDOW, [1.84, 0.7, 0.06], [x, 1.75, z + 2.52], "main");
  k.box(WINDOW, [0.06, 0.55, 1.4], [x + 1.01, 1.8, z + 1.4], "main");
  k.box(WINDOW, [0.06, 0.55, 1.4], [x - 1.01, 1.8, z + 1.4], "main");
  k.box("#1a1a1a", [2.04, 0.3, 5.04], [x, 0.42, z], "main");
  for (const sx of [-0.92, 0.92]) for (const sz of [-1.7, 1.7]) k.cyl("#141414", 0.36, 0.26, [x + sx, 0.36, z + sz], "main", { r: [0, 0, Math.PI / 2], sides: 10 });
  k.box("#e8e8d0", [0.4, 0.15, 0.04], [x - 0.7, 0.9, z + 2.53], "detail");
  k.box("#e8e8d0", [0.4, 0.15, 0.04], [x + 0.7, 0.9, z + 2.53], "detail");
}

// ── Each prefab ───────────────────────────────────────────────────────────────

function drawPrefab(k: PrefabKit, p: Placement, night: boolean): void {
  if (k.skip.has(p.prefab)) return;
  const v = p.v;
  const ps = parts(p.prefab, v);
  const r = k.rng;
  switch (p.prefab) {
    case "house": {
      const q = houseP(v);
      const wall = WALLS[q.wall];
      const bz = q.fence ? -1.5 : 0;
      solidPart(k, ps[0], { tex: "plaster", color: wall });
      facade(k, 0, bz, q.w, q.d, 1, q.h, { night, bars: true });
      pitched(k, 0, bz, q.w, q.d, q.h, q.roof === "zinc" ? ZINC[q.wall % 4] : TILES);
      // v4 rework: a brick garden wall with a stone coping (no compound wall), a black iron gate.
      allParts(k, ps.slice(1), () => ({ tex: "brick", color: "#b89a88", tile: 2 }));
      for (const q2 of ps.slice(1)) if (q2.kind !== "ramp" && q2.y1 > 0.5) k.box("#cfcac0", [q2.hx * 2 + 0.08, 0.08, q2.hz * 2 + 0.08], [q2.x, q2.y1 + 0.04, q2.z], "detail", q2.rot ? [0, q2.rot, 0] : undefined);
      if (q.fence) {
        for (let i = 0; i < 9; i++) k.box("#1c1e20", [0.04, 1.6, 0.04], [-1.0 + i * 0.25, 0.8, (q.d + 3) / 2 - 0.1], "main"); // the gate
        k.box("#1c1e20", [2.3, 0.06, 0.06], [0, 1.55, (q.d + 3) / 2 - 0.1], "main");
      }
      break;
    }
    case "storey": {
      const q = storeyP(v);
      const wall = WALLS[q.wall];
      const bx = q.stairs ? -0.8 : 0;
      const h = q.floors * q.fh + 0.3;
      solidPart(k, ps[0], { tex: "plaster", color: wall });
      facade(k, bx, 0, q.w, q.d, q.floors, q.fh, { night, shopFront: q.shop ? Math.max(2, Math.floor(q.w / 4)) : 0, bars: true });
      // A band between floors.
      for (let f = 1; f < q.floors; f++) k.box("#d8d0c0", [q.w + 0.12, 0.22, q.d + 0.12], [bx, f * q.fh, 0], "main");
      k.box("#cfc6b4", [q.w + 0.2, 0.2, q.d + 0.2], [bx, h, 0], "main");
      // v4 rework: the outside stair in black steel (a fire escape), the parapet in the wall's own render.
      allParts(k, ps.slice(1), (s) => (s.surface === "metal" ? null : s.kind === "ramp" ? { color: "#2c3034" } : { tex: "plaster", color: wall }));
      if (q.tank) {
        // A rooftop air-handling unit where the water tank stood (the same solid).
        const ax = bx - q.w / 4;
        const az = -q.d / 4;
        k.box("#9a9ea2", [1.4, 1.5, 1.4], [ax, h + 0.75, az], "main");
        k.box("#6a6e72", [1.44, 0.08, 1.44], [ax, h + 1.52, az], "detail");
        k.cyl("#2a2d30", 0.5, 0.05, [ax, h + 1.56, az], "detail", { sides: 10 });
        k.box("#7a7e82", [0.18, 0.18, 1.2], [ax + 0.4, h + 0.3, az + 1.2], "detail");
      }
      break;
    }
    case "shops": {
      const q = shopsP(v);
      solidPart(k, ps[0], { tex: "plaster", color: WALLS[q.wall] });
      facade(k, 0, -1, q.w, q.d, 1, q.h, { night, shopFront: q.units, door: false });
      k.box("#cfc6b4", [q.w + 0.2, 0.25, q.d + 0.2], [0, q.h + 0.12, -1], "main");
      // A raised walkway in front of the shops.
      k.box("#9a948a", [q.w, 0.15, 2], [0, 0.075, q.d / 2], "main");
      break;
    }
    case "office": {
      const q = officeP(v);
      const h = q.floors * 3.3 + 0.5;
      if (q.glass) {
        // A glass curtain wall (the photo facade's panels run about ten to a tile).
        k.texBox("glass", "#e8eef2", [q.w, h, q.d], [0, h / 2, 0], 16);
        for (let f = 0; f <= q.floors; f += 4) k.box("#b8bcc0", [q.w + 0.15, 0.3, q.d + 0.15], [0, f * 3.3 + 0.2, 0], "main");
      } else {
        solidPart(k, ps[0], { tex: "concrete", color: WALLS[q.wall] });
        facade(k, 0, 0, q.w, q.d, q.floors, 3.3, { night, lit: 0.5 });
      }
      k.box("#bdb8ae", [q.w + 0.3, 0.3, q.d + 0.3], [0, h, 0], "main");
      k.box("#8a8d90", [3, 1.4, 2], [q.w / 4, h + 0.85, -q.d / 4], "detail");
      // The entrance canopy.
      k.box("#3a4a5a", [5, 0.15, 2.2], [0, 3.2, q.d / 2 + 1.1], "main");
      break;
    }
    case "courtyard": {
      // Face-me-I-face-you, walkable (Compound Wars): plastered rooms round a
      // yard, a zinc-edged flat roof over each row, a bed, a mat or a stove in
      // each room; the doors are drawn by the mode (they open and shut).
      const C = COURTYARD;
      const roof = ps.filter((q) => q.y0 >= C.roof - 0.01);
      allParts(k, ps.filter((q) => q.y0 < C.roof - 0.01), (q) => ({ tex: "plaster", color: q.y0 > 1 ? "#dcdad4" : "#ecebe6" }));
      allParts(k, roof, () => ({ tex: "zinc", color: ZINC[1] }));
      const z0 = -(C.long * 4) / 2;
      const FURNISH = ["#7a5a3a", "#8d6e63", "#a1887f", "#6d4c41"];
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const zc = z0 + (i + 0.5) * C.long;
          const xc = sx * (C.w / 2 - C.t - C.deep / 2);
          const n = (sx < 0 ? 0 : 4) + i;
          // A door frame on the yard side.
          k.box(DOOR, [0.08, 2.25, 0.1], [sx * (C.w / 2 - C.t - C.deep) - sx * 0.12, 1.12, zc - C.door / 2], "main");
          k.box(DOOR, [0.08, 2.25, 0.1], [sx * (C.w / 2 - C.t - C.deep) - sx * 0.12, 1.12, zc + C.door / 2], "main");
          // Inside: the Master Bedroom (the last) has a bed and the AC; the others a mat, a stool or a stove.
          if (n === 7) {
            k.box("#f2f2f2", [1.6, 0.5, 2.0], [xc + sx * 1, 0.25, zc], "detail");
            k.box("#e8e8e8", [0.9, 0.35, 0.25], [sx * (C.w / 2 - C.t - 0.2), 2.4, zc + 1.4], "detail");
          } else if (n >= 5) k.box("#c9b37a", [1.4, 0.45, 1.8], [xc + sx * 1.1, 0.22, zc], "detail");
          else k.box(FURNISH[n % FURNISH.length], [1.1, 0.06, 1.6], [xc + sx * 0.8, 0.03, zc], "detail");
        }
      }
      // The yard: a bench (no washing line).
      k.box("#5a5f63", [0.45, 0.45, 2.2], [0, 0.22, -C.d / 2 + 2], "detail");
      break;
    }
    case "compound": {
      const q = compoundP(v);
      const wall = WALLS[q.wall];
      // Face-me-I-face-you: two rows of rooms looking at each other across the yard.
      allParts(k, ps.slice(0, 2), () => ({ tex: "plaster", color: wall }));
      const rw = q.w - 0.6;
      const rooms = Math.floor(rw / 3.2);
      for (const side of [-1, 1]) {
        const z = side * (q.d / 2 - 2.6) - side * 2.33;
        for (let i = 0; i < rooms; i++) {
          const x = -rw / 2 + (rw / rooms) * (i + 0.5);
          k.box(DOOR, [0.9, 2.0, 0.08], [x - 0.6, 1.0, z], "main");
          k.box(WINDOW, [0.8, 0.8, 0.08], [x + 0.7, 1.6, z], "main");
        }
        pitched(k, 0, side * (q.d / 2 - 2.6), q.w - 0.6, 4.6, 3.2, TILES);
      }
      // v4 rework: townhouses round a mews (brick yard walls, planters; no washing lines).
      allParts(k, ps.slice(2), () => ({ tex: "brick", color: "#b89a88", tile: 2 }));
      for (let i = 0; i < 3; i++) {
        const x = -q.w / 3 + i * (q.w / 3);
        k.box("#8a8680", [1.2, 0.5, 1.2], [x, 0.25, 0], "detail");
        k.bush([x, 0.5, 0], 0.55, "#4a6a30");
      }
      break;
    }
    case "church": {
      // v4 rework: the town hall and its clock tower (the same walls as before).
      solidPart(k, ps[0], { tex: "brick", color: "#d8d2c8", tile: 4 });
      solidPart(k, ps[1], { tex: "brick", color: "#d8d2c8", tile: 4 });
      const rg = new CylinderGeometry(0, 1, 1, 4, 1);
      rg.rotateY(Math.PI / 4);
      k.put(partOf(rg, "#3e4246", [0, 7.5 + 1.6, -2], [14 * 0.74, 3.2, 24 * 0.74]), "mass", 0);
      k.box("#c8c2b8", [5.4, 0.5, 5.4], [0, 16.25, 11.5], "main");
      k.box("#3e4246", [4.6, 1.8, 4.6], [0, 17.4, 11.5], "mass");
      for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        k.put(part(new CylinderGeometry(1.15, 1.15, 0.08, 20), "#f2f0e8", { p: [nx * 2.56, 13.6, 11.5 + nz * 2.56], r: [Math.PI / 2, Math.atan2(nx, nz), 0], o: "YXZ" }), "main", 0);
        k.box("#1a1c1e", [0.1, 0.8, 0.04], [nx * 2.62, 13.85, 11.5 + nz * 2.62], "detail", [0, Math.atan2(nx, nz), 0]);
      }
      for (let i = 0; i < 5; i++) for (const s of [-1, 1]) k.box(WINDOW, [0.08, 3.2, 1.2], [s * 7.03, 3.6, -11 + i * 4.4], "main");
      k.box(DOOR, [2.2, 3.4, 0.1], [0, 1.7, 14.05], "main");
      break;
    }
    case "mosque": {
      // v4 rework: the museum, a flat-roofed hall with a glass lantern, and its radio tower (the same walls).
      solidPart(k, ps[0], { tex: "concrete", color: "#e6e4de", tile: 4 });
      k.box("#cfcdc6", [16.4, 0.5, 16.4], [0, 6.25, 0], "main");
      k.texBox("glass", "#c8d4dc", [7, 2.2, 7], [0, 7.6, 0], 3);
      solidPart(k, ps[1], { tex: "concrete", color: "#d0d0cc", tile: 3 });
      k.box("#8a8e92", [0.3, 6, 0.3], [7.5, 25, 7.5], "main");
      k.glow("#ff3020", [0.3, 0.3, 0.3], [7.5, 28.2, 7.5]);
      for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
        k.box(WINDOW, [2.6, 3.2, 0.08], [-6 + i * 4, 2.6, s * 8.03], "main");
        k.box(WINDOW, [0.08, 3.2, 2.6], [s * 8.03, 2.6, -6 + i * 4], "main");
      }
      break;
    }
    case "school": {
      solidPart(k, ps[0], { tex: "brick", color: "#d8d2c8", tile: 4 });
      facade(k, 0, -9, 36, 8, 1, 3.8, { night });
      pitched(k, 0, -9, 36, 8, 3.8, TILES);
      // The flagpole and the flag.
      k.cyl("#c8c8c8", 0.06, 9, [-16, 4.5, 11], "main", { sides: 6 });
      // The school's own flag (no country's): navy with a white band.
      k.box("#1f3a5f", [1.8, 0.35, 0.03], [-14.8, 8.67, 11], "main");
      k.box("#f2f2f2", [1.8, 0.2, 0.03], [-14.8, 8.4, 11], "main");
      k.box("#1f3a5f", [1.8, 0.35, 0.03], [-14.8, 8.13, 11], "main");
      allParts(k, ps.slice(2), () => ({ tex: "concrete", color: "#d8cfb8", tile: 2 }));
      // Football goalposts on the yard.
      for (const x of [-12, 12]) {
        k.box("#f2f2f2", [0.1, 2.2, 0.1], [x, 1.1, 2], "main");
        k.box("#f2f2f2", [0.1, 2.2, 0.1], [x, 1.1, 7], "main");
        k.box("#f2f2f2", [0.1, 0.1, 5], [x, 2.2, 4.5], "main");
      }
      break;
    }
    case "petrol": {
      allParts(k, ps.slice(0, 4), () => ({ color: "#d8d8d8" }));
      solidPart(k, ps[4], { color: "#e8e8e8" });
      k.box("#b8242a", [18.1, 0.4, 10.1], [0, 5.3, 2], "main");
      allParts(k, ps.slice(5, 9), () => ({ color: "#e8e4dc" }));
      for (let i = 5; i < 9; i++) k.box("#2a2a2a", [0.5, 0.4, 0.62], [ps[i].x, 1.2, ps[i].z], "detail");
      solidPart(k, ps[9], { tex: "plaster", color: "#efefe8" });
      facade(k, 0, -7, 9, 5, 1, 3.4, { night });
      // An empty price board on a pole: no fuel, and no brand.
      k.box("#d8d8d8", [0.3, 6, 0.3], [11, 3, 8], "main");
      k.box("#b8242a", [2.6, 2.6, 0.2], [11, 6.6, 8], "main");
      k.box("#f2f2f2", [2.2, 0.5, 0.22], [11, 7.1, 8], "detail");
      break;
    }
    case "watertower": {
      allParts(k, ps.slice(0, 4), () => ({ color: "#8a8f94" }));
      for (const y of [4, 9]) {
        k.box("#7a7f84", [5.2, 0.15, 0.15], [0, y, -2.4], "detail");
        k.box("#7a7f84", [5.2, 0.15, 0.15], [0, y, 2.4], "detail");
        k.box("#7a7f84", [0.15, 0.15, 5.2], [-2.4, y, 0], "detail");
        k.box("#7a7f84", [0.15, 0.15, 5.2], [2.4, y, 0], "detail");
      }
      k.cyl("#b8c4cc", 3.4, 4.5, [0, 16.25, 0], "mass", { sides: 16 });
      k.cone("#9aa6ae", 3.5, 1.4, [0, 19.2, 0], "main", undefined, 10);
      // A ladder up one leg.
      k.box("#5a5f63", [0.5, 14, 0.06], [2.4, 7, 2.75], "detail");
      break;
    }
    case "mast": {
      // A lattice tower: four legs that lean in, cross braces, the dishes and panels.
      for (const [x, z] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) k.box("#c8ccd0", [0.14, 34, 0.14], [x * 0.7, 17, z * 0.7], "mass", [z * 0.025, 0, -x * 0.025]);
      for (let y = 3; y < 33; y += 3.5) {
        const s = 2.1 - (y / 34) * 1.1;
        k.box(y % 7 < 3.5 ? "#d84030" : "#f2f2f2", [s * 2, 0.1, 0.1], [0, y, s], "main");
        k.box(y % 7 < 3.5 ? "#d84030" : "#f2f2f2", [s * 2, 0.1, 0.1], [0, y, -s], "main");
        k.box(y % 7 < 3.5 ? "#d84030" : "#f2f2f2", [0.1, 0.1, s * 2], [s, y, 0], "main");
        k.box(y % 7 < 3.5 ? "#d84030" : "#f2f2f2", [0.1, 0.1, s * 2], [-s, y, 0], "main");
      }
      for (let i = 0; i < 3; i++) k.box("#e8e8e8", [0.4, 1.6, 0.2], [Math.cos(i * 2.1) * 1.1, 30, Math.sin(i * 2.1) * 1.1], "main", [0, -i * 2.1, 0]);
      k.glow("#ff3020", [0.3, 0.3, 0.3], [0, 34.3, 0]);
      solidPart(k, ps[1], { color: "#c8c8c0" });
      allParts(k, ps.slice(2), () => ({ color: "#6a6e72", level: "main" }));
      break;
    }
    case "viewing": {
      // v4 rework: a brick sports bar with a flat roof (the viewing centre's place).
      solidPart(k, ps[0], { tex: "brick", color: "#c8b8a8", tile: 3 });
      k.box("#3a3e42", [14.3, 0.5, 10.3], [0, 4.45, -1], "main");
      k.box(DOOR, [1.6, 2.4, 0.1], [0, 1.2, 4.05], "main");
      // The painted board over the door: a ball and a screen, no words.
      k.box("#f2f2f2", [6, 1.4, 0.1], [0, 3.4, 4.08], "main");
      k.ball("#1a1a1a", 0.4, [-1.8, 3.4, 4.2], "detail");
      k.box("#2a6ad8", [2.2, 1.0, 0.06], [1.2, 3.4, 4.15], "detail");
      solidPart(k, ps[1], { color: "#8a8e92" }); // the condenser
      // Tables outside.
      for (const x of [-4, 4]) {
        k.box("#2a2d30", [1.2, 0.05, 0.8], [x, 0.75, 5.2], "main");
        k.box("#2a2d30", [0.08, 0.75, 0.08], [x, 0.37, 5.2], "detail");
      }
      break;
    }
    case "buspark": {
      allParts(k, ps.slice(0, 12), () => ({ color: "#5a5f63" }));
      solidPart(k, ps[12], { color: "#8a8d90" });
      k.box("#2a5a8a", [34.2, 0.3, 0.2], [0, 4.25, -9], "main");
      // Ticket kiosks.
      for (let i = 13; i < 16; i++) {
        solidPart(k, ps[i], { tex: "concrete", color: "#d8dadc" });
        k.box(WINDOW, [1.4, 0.8, 0.06], [ps[i].x, 1.6, ps[i].z + 1.23], "main");
        k.box("#c0392b", [2.8, 0.15, 2.8], [ps[i].x, 2.78, ps[i].z], "main");
      }
      // The city vans, waiting in their bays.
      for (let i = 16; i < ps.length; i++) van(k, [ps[i].x, 0, ps[i].z], r.pick(["#e8e8e8", "#c8ccd0", "#2a2e32"]));
      // Painted bay lines.
      for (let i = 0; i < 6; i++) k.box("#e8e8e0", [0.15, 0.02, 7], [-17.5 + i * 7, 0.01, 9.75], "detail");
      break;
    }
    case "market": {
      for (let i = 0; i < 36; i++) {
        const q = ps[i];
        // A table the size of its solid, two poles and a sheet over it, goods on top.
        // v4 rework: a farmers' market: a trestle under a white gazebo, crates of produce.
        solidPart(k, q, { color: "#e8e6e0" });
        for (const x of [-1.6, 1.6]) for (const z of [-1.4, 1.4]) k.box("#9aa0a4", [0.06, 2.4, 0.06], [q.x + x, 1.2, q.z + z], "detail");
        const cg = new ConeGeometry(1, 1, 4);
        cg.rotateY(Math.PI / 4);
        k.put(partOf(cg, r.pick(["#f2f2ee", "#ecece8", "#e2e6ea"]), [q.x, 2.75, q.z], [2.5, 0.7, 2.2]), "main", 0);
        for (let j = 0; j < 3; j++) {
          k.box("#9a7a58", [0.8, 0.22, 0.6], [q.x - 1 + j, 1.11, q.z], "detail");
          k.box(r.pick(["#b8402e", "#d8a020", "#5a8a30", "#c86a20", "#7a3a5a"]), [0.7, 0.08, 0.5], [q.x - 1 + j, 1.24, q.z], "detail");
        }
      }
      allParts(k, ps.slice(36, 40), () => ({ color: "#6a6e72" }));
      solidPart(k, ps[40], { tex: "zinc", color: "#a8acb0", tile: 2 });
      for (let i = 41; i < ps.length; i++) {
        solidPart(k, ps[i], { tex: "wood", color: "#a07850", tile: 2 });
        for (let j = 0; j < 5; j++) k.ball(r.pick(["#e67e22", "#f1c40f", "#c0392b", "#27ae60"]), 0.22, [ps[i].x - 1.2 + j * 0.6, 1.05, ps[i].z], "detail");
      }
      // Big umbrellas over the aisles.
      for (let i = 0; i < 8; i++) {
        const x = -16 + (i % 4) * 10.5;
        const z = i < 4 ? -20 : 20;
        k.cyl("#9aa0a4", 0.05, 2.6, [x, 1.3, z], "detail", { sides: 6 });
        k.cone(r.pick(["#f0efe8", "#2b2f33", "#e8e6e0"]), 1.8, 0.5, [x, 2.75, z], "main", undefined, 10);
      }
      break;
    }
    case "suya": {
      solidPart(k, ps[0], { color: "#2a2a2a" }); // the grill
      k.glow("#ff6a20", [2.2, 0.06, 1.4], [-2.2, 1.03, -1.2]);
      for (let i = 0; i < 8; i++) k.box("#6a3a1a", [0.06, 0.06, 1.3], [-3.2 + i * 0.28, 1.08, -1.2], "detail");
      // v4 rework: a street-food grill under a canvas canopy on steel poles, steel benches.
      solidPart(k, ps[1], { tex: "zinc", color: "#a8acb0", tile: 2 });
      allParts(k, ps.slice(2), () => ({ color: "#4a4e52", level: "main" }));
      for (const [x, z] of [[-4, 3.2], [4, 3.2], [-4, 0.6], [4, 0.6]]) k.cyl("#9aa0a4", 0.05, 2.5, [x, 1.25, z], "detail", { sides: 6 });
      k.box("#2b2f33", [9, 0.06, 3.4], [0, 2.5, 1.9], "main", [0.08, 0, 0]);
      break;
    }
    case "uncompleted": {
      allParts(k, ps.slice(0, 12), () => ({ tex: "concrete", color: "#a8a49c", tile: 2 }));
      solidPart(k, ps[12], { tex: "concrete", color: "#a8a49c", tile: 3 });
      solidPart(k, ps[13], { color: "#8a6a4a" }); // plank ramp
      solidPart(k, ps[14], { tex: "concrete", color: "#b8b4a8", tile: 1 }); // block pile
      // Rebar sticking up from the columns, and a half-built block wall.
      for (const x of [-6, -2, 2, 6]) for (const z of [-4.5, 0, 4.5]) k.box("#6a4a3a", [0.04, 1.2, 0.04], [x, 3.85, z], "detail");
      k.texBox("concrete", "#b8b4a8", [8, 1.4, 0.2], [-2, 0.7, -4.5], 1.5);
      break;
    }
    case "kiosk": {
      solidPart(k, ps[0], { color: r.pick(["#3a4048", "#2f6f8f", "#7a1e22", "#d8dadc"]) });
      k.box(WINDOW, [1.6, 1.0, 0.06], [0, 1.5, 1.23], "main");
      k.box("#f2f2f2", [2.6, 0.1, 1.0], [0, 2.1, 1.6], "main");
      break;
    }
    case "generator": {
      // v4 rework: a street utility cabinet (the generator's place).
      solidPart(k, ps[0], { color: r.pick(["#4f5d52", "#6b7075", "#5a6068"]) });
      for (let i = 0; i < 4; i++) k.box("#3a3e42", [0.5, 0.03, 0.02], [0, 0.4 + i * 0.12, ps[0].hz + 0.01], "detail");
      break;
    }
    case "pole":
      pole(k, night);
      break;
    case "billboard": {
      // A unipole: the steel pole, the panel's back and frame, the catwalk and two lamps over the face.
      // The face itself is drawn by world/billboards.ts (what it shows changes).
      const q = BOARD_SIZE[v & 1];
      const top = q.y + q.h / 2;
      k.cyl(METAL, 0.28, top, [0, top / 2, -0.45], "mass", { sides: 10 });
      k.box(night ? "#1e2022" : "#2a2d30", [q.w + 0.3, q.h + 0.3, BOARD_DEPTH], [0, q.y + q.h / 2, 0], "mass");
      k.box("#3a3e42", [q.w, 0.08, 0.7], [0, q.y - 0.22, 0.4], "detail");
      for (const x of [-q.w / 4, q.w / 4]) {
        k.box("#2a2d30", [0.08, 0.08, 0.9], [x, q.y + q.h + 0.3, 0.45], "detail");
        if (night) k.glow("#fff2c0", [0.4, 0.06, 0.16], [x, q.y + q.h + 0.25, 0.85]);
      }
      break;
    }
    case "wreck": {
      // A burnt-out car on its rims.
      const c = r.pick(["#5a3a2a", "#4a4a4a", "#6a5040"]);
      k.box(c, [1.8, 0.7, 4.2], [0, 0.55, 0], "mass");
      k.box(c, [1.6, 0.55, 2.2], [0, 1.15, -0.2], "main", undefined, 0.8);
      k.box("#1a1a1a", [1.64, 0.4, 2.0], [0, 1.15, -0.2], "detail");
      break;
    }
    case "danfo":
      van(k, [0, 0, 0], r.pick(["#e8e8e8", "#c8ccd0", "#3a4048", "#7a1e22"]));
      break;
    case "busstop": {
      allParts(k, ps, (q) => (q.y0 > 2 ? { color: "#2f6f8f" } : { color: METAL }));
      k.box("#e8e8e8", [1.4, 1.8, 0.08], [2, 1.4, 1.05], "main");
      break;
    }
    case "footbridge":
      allParts(k, ps, () => ({ tex: "wood", color: "#8a6a4a", tile: 1.5 }));
      for (let z = -12; z <= 12; z += 4) for (const x of [-1.45, 1.45]) k.box("#5a4030", [0.15, 1.6, 0.15], [x, 0.4, z], "main");
      break;
    case "overbridge":
      allParts(k, ps, (q) => (q.kind === "ramp" ? { color: "#9a9ea2" } : { color: q.y1 - q.y0 > 1.2 ? "#6a7076" : "#3a8a5a" }));
      break;
    case "tree":
      k.tree([0, 0, 0], 6 + r.range(0, 3), ["#3a6a2a", "#4a7a30", "#2f5a24"]);
      break;
    case "palm":
      // v4 rework: plane trees where the palms stood (the same trunk to bump into).
      k.tree([0, 0, 0], 7 + r.range(0, 3), ["#3f6a30", "#4c7836", "#365e2a"]);
      break;
    case "bush":
      k.bush([0, 0, 0], 0.8 + r.range(0, 0.6), r.pick(["#4a6a2a", "#5a7a30", "#3f5f28"]));
      break;
    case "baobab":
      // An old oak where the baobab stood.
      k.tree([0, 0, 0], 11, ["#355a28", "#406a2e", "#2c4e22"]);
      // The square's benches round it.
      for (let i = 0; i < 4; i++) k.box(WOOD, [2.4, 0.42, 0.5], [Math.cos(i * 1.57) * 5, 0.21, Math.sin(i * 1.57) * 5], "main", [0, -i * 1.57 + 1.57, 0]);
      break;
    case "hut": {
      // A grain silo where the round hut stood (the same footprint).
      const rr = hutP(v).r;
      k.cyl("#b8bcc0", rr, 4.4, [0, 2.2, 0], "mass", { sides: 16 });
      k.cone("#8a8e92", rr * 1.05, 1.4, [0, 5.1, 0], "main", undefined, 10);
      for (let y = 0.8; y < 4.4; y += 0.9) k.cyl("#9aa0a4", rr + 0.03, 0.06, [0, y, 0], "detail", { sides: 16 });
      break;
    }
    case "mudhouse": {
      const q = mudP(v);
      // A farmhouse in render (the mud brick's place).
      solidPart(k, ps[0], { tex: "mud", color: "#e8e4dc", tile: 2 });
      k.box(DOOR, [0.9, 1.9, 0.08], [0, 0.95, -0.7 + q.d / 2 + 0.04], "main");
      for (const x of [-q.w / 3, q.w / 3]) k.box("#3a2a1a", [0.6, 0.5, 0.08], [x, 1.6, -0.7 + q.d / 2 + 0.04], "main");
      if (r.chance(0.5)) pitched(k, 0, -0.7, q.w, q.d, 3.2, ZINC[Math.floor(r.next() * 4)]);
      else {
        const tg = new ConeGeometry(1, 1, 4);
        tg.rotateY(Math.PI / 4);
        k.put(partOf(tg, TILES, [0, 4.2, -0.7], [q.w * 0.85, 2, q.d * 0.85]), "mass", 0);
      }
      // The veranda's posts.
      k.box("#6a4a30", [0.12, 2.6, 0.12], [-q.w / 2 + 0.3, 1.3, q.d / 2 + 0.5], "detail");
      k.box("#6a4a30", [0.12, 2.6, 0.12], [q.w / 2 - 0.3, 1.3, q.d / 2 + 0.5], "detail");
      break;
    }
    case "farm": {
      allParts(k, ps, () => ({ color: "#8a5a3a", level: "main" }));
      // A crop on every ridge: thin stems with a tuft of leaves.
      for (let i = 0; i < 8; i++) for (let j = 0; j < 9; j++) {
        const x = -9 + j * 2.2 + r.range(-0.3, 0.3);
        const z = -7 + i * 2;
        k.box("#7a6a4a", [0.05, 1.3, 0.05], [x, 0.95, z], "detail");
        k.cone(r.pick(["#4a7a30", "#5a8a38", "#3f6a28"]), 0.55, 0.5, [x, 1.7, z], "main", undefined, 6);
      }
      break;
    }
    case "palmwine": {
      allParts(k, ps.slice(0, 4), () => ({ color: "#6a4a30" }));
      // A roadside stand under a tiled roof (the palm-wine shed's place).
      solidPart(k, ps[4], { tex: "thatch", color: "#c8c8c8", tile: 2 });
      solidPart(k, ps[5], { color: WOOD, level: "main" });
      for (let i = 0; i < 4; i++) k.cyl(r.pick(["#e8e0c8", "#c8b890"]), 0.18, 0.5, [-1.5 + i, 0.7, 1], "detail", { sides: 6 });
      break;
    }
    case "chief": {
      // The manor (the chief's compound's place): brick, a slate roof, stone gate posts.
      solidPart(k, ps[0], { tex: "brick", color: "#dcd6cc", tile: 4 });
      facade(k, 0, -4, 16, 10, 1, 4.2, { night });
      pitched(k, 0, -4, 16, 10, 4.2, TILES);
      for (const i of [1, 2]) {
        solidPart(k, ps[i], { tex: "brick", color: "#dcd6cc", tile: 4 });
        pitched(k, ps[i].x, ps[i].z, 4, 4, 3.6, ZINC[i]);
      }
      allParts(k, ps.slice(3), () => ({ tex: "concrete", color: "#c8c4bc", tile: 2 }));
      for (const x of [-2.2, 2.2]) {
        k.box("#9a968e", [0.6, 3.2, 0.6], [x, 1.6, 13], "main");
        k.box("#8a867e", [0.8, 0.25, 0.8], [x, 3.3, 13], "detail");
      }
      break;
    }
    case "borehole": {
      solidPart(k, ps[0], { color: "#9a9890" });
      // v4 rework: a grey pump house and a steel tank (no blue borehole).
      solidPart(k, ps[1], { color: "#7a8086" });
      allParts(k, ps.slice(2, 6), () => ({ color: METAL }));
      k.cyl("#9aa0a6", 0.9, 1.6, [ps[6].x, 3.8, ps[6].z], "mass", { sides: 10 });
      break;
    }
    case "mechanic": {
      allParts(k, ps.slice(0, 4), () => ({ color: "#4a4e52" }));
      solidPart(k, ps[4], { tex: "zinc", color: "#8a8e92", tile: 2 });
      // Cars on blocks, a bonnet up, tyres in a pile, a spray of oil.
      k.box("#3a5a8a", [1.8, 0.7, 4.2], [-3.5, 0.75, 3.5], "mass");
      k.box("#3a5a8a", [1.6, 0.5, 2.2], [-3.5, 1.35, 3.3], "main");
      k.box("#8a2a2a", [1.8, 0.7, 4.2], [3.5, 0.75, 4.5], "mass");
      k.box("#8a2a2a", [1.7, 0.06, 1.3], [3.5, 1.7, 6.0], "main", [-0.9, 0, 0]);
      for (let i = 0; i < 4; i++) k.cyl("#1a1a1a", 0.4, 0.25, [6.5, 0.15 + i * 0.26, -3.5], "main", { sides: 10 });
      k.box("#1a1a1a", [3, 0.01, 2], [0, 0.005, 0], "detail");
      break;
    }
    case "barber": {
      // v4 rework: a green steel newsstand (the roadside barber's place).
      solidPart(k, ps[0], { color: "#2f4a3a" });
      k.box("#24382c", [2.6, 0.08, 1.2], [0, 2.7, 1.0], "main");
      k.box("#e8e6e0", [2.4, 0.5, 0.06], [0, 2.35, 0.63], "main");
      for (let i = 0; i < 4; i++) k.box(r.pick(["#c8c4b8", "#a8b4c0", "#d8c8a8", "#b8a8a8"]), [0.42, 0.56, 0.03], [-0.75 + i * 0.5, 1.4, 0.65], "detail");
      break;
    }
    case "carpenter": {
      allParts(k, ps.slice(0, 4), () => ({ color: "#4a4e52" }));
      solidPart(k, ps[4], { tex: "zinc", color: "#8a8e92", tile: 2 });
      solidPart(k, ps[5], { tex: "wood", color: "#b08860", tile: 1 });
      for (let i = 0; i < 6; i++) k.box("#c8a070", [0.3, 0.05, 2.4], [2 + (i % 3) * 0.35, 0.03 + Math.floor(i / 3) * 0.05, -1], "detail");
      break;
    }
    case "carriage": {
      solidPart(k, ps[0], { color: "#6a3a2a" });
      for (let i = 0; i < 6; i++) k.box(WINDOW, [0.06, 0.9, 1.2], [1.53, 2.8, -6 + i * 2.4], "main");
      k.box("#5a2a1a", [3.1, 0.25, 15.1], [0, 4.25, 0], "main");
      allParts(k, ps.slice(1), () => ({ color: "#2a2a2a" }));
      // The rails under it, on to the edge of the world.
      for (const x of [-0.72, 0.72]) k.box("#6a6a6a", [0.08, 0.12, 24], [x, 0.06, 0], "detail");
      for (let z = -11; z <= 11; z += 1.4) k.box("#5a4030", [2.2, 0.08, 0.25], [0, 0.03, z], "detail");
      break;
    }
    case "okada":
      // Parked motorbikes.
      for (let i = 0; i < 4; i++) {
        const x = -3 + i * 2;
        k.box(r.pick(["#1a1c1e", "#2a2e32", "#5a6068", "#8a1e22"]), [0.3, 0.45, 1.3], [x, 0.75, 0], "main");
        k.cyl("#1a1a1a", 0.32, 0.12, [x, 0.32, 0.65], "main", { r: [0, 0, Math.PI / 2], sides: 10 });
        k.cyl("#1a1a1a", 0.32, 0.12, [x, 0.32, -0.65], "main", { r: [0, 0, Math.PI / 2], sides: 10 });
        k.box("#3a3a3a", [0.7, 0.05, 0.05], [x, 1.1, 0.6], "detail");
      }
      break;
    case "genalley":
      // v4 rework: a back alley: brick walls, wheelie bins and dumpsters (no generators, no cables).
      allParts(k, ps.slice(0, 2), () => ({ tex: "brick", color: "#a89080", tile: 2 }));
      for (let i = 2; i < ps.length; i++) {
        const q = ps[i];
        solidPart(k, q, { color: r.pick(["#2f4a3a", "#3a3e42", "#2a3a4a"]) });
        k.box("#24272a", [q.hx * 2 + 0.08, 0.08, q.hz * 2 + 0.08], [q.x, q.y1 + 0.04, q.z], "detail", q.rot ? [0, q.rot, 0] : undefined);
      }
      break;
    case "plaza":
      solidPart(k, ps[0], { tex: "concrete", color: "#c8c0b0", tile: 1.5 });
      k.tree([0, 0.55, 0], 5, ["#3a6a2a", "#4a7a30"]);
      allParts(k, ps.slice(1), () => ({ color: WOOD, level: "main" }));
      break;
    case "prop": {
      // Its model draws it (Medium and up, with the library); without, what stops you shows as a plain crate.
      if (k.props.has(v & 255)) break;
      const q = propOf(v);
      if (q.solid) k.box("#6a6e72", [q.w, q.h, q.d], [0, q.h / 2, 0], "mass");
      break;
    }
    case "wall":
      // v4 rework: brick with a coping (no compound wall).
      allParts(k, ps, () => ({ tex: "brick", color: "#b89a88", tile: 2 }));
      for (const q of ps) if (q.kind !== "ramp" && q.y1 > 0.5) k.box("#cfcac0", [q.hx * 2 + 0.08, 0.08, q.hz * 2 + 0.08], [q.x, q.y1 + 0.04, q.z], "detail", q.rot ? [0, q.rot, 0] : undefined);
      break;
    // ── v4 Phase 7: the big world's places (low-poly, coloured per vertex, merged per cell) ──
    case "pine":
    case "snowpine": {
      // A spruce (v4 rework: the forest less like a toy): a tapering trunk, more,
      // thinner tiers that narrow to a spire, each turned and tipped a little,
      // the greens varied per tree. Medium and up: 7 tiers of 10 sides.
      const h = 10 + r.range(0, 6);
      const hi = k.tier >= 1;
      k.cyl("#3b2e23", 0.32, h * 0.55, [0, h * 0.27, 0], "mass", { sides: hi ? 10 : 6, top: 0.45 });
      const tint = r.range(-0.04, 0.04);
      // v5, Frostline: snow on it, more toward the top.
      const greens = (p.prefab === "snowpine" ? ["#b9c9c6", "#a7bbb8", "#dfe7e8", "#8fa6a0"] : ["#1d3822", "#24402a", "#2b472d", "#203a26"]).map((c) => shadeHex(c, tint));
      const n = hi ? 7 : 5;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const rad = (2.7 - t * 2.15) * r.range(0.88, 1.08);
        const th = h * (0.26 - t * 0.1);
        k.cone(r.pick(greens), rad, th, [r.range(-0.1, 0.1), h * (0.2 + t * 0.66), r.range(-0.1, 0.1)], "foliage", [r.range(-0.07, 0.07), r.range(0, 6.28), r.range(-0.07, 0.07)], hi ? 10 : 6);
      }
      break;
    }
    case "rock": {
      const s = 1.2 + (v % 7) * 0.4;
      const c = r.pick(["#7a746a", "#8a8278", "#6a645c"]);
      k.blob(c, [s * 0.95, s * 0.55, s * 0.75], [0, s * 0.35, 0], "mass");
      k.blob(c, [s * 0.55, s * 0.4, s * 0.5], [s * 0.6, s * 0.2, s * 0.2], "main");
      break;
    }
    case "cabin":
      k.texBox("wood", "#8a6a48", [6.4, 3, 5.4], [0, 1.5, 0], 2);
      k.box("#3a3028", [7, 0.25, 6.2], [0, 3.15, 0], "main", [0, 0, 0.18]);
      k.box("#2a2420", [1, 2, 0.1], [0, 1, 2.75], "detail");
      k.glow("#ffcf7a", [0.8, 0.6, 0.05], [1.8, 1.7, 2.72]);
      break;
    case "rangertower":
      allParts(k, ps, () => ({ tex: "wood", color: "#7a5a3a", tile: 2 }));
      k.box("#5a4632", [4.8, 1.1, 0.1], [0, 9.8, 2.35], "main");
      k.box("#3a3028", [5.6, 0.2, 5.6], [0, 11.4, 0], "main");
      for (const [x, z] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) k.box("#5a4632", [0.15, 2.2, 0.15], [x, 10.3, z], "detail");
      break;
    case "turbine": {
      // The tower and the nacelle (the blades turn: drawn by world/scenery.ts).
      k.cyl("#e8e8e4", 1.3, 46, [0, 23, 0], "mass", { sides: 10, top: 0.55 });
      k.box("#dcdcd6", [2.4, 2.4, 6], [0, 46.8, -0.6], "main");
      k.glow("#ff2a1a", [0.4, 0.4, 0.4], [0, 48.2, -0.6]);
      break;
    }
    case "containers": {
      const hi = 2 + (v % 2);
      const cols = ["#b0392b", "#2f6f8f", "#c47a24", "#3b7a42", "#6a6a6a", "#8a2a5a"];
      for (const [x, n] of [[-1.6, hi], [1.6, hi - 1]] as const) {
        for (let k2 = 0; k2 < n; k2++) {
          const c = r.pick(cols);
          k.box(c, [2.44, 2.55, 12.1], [x, 1.3 + k2 * 2.6, 0], k2 === 0 ? "mass" : "main");
          for (let s2 = -5.5; s2 <= 5.5; s2 += 0.5) k.box(c, [2.5, 2.3, 0.08], [x, 1.3 + k2 * 2.6, s2], "detail", undefined, 0.78);
        }
      }
      break;
    }
    case "crane": {
      const y = "#e8b620";
      for (const [x, z] of [[-6, -4], [6, -4], [-6, 4], [6, 4]]) k.box(y, [1, 30, 1], [x, 15, z], "mass");
      k.box(y, [13, 1.6, 1.6], [0, 30, -4], "main");
      k.box(y, [13, 1.6, 1.6], [0, 30, 4], "main");
      k.box(y, [2.4, 1.8, 44], [0, 32, 6], "main");
      k.box("#3a3a3a", [3, 3, 3], [0, 33, -4], "main");
      k.box("#2a2a2a", [0.12, 18, 0.12], [0, 22, 18], "detail");
      break;
    }
    case "warehouse":
      k.texBox("zinc", "#8a9096", [30, 9, 22], [0, 4.5, 0], 3);
      k.box("#6a7076", [31, 0.5, 23], [0, 9.2, 0], "main");
      k.box("#3a3e42", [8, 6, 0.1], [0, 3, 11.05], "detail");
      break;
    case "tank": {
      const rr = 7 + (v % 4) * 1.5;
      const h = 12 + (v % 3) * 2;
      k.cyl("#d8d4cc", rr, h, [0, h / 2, 0], "mass", { sides: 16 });
      k.cyl("#c8c4bc", rr * 1.01, 0.4, [0, h * 0.33, 0], "detail", { sides: 16 });
      k.cyl("#c8c4bc", rr * 1.01, 0.4, [0, h * 0.66, 0], "detail", { sides: 16 });
      k.cyl("#b8b4ac", rr * 0.98, 1.2, [0, h + 0.4, 0], "main", { sides: 16, top: 0.6 });
      k.box("#3a3a3a", [0.2, h, 0.2], [rr * 0.72, h / 2, rr * 0.72], "detail");
      break;
    }
    case "flarestack":
      k.cyl("#5a5a5a", 0.7, 34, [0, 17, 0], "mass", { sides: 10 });
      k.glow("#ff8a1a", [1.6, 3.2, 1.6], [0, 36, 0]);
      k.glow("#ffd24a", [0.9, 2, 0.9], [0, 35.4, 0]);
      break;
    case "pipes":
      for (const x of [-0.7, 0, 0.7]) k.cyl(r.pick(["#8a8a84", "#6a6a64", "#9a6a3a"]), 0.32, 24, [x, 1.1, 0], "mass", { sides: 10, r: [Math.PI / 2, 0, 0] });
      for (let z = -11; z <= 11; z += 5.5) k.box("#4a4a4a", [2.4, 0.2, 0.3], [0, 0.6, z], "detail");
      break;
    case "hangar":
      k.texBox("zinc", "#9aa0a4", [0.6, 12, 30], [-17.6, 6, 0], 3);
      k.texBox("zinc", "#9aa0a4", [0.6, 12, 30], [17.6, 6, 0], 3);
      k.texBox("zinc", "#9aa0a4", [36, 12, 0.6], [0, 6, -14.7], 3);
      k.box("#7a8084", [37, 1.2, 31], [0, 12.6, 0], "main");
      k.box("#e8e0c8", [6, 1.4, 0.1], [0, 10.2, 15.05], "detail");
      break;
    case "ctower":
      k.texBox("concrete", "#c8c0b0", [4, 18, 4], [0, 9, 0], 3);
      k.box("#2a4a5a", [7, 3, 7], [0, 19.5, 0], "main");
      k.box("#d8d0c0", [7.4, 0.4, 7.4], [0, 21.2, 0], "main");
      k.glow("#ff2a1a", [0.5, 0.5, 0.5], [0, 22, 0]);
      break;
    case "planewreck": {
      const c = "#c8ccd0";
      k.cyl(c, 2.1, 22, [0, 2.1, 0], "mass", { sides: 10, r: [Math.PI / 2, 0, 0.05] });
      k.box(c, [22, 0.5, 4], [0, 1.9, -1], "main", [0, 0, 0.08]);
      k.box("#3a3a3a", [2.2, 1.4, 6], [0, 2.4, 9], "detail");
      k.box(c, [0.4, 4, 3.6], [0, 4.6, -9.5], "main");
      k.blob("#2a2622", [3, 0.6, 3], [5, 0.2, 2], "detail");
      break;
    }
    case "dune": {
      const w = 18 + (v % 5) * 4;
      allParts(k, ps, () => ({ color: "#d8b880" }));
      k.blob("#cfae74", [w * 0.4, 0.5, 2], [0, 2, 0], "main");
      break;
    }
    case "mangrove": {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        k.box("#4a3a2a", [0.12, 1.6, 0.12], [Math.cos(a) * 0.7, 0.6, Math.sin(a) * 0.7], "mass", [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5]);
      }
      k.cyl("#4a3a2a", 0.3, 4, [0, 3, 0], "mass", { sides: 6 });
      k.blob(r.pick(["#2a4a2a", "#334f2c", "#2b4426"]), [2.6, 1.6, 2.6], [0, 5.2, 0]);
      break;
    }
    case "stilt":
      allParts(k, ps, () => ({ tex: "wood", color: "#6a5038", tile: 2 }));
      k.box("#4a4038", [6, 0.25, 5], [0, 4.8, -1], "main", [0.15, 0, 0]);
      break;
    case "club": {
      k.texBox("concrete", "#2a2a30", [22, 7, 16], [0, 3.5, 0], 3);
      // Neon: strips round the roofline, a sign over the door (a word, no brand).
      const neon = r.pick(["#ff2a8a", "#2ad8ff", "#a04aff", "#ffd02a"]);
      k.glow(neon, [22.2, 0.18, 0.1], [0, 6.6, 8.05]);
      k.glow(neon, [0.1, 0.18, 16.2], [11.05, 6.6, 0]);
      k.glow(neon, [0.1, 0.18, 16.2], [-11.05, 6.6, 0]);
      k.glow("#ffffff", [6, 1.2, 0.1], [0, 4.6, 8.06]);
      k.box("#111114", [3, 2.6, 0.1], [0, 1.3, 8.06], "detail");
      break;
    }
    case "stand":
      allParts(k, ps, () => ({ color: "#9a968c" }));
      for (let row = 0; row < 10; row++) k.box(row % 2 ? "#2a6a3a" : "#c0392b", [59, 0.3, 0.5], [0, 0.6 + row * 0.66, -5.2 + row * 1.15], "detail");
      for (const x of [-29, 0, 29]) k.box("#5a5a5a", [0.5, 18, 0.5], [x, 9, -6.5], "main");
      for (const x of [-29, 0, 29]) k.glow("#fff6d8", [3, 1.2, 0.4], [x, 18.4, -6.3]);
      break;
    case "glasstower": {
      const w = 18 + (v % 3) * 4;
      const h = 40 + (v % 4) * 12;
      k.texBox("glass", "#e8eef2", [w, h, w], [0, h / 2, 0], 16);
      k.box("#3a4248", [w + 0.6, 1, w + 0.6], [0, h + 0.5, 0], "main");
      for (let y = 4; y < h; y += 4) k.box("#5a6a74", [w + 0.1, 0.25, w + 0.1], [0, y, 0], "detail");
      k.glow("#ff2a1a", [0.5, 0.5, 0.5], [0, h + 1.4, 0]);
      break;
    }
    default:
      allParts(k, ps, byMaterial(WALLS[0]));
  }
  void RUST;
}

/** A hex colour lightened (k > 0) or darkened (k < 0) by a fraction. */
function shadeHex(c: string, k: number): string {
  const n = parseInt(c.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 + k))));
  return `#${((f(n >> 16) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).padStart(6, "0")}`;
}
