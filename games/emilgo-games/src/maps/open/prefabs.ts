// The open worlds' building blocks (SPEC-V3 §6): each prefab's size, its
// variant's numbers, and its solid parts. Pure and shared: the server builds
// the same walls, roofs and stairs from the same layout. How a prefab LOOKS is
// the client's business (maps/open/art.ts), from the same numbers.
//
// Local axes: the prefab's front faces +z, its width runs along x, the origin
// is the middle of its footprint on the ground. A placement turns it by `rot`
// (three's rotateY) and moves it to (x, z).

import type { Surface } from "../registry";
import type { Solid } from "../../game/core/space";

/** A variant's numbers, from its seed: the same seed, the same building, everywhere. */
export function vrand(v: number): () => number {
  let a = (v ^ 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Placement {
  prefab: PrefabId;
  x: number;
  z: number;
  rot: number;
  /** Variant seed. */
  v: number;
}

/** A solid in the prefab's own axes. */
export interface Part {
  x: number;
  z: number;
  hx: number;
  hz: number;
  rot?: number;
  y0: number;
  y1: number;
  y2?: number;
  kind?: "box" | "ramp" | "pit";
  surface?: Surface;
}

const box = (x: number, z: number, w: number, d: number, y0: number, y1: number, surface: Surface = "concrete"): Part => ({ x, z, hx: w / 2, hz: d / 2, y0, y1, surface });

// ── Each prefab's numbers ─────────────────────────────────────────────────────

export interface HouseP { w: number; d: number; h: number; roof: "zinc" | "tiles"; wall: number; fence: boolean }
export interface StoreyP { w: number; d: number; floors: number; fh: number; stairs: boolean; tank: boolean; wall: number; shop: boolean }
export interface ShopsP { w: number; d: number; h: number; units: number; wall: number }
export interface OfficeP { w: number; d: number; floors: number; glass: boolean; wall: number }
export interface CompoundP { w: number; d: number; wall: number }
export interface HutP { r: number }
export interface MudP { w: number; d: number }

/** The id of every prefab. */
export type PrefabId =
  | "house" | "storey" | "shops" | "office" | "compound" | "courtyard"
  | "church" | "mosque" | "school" | "petrol" | "watertower" | "mast" | "viewing" | "buspark" | "market" | "suya"
  | "uncompleted" | "kiosk" | "generator" | "pole" | "wreck" | "danfo" | "busstop" | "footbridge" | "overbridge"
  | "tree" | "palm" | "bush" | "baobab" | "hut" | "mudhouse" | "farm" | "palmwine" | "chief" | "borehole"
  | "mechanic" | "barber" | "carpenter" | "carriage" | "okada" | "genalley" | "plaza" | "wall";

export function houseP(v: number): HouseP {
  const r = vrand(v);
  return { w: 9 + r() * 3, d: 8 + r() * 2, h: 3.4, roof: r() < 0.6 ? "zinc" : "tiles", wall: Math.floor(r() * 8), fence: r() < 0.55 };
}
export function storeyP(v: number): StoreyP {
  const r = vrand(v);
  const floors = r() < 0.7 ? 2 : 3;
  return { w: 11 + r() * 3, d: 10 + r() * 2, floors, fh: 3.2, stairs: floors === 2, tank: r() < 0.8, wall: Math.floor(r() * 8), shop: r() < 0.45 };
}
export function shopsP(v: number): ShopsP {
  const r = vrand(v);
  const units = 3 + Math.floor(r() * 4);
  return { w: units * 4.2, d: 6, h: 3.6, units, wall: Math.floor(r() * 8) };
}
export function officeP(v: number): OfficeP {
  const r = vrand(v);
  return { w: 15 + r() * 4, d: 11 + r() * 3, floors: 3 + Math.floor(r() * 2), glass: r() < 0.5, wall: Math.floor(r() * 8) };
}
export function compoundP(v: number): CompoundP {
  const r = vrand(v);
  return { w: 22 + r() * 4, d: 16 + r() * 2, wall: Math.floor(r() * 8) };
}
export function hutP(v: number): HutP {
  return { r: 2 + vrand(v)() * 0.6 };
}
export function mudP(v: number): MudP {
  const r = vrand(v);
  return { w: 6.5 + r() * 2, d: 5 + r() * 1.5 };
}

/** Footprint (w × d) of a prefab variant: the layout keeps footprints apart. */
export function footprint(id: PrefabId, v: number): [number, number] {
  switch (id) {
    case "house": { const p = houseP(v); return [p.w + (p.fence ? 2 : 0), p.d + (p.fence ? 3 : 0)]; }
    case "storey": { const p = storeyP(v); return [p.w + (p.stairs ? 1.6 : 0), p.d]; }
    case "shops": { const p = shopsP(v); return [p.w, p.d + 2]; }
    case "office": { const p = officeP(v); return [p.w, p.d]; }
    case "compound": { const p = compoundP(v); return [p.w, p.d]; }
    case "courtyard": return [COURTYARD.w, COURTYARD.d];
    case "church": return [16, 28];
    case "mosque": return [20, 20];
    case "school": return [44, 30];
    case "petrol": return [26, 20];
    case "watertower": return [8, 8];
    case "mast": return [9, 9];
    case "viewing": return [16, 12];
    case "buspark": return [40, 52];
    case "market": return [44, 60];
    case "suya": return [9, 7];
    case "uncompleted": return [14, 11];
    case "kiosk": return [2.6, 2.6];
    case "generator": return [1.2, 0.9];
    case "pole": return [0.4, 0.4];
    case "wreck": return [2, 4.4];
    case "danfo": return [2.1, 4.8];
    case "busstop": return [6, 2.4];
    case "footbridge": return [3.4, 26];
    case "overbridge": return [3, 32];
    case "tree": return [2, 2];
    case "palm": return [1.2, 1.2];
    case "bush": return [1.6, 1.6];
    case "baobab": return [6, 6];
    case "hut": { const p = hutP(v); return [p.r * 2 + 0.4, p.r * 2 + 0.4]; }
    case "mudhouse": { const p = mudP(v); return [p.w, p.d + 1.4]; }
    case "farm": return [22, 16];
    case "palmwine": return [8, 6];
    case "chief": return [30, 26];
    case "borehole": return [5, 5];
    case "mechanic": return [16, 12];
    case "barber": return [4, 3.5];
    case "carpenter": return [8, 6];
    case "carriage": return [3.2, 16];
    case "okada": return [8, 4];
    case "genalley": return [5, 24];
    case "plaza": return [12, 12];
    case "wall": return [10, 0.3];
  }
}

/** A house's front path through its fence. */
const GATE = 2.4;

/** The solid parts of a prefab variant, in its own axes. */
/**
 * The Face-me-I-face-you courtyard (Compound Wars, SPEC-V3 §9 #7; Phase 6):
 * a walled yard with four rooms down each side, each with a doorway onto the
 * yard (the doors themselves are the rooms module's), a flat roof over each
 * row, the gate at the front (+z). Rooms run back to front on the left (−x),
 * then on the right.
 */
export const COURTYARD = { w: 30, d: 24, deep: 5, long: 5, door: 1.2, wall: 3.2, roof: 3.0, t: 0.2 } as const;

export interface CourtRoom {
  /** 0–7: left row back to front, then the right row. */
  index: number;
  /** The room's inside: centre, half sizes along its own axes, the placement's turn. */
  x: number;
  z: number;
  hx: number;
  hz: number;
  rot: number;
  /** The doorway: its centre, which way is out (to the yard), its width. */
  door: { x: number; z: number; nx: number; nz: number; w: number };
}

function courtyardParts(): Part[] {
  const C = COURTYARD;
  const out: Part[] = [];
  const W = C.w;
  const D = C.d;
  const t = C.t;
  // The outer wall (the rooms' backs), the gate at the front.
  out.push(box(0, -D / 2 + t / 2, W, t, 0, C.wall));
  out.push(box(-W / 2 + t / 2, 0, t, D, 0, C.wall));
  out.push(box(W / 2 - t / 2, 0, t, D, 0, C.wall));
  const gate = 4;
  const side = (W - gate) / 2;
  out.push(box(-W / 2 + side / 2, D / 2 - t / 2, side, t, 0, C.wall));
  out.push(box(W / 2 - side / 2, D / 2 - t / 2, side, t, 0, C.wall));
  const z0 = -(C.long * 4) / 2;
  for (const sx of [-1, 1]) {
    const inner = sx * (W / 2 - t - C.deep);
    // The partitions between rooms (and the row's ends).
    for (let i = 0; i <= 4; i++) out.push(box(sx * (W / 2 - t - C.deep / 2), z0 + i * C.long, C.deep, t, 0, C.wall));
    // The wall onto the yard, with a doorway in each room.
    for (let i = 0; i < 4; i++) {
      const zc = z0 + (i + 0.5) * C.long;
      const seg = (C.long - C.door) / 2;
      out.push(box(inner, zc - C.door / 2 - seg / 2, t, seg, 0, C.wall));
      out.push(box(inner, zc + C.door / 2 + seg / 2, t, seg, 0, C.wall));
      // Over the doorway: the lintel.
      out.push(box(inner, zc, t, C.door, 2.2, C.wall));
    }
    // The row's flat roof.
    out.push(box(sx * (W / 2 - t - C.deep / 2), 0, C.deep + t, C.long * 4 + t, C.roof, C.roof + 0.2));
  }
  return out;
}

/** The courtyard's rooms in the world, for a placement of it. */
export function courtyardRooms(p: Placement): CourtRoom[] {
  const C = COURTYARD;
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const world = (x: number, z: number): [number, number] => [p.x + x * c + z * s, p.z - x * s + z * c];
  const out: CourtRoom[] = [];
  const z0 = -(C.long * 4) / 2;
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const zc = z0 + (i + 0.5) * C.long;
      const [x, z] = world(sx * (C.w / 2 - C.t - C.deep / 2), zc);
      const [dx, dz] = world(sx * (C.w / 2 - C.t - C.deep), zc);
      // Out of the room is towards the yard's middle (−sx along the local x).
      const nx = -sx * c;
      const nz = sx * s;
      out.push({ index: out.length, x, z, hx: C.deep / 2 - C.t, hz: C.long / 2 - C.t, rot: p.rot, door: { x: dx, z: dz, nx, nz, w: C.door } });
    }
  }
  return out;
}

export function parts(id: PrefabId, v: number): Part[] {
  const out: Part[] = [];
  switch (id) {
    case "courtyard":
      return courtyardParts();
    case "house": {
      const p = houseP(v);
      out.push(box(0, p.fence ? -1.5 : 0, p.w, p.d, 0, p.h));
      if (p.fence) fenceRing(out, p.w + 2, p.d + 3, 1.8, GATE);
      break;
    }
    case "storey": {
      const p = storeyP(v);
      const h = p.floors * p.fh + 0.3;
      const bx = p.stairs ? -0.8 : 0;
      out.push(box(bx, 0, p.w, p.d, 0, h));
      if (p.stairs) {
        // Outside stairs up the right-hand wall, rising towards the back, onto the roof.
        const sx = bx + p.w / 2 + 0.75;
        out.push({ x: sx, z: 0.2, hx: 0.75, hz: p.d / 2 - 0.2, y0: 0, y1: 0, y2: h, kind: "ramp", rot: Math.PI, surface: "concrete" });
        // A parapet round the roof, open where the stairs arrive.
        out.push(box(bx, p.d / 2 - 0.1, p.w, 0.2, h, h + 0.9));
        out.push(box(bx - p.w / 2 + 0.1, 0, 0.2, p.d, h, h + 0.9));
        out.push(box(bx + p.w / 2 - 0.1, 0.9, 0.2, p.d - 1.8, h, h + 0.9));
        out.push(box(bx, -p.d / 2 + 0.1, p.w, 0.2, h, h + 0.9));
      }
      if (p.tank) out.push(box(bx - p.w / 4, -p.d / 4, 1.4, 1.4, h, h + 2.4, "metal"));
      break;
    }
    case "shops": {
      const p = shopsP(v);
      out.push(box(0, -1, p.w, p.d, 0, p.h));
      break;
    }
    case "office": {
      const p = officeP(v);
      out.push(box(0, 0, p.w, p.d, 0, p.floors * 3.3 + 0.5));
      break;
    }
    case "compound": {
      const p = compoundP(v);
      // Two rows of rooms facing a yard; a wall round all of it, the gate at the front.
      out.push(box(0, -p.d / 2 + 2.6, p.w - 0.6, 4.6, 0, 3.2));
      out.push(box(0, p.d / 2 - 2.6, p.w - 0.6, 4.6, 0, 3.2));
      fenceRing(out, p.w, p.d, 2.3, 3.2);
      break;
    }
    case "church":
      out.push(box(0, -2, 14, 24, 0, 7.5));
      out.push(box(0, 11.5, 5, 5, 0, 16));
      break;
    case "mosque":
      out.push(box(0, 0, 16, 16, 0, 6));
      out.push(box(7.5, 7.5, 2.6, 2.6, 0, 22));
      break;
    case "school":
      out.push(box(0, -9, 36, 8, 0, 3.8));
      out.push(box(-16, 11, 0.3, 0.3, 0, 9));
      fenceRing(out, 44, 30, 1.6, 4);
      break;
    case "petrol":
      for (const [x, z] of [[-6, -1], [6, -1], [-6, 5], [6, 5]]) out.push(box(x, z, 0.6, 0.6, 0, 5.2));
      out.push(box(0, 2, 18, 10, 5.0, 5.6, "metal"));
      for (const x of [-3, 3]) for (const z of [0.5, 3.5]) out.push(box(x, z, 0.8, 0.6, 0, 1.6, "metal"));
      out.push(box(0, -7, 9, 5, 0, 3.4));
      break;
    case "watertower":
      for (const [x, z] of [[-2.4, -2.4], [2.4, -2.4], [-2.4, 2.4], [2.4, 2.4]]) out.push(box(x, z, 0.4, 0.4, 0, 14));
      out.push(box(0, 0, 6.4, 6.4, 14, 18.5, "metal"));
      break;
    case "mast":
      out.push(box(0, 0, 3, 3, 0, 34, "metal"));
      out.push(box(2.8, 2.8, 2.6, 2.2, 0, 2.6, "metal"));
      fenceRing(out, 9, 9, 2.2, 1.6);
      break;
    case "viewing":
      out.push(box(0, -1, 14, 10, 0, 4.2));
      out.push(box(6.2, 5.2, 1.4, 0.9, 0, 1.0, "metal"));
      break;
    case "buspark":
      // The shade over the loading bays: posts only (you walk under its roof).
      for (let i = 0; i < 6; i++) for (const z of [-4, 4]) out.push(box(-15 + i * 6, z - 14, 0.3, 0.3, 0, 4.2));
      out.push(box(0, -14, 34, 10, 4.0, 4.4, "metal"));
      for (const x of [-12, 0, 12]) out.push(box(x, 21, 2.4, 2.4, 0, 2.7));
      for (let i = 0; i < 5; i++) out.push(box(-14 + i * 7, 6, 2.0, 4.8, 0, 2.4, "metal"));
      for (let i = 0; i < 4; i++) out.push(box(-10.5 + i * 7, 13.5, 2.0, 4.8, 0, 2.4, "metal"));
      break;
    case "market": {
      // Rows of stalls with aisles between; a covered shed in the middle.
      for (let row = 0; row < 6; row++) {
        const z = -25 + row * 10;
        if (row === 2 || row === 3) continue;
        for (let i = 0; i < 9; i++) out.push(box(-18 + i * 4.5, z, 3.2, 2.6, 0, 1.0, "wood"));
      }
      for (const [x, z] of [[-10, -4.5], [10, -4.5], [-10, 4.5], [10, 4.5]]) out.push(box(x, z, 0.3, 0.3, 0, 4.6));
      out.push(box(0, 0, 24, 11, 4.4, 4.9, "metal"));
      for (let i = 0; i < 5; i++) out.push(box(-12 + i * 6, 0, 3.4, 2.0, 0, 0.9, "wood"));
      break;
    }
    case "suya":
      out.push(box(-2.2, -1.2, 2.4, 1.6, 0, 1.0, "metal"));
      out.push(box(2.4, -1.6, 2.6, 2.4, 0, 2.6));
      for (const x of [-3, 0, 3]) out.push(box(x, 2.2, 2.0, 0.4, 0, 0.45, "wood"));
      break;
    case "uncompleted": {
      // Bare columns, a first-floor slab you reach up a plank ramp, block piles.
      for (const x of [-6, -2, 2, 6]) for (const z of [-4.5, 0, 4.5]) out.push(box(x, z, 0.3, 0.3, 0, 3.0));
      out.push(box(0, 0, 12.6, 9.4, 3.0, 3.25));
      out.push({ x: 7.2, z: 0.6, hx: 0.55, hz: 4.4, y0: 0, y1: 0, y2: 3.25, kind: "ramp", rot: Math.PI, surface: "wood" });
      out.push(box(-4, -6.4, 2.2, 1.2, 0, 1.0));
      break;
    }
    case "kiosk":
      out.push(box(0, 0, 2.4, 2.4, 0, 2.6, "metal"));
      break;
    case "generator":
      out.push(box(0, 0, 1.1, 0.75, 0, 0.85, "metal"));
      break;
    case "pole":
      out.push(box(0, 0, 0.3, 0.3, 0, 9, "wood"));
      break;
    case "wreck":
      out.push(box(0, 0, 1.8, 4.2, 0, 1.35, "metal"));
      break;
    case "danfo":
      out.push(box(0, 0, 1.95, 4.65, 0, 2.35, "metal"));
      break;
    case "busstop":
      out.push(box(-2.6, 0.8, 0.15, 0.15, 0, 2.6, "metal"));
      out.push(box(2.6, 0.8, 0.15, 0.15, 0, 2.6, "metal"));
      out.push(box(0, 0.2, 5.8, 2.2, 2.6, 2.8, "metal"));
      out.push(box(0, 0.6, 4.2, 0.5, 0, 0.45, "metal"));
      break;
    case "footbridge":
      // A plank deck across the river, a little above the bank.
      out.push(box(0, 0, 3, 26, -0.2, 0.3, "wood"));
      out.push(box(-1.45, 0, 0.1, 26, 0.3, 1.2, "wood"));
      out.push(box(1.45, 0, 0.1, 26, 0.3, 1.2, "wood"));
      break;
    case "overbridge": {
      // A pedestrian bridge over the expressway: stairs up each end, a deck 6 m up.
      const H = 6;
      out.push(box(0, 0, 2.6, 16, H - 0.3, H, "metal"));
      out.push({ x: 0, z: -12, hx: 1.3, hz: 4, y0: 0, y1: 0, y2: H, kind: "ramp", surface: "metal" });
      out.push({ x: 0, z: 12, hx: 1.3, hz: 4, y0: 0, y1: H, y2: 0, kind: "ramp", surface: "metal" });
      out.push(box(-1.35, 0, 0.1, 16, H, H + 1.1, "metal"));
      out.push(box(1.35, 0, 0.1, 16, H, H + 1.1, "metal"));
      for (const z of [-7.6, 7.6]) for (const x of [-1, 1]) out.push(box(x, z, 0.35, 0.35, 0, H - 0.3, "metal"));
      break;
    }
    case "tree":
      out.push(box(0, 0, 0.6, 0.6, 0, 6, "wood"));
      break;
    case "palm":
      out.push(box(0, 0, 0.5, 0.5, 0, 8, "wood"));
      break;
    case "bush":
      break;
    case "baobab":
      out.push(box(0, 0, 4.2, 4.2, 0, 9, "wood"));
      break;
    case "hut": {
      const p = hutP(v);
      out.push(box(0, 0, p.r * 1.7, p.r * 1.7, 0, 3.6));
      break;
    }
    case "mudhouse": {
      const p = mudP(v);
      out.push(box(0, -0.7, p.w, p.d, 0, 3.2));
      break;
    }
    case "farm":
      // Yam ridges: low enough to walk over (a step), bumpy underfoot.
      for (let i = 0; i < 8; i++) out.push(box(0, -7 + i * 2, 20, 0.7, 0, 0.32, "sand"));
      break;
    case "palmwine":
      for (const [x, z] of [[-3.6, -2.6], [3.6, -2.6], [-3.6, 2.6], [3.6, 2.6]]) out.push(box(x, z, 0.25, 0.25, 0, 2.8, "wood"));
      out.push(box(0, 0, 8, 6, 2.7, 3.0, "metal"));
      out.push(box(0, 1, 5, 0.5, 0, 0.45, "wood"));
      break;
    case "chief":
      out.push(box(0, -4, 16, 10, 0, 4.2));
      out.push(box(-10, 6, 4, 4, 0, 3.6));
      out.push(box(10, 6, 4, 4, 0, 3.6));
      fenceRing(out, 30, 26, 2.4, 4);
      break;
    case "borehole":
      out.push(box(0, 0, 4, 4, 0, 0.25));
      out.push(box(1.2, -1.2, 0.5, 0.5, 0.25, 1.3, "metal"));
      for (const [x, z] of [[-1.4, 1], [-0.2, 1], [-1.4, 2.2], [-0.2, 2.2]]) out.push(box(x, z - 1.4, 0.15, 0.15, 0.25, 3, "metal"));
      out.push(box(-0.8, 0.2, 1.6, 1.6, 3, 4.6, "metal"));
      break;
    case "mechanic":
      for (const [x, z] of [[-7, -5], [7, -5], [-7, 1], [7, 1]]) out.push(box(x, z, 0.3, 0.3, 0, 3.6, "metal"));
      out.push(box(0, -2, 15, 7.5, 3.5, 3.8, "metal"));
      out.push(box(-3.5, 3.5, 1.8, 4.2, 0, 1.35, "metal"));
      out.push(box(3.5, 4.5, 1.8, 4.2, 0, 1.35, "metal"));
      out.push(box(6.5, -3.5, 1.6, 1.6, 0, 1.0, "metal"));
      break;
    case "barber":
      out.push(box(0, -0.6, 3.2, 2.4, 0, 2.6, "wood"));
      break;
    case "carpenter":
      for (const [x, z] of [[-3.6, -2.6], [3.6, -2.6], [-3.6, 2.6], [3.6, 2.6]]) out.push(box(x, z, 0.25, 0.25, 0, 3.0, "wood"));
      out.push(box(0, 0, 8, 6, 2.9, 3.2, "metal"));
      out.push(box(-1, 0.5, 4, 1.2, 0, 0.9, "wood"));
      break;
    case "carriage":
      out.push(box(0, 0, 3, 15, 0.6, 4.2, "metal"));
      for (const z of [-5, 5]) out.push(box(0, z, 2.4, 1.4, 0, 0.6, "metal"));
      break;
    case "okada":
      for (let i = 0; i < 4; i++) out.push(box(-3 + i * 2, 0, 0.6, 1.9, 0, 1.1, "metal"));
      break;
    case "genalley":
      // A narrow lane between back walls, generators humming along it.
      out.push(box(-2.3, 0, 0.3, 24, 0, 3.4));
      out.push(box(2.3, 0, 0.3, 24, 0, 3.4));
      for (let i = 0; i < 4; i++) out.push(box(i % 2 ? 1.4 : -1.4, -9 + i * 6, 1.0, 0.7, 0, 0.85, "metal"));
      break;
    case "plaza":
      out.push(box(0, 0, 3, 3, 0, 0.55));
      for (const [x, z] of [[-4.5, -4.5], [4.5, -4.5], [-4.5, 4.5], [4.5, 4.5]]) out.push(box(x, z, 2.4, 0.5, 0, 0.45, "wood"));
      break;
    case "wall":
      out.push(box(0, 0, 10, 0.3, 0, 2.2));
      break;
  }
  return out;
}

/** A wall round a w × d yard, with a gap of `gate` in the middle of the front (+z). */
function fenceRing(out: Part[], w: number, d: number, h: number, gate: number): void {
  const t = 0.25;
  out.push(box(0, -d / 2 + t / 2, w, t, 0, h));
  out.push(box(-w / 2 + t / 2, 0, t, d, 0, h));
  out.push(box(w / 2 - t / 2, 0, t, d, 0, h));
  const side = (w - gate) / 2;
  out.push(box(-w / 2 + side / 2, d / 2 - t / 2, side, t, 0, h));
  out.push(box(w / 2 - side / 2, d / 2 - t / 2, side, t, 0, h));
}

/** A placement's parts in the world, as Space solids. */
export function solidsOf(p: Placement, out: Solid[]): void {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  for (const q of parts(p.prefab, p.v)) {
    out.push({
      x: p.x + q.x * c + q.z * s,
      z: p.z - q.x * s + q.z * c,
      hx: q.hx,
      hz: q.hz,
      rot: p.rot + (q.rot ?? 0),
      y0: q.y0,
      y1: q.y1,
      y2: q.y2,
      kind: q.kind ?? "box",
      surface: q.surface ?? "concrete",
    });
  }
}
