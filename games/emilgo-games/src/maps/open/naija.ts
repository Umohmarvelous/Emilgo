// Naija World (SPEC-V3 §6.1): one Nigerian city, 400 × 400 m. A built-up
// east of market streets, a bus park, offices, schools, compounds and two
// houses of worship, fading west through bare land, a mechanic village and an
// uncompleted estate into a village of mud houses, farms, a baobab square and
// a river with a footbridge. No skyscrapers: one to four floors.
//
// The plan (roads, the river, landmarks, places) is written here by hand; the
// streets are filled in from it with a seeded generator. Pure and shared: the
// server and every phone build exactly the same city from the same seed, so
// nothing about it goes on the wire. North is −z (the compass's N).

import { Rng } from "../../core/rng";
import type { Solid } from "../../game/core/space";
import type { Surface } from "../registry";
import { placeBoards, type BoardSlot, type BoardWish } from "./billboards";
import { footprint, propPlaced, solidsOf, type Placement, type PrefabId } from "./prefabs";
import { PROPS } from "./propTable";

export type GroundKind = "asphalt" | "laterite" | "paving" | "grass" | "earth" | "sand" | "snow";

export interface Road {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  w: number;
  kind: "asphalt" | "laterite";
  /** Open drains along both sides (city roads). */
  gutters: boolean;
  /** A raised median down the middle (the expressway). */
  median?: number;
}

export interface River {
  pts: [number, number][];
  w: number;
  depth: number;
  /** Water depth over the bed. */
  water: number;
}

export interface Landmark {
  id: string;
  name: string;
  x: number;
  z: number;
}

/** A place to find (SPEC-V3 §6.1's sub-locations): a name and a circle. */
export interface Area {
  id: string;
  name: string;
  x: number;
  z: number;
  r: number;
}

export interface Gutter {
  /** Centre line, length along it, and direction. */
  x: number;
  z: number;
  len: number;
  rot: number;
}

export interface Slab {
  x: number;
  z: number;
  rot: number;
}

export interface OpenLayout {
  id: string;
  /** Half the world's size: it runs from −half to +half on both axes. */
  half: number;
  roads: Road[];
  rivers: River[];
  landmarks: Landmark[];
  areas: Area[];
  placements: Placement[];
  gutters: Gutter[];
  slabs: Slab[];
  /** Everything solid: buildings, walls, stairs, roofs, gutters, the river. */
  solids: Solid[];
  /** Where Free For All players can start, spread over the city. */
  spawns: [number, number][];
  /** The billboards (SPEC-V3 §8): their slots, in id order. */
  boards?: BoardSlot[];
  /** The open ground underfoot where nothing stands. */
  groundAt(x: number, z: number): GroundKind;
}

export const SURFACE_OF: Record<GroundKind, Surface> = {
  asphalt: "concrete",
  paving: "concrete",
  laterite: "sand",
  earth: "sand",
  snow: "sand",
  sand: "sand",
  grass: "grass",
};

const HALF = 200;
/** The wall round the city: thickness and height. */
export const EDGE = { t: 0.4, h: 2.6 } as const;
/** Gutters: inner width, depth, wall thickness. */
export const GUTTER = { w: 0.8, depth: 0.9, wall: 0.16 } as const;

// ── The plan ──────────────────────────────────────────────────────────────────

const ROADS: Road[] = [
  // The expressway, north to south, dual carriageway with a median.
  { x0: 60, z0: -200, x1: 60, z1: 200, w: 15, kind: "asphalt", gutters: true, median: 1.2 },
  // Market Road, east to west: tarred in town, red earth once it reaches the village.
  { x0: -40, z0: 0, x1: 200, z1: 0, w: 10, kind: "asphalt", gutters: true },
  { x0: -200, z0: 0, x1: -40, z1: 0, w: 8, kind: "laterite", gutters: false },
  // Streets.
  { x0: 0, z0: -200, x1: 0, z1: 200, w: 8, kind: "asphalt", gutters: true },
  { x0: 120, z0: -200, x1: 120, z1: 200, w: 8, kind: "asphalt", gutters: true },
  { x0: 175, z0: -200, x1: 175, z1: 140, w: 7, kind: "asphalt", gutters: true },
  { x0: -30, z0: -90, x1: 200, z1: -90, w: 8, kind: "asphalt", gutters: true },
  { x0: 0, z0: -150, x1: 200, z1: -150, w: 7, kind: "asphalt", gutters: true },
  { x0: -30, z0: 75, x1: 200, z1: 75, w: 8, kind: "asphalt", gutters: true },
  { x0: 60, z0: 145, x1: 200, z1: 145, w: 7, kind: "asphalt", gutters: true },
  // Village paths.
  { x0: -135, z0: -120, x1: -135, z1: 0, w: 5, kind: "laterite", gutters: false },
  { x0: -110, z0: 0, x1: -110, z1: 120, w: 5, kind: "laterite", gutters: false },
  { x0: -200, z0: 60, x1: -110, z1: 60, w: 5, kind: "laterite", gutters: false },
  { x0: -60, z0: 75, x1: -30, z1: 75, w: 6, kind: "laterite", gutters: false },
  { x0: -60, z0: 75, x1: -60, z1: 190, w: 6, kind: "laterite", gutters: false },
];

const RIVER: River = {
  pts: [[-200, 108], [-165, 126], [-130, 150], [-98, 172], [-72, 200]],
  w: 13,
  depth: 1.0,
  water: 0.75,
};

export const NAIJA_LANDMARKS: Landmark[] = [
  { id: "buspark", name: "Central Transit Hub", x: 92, z: 110 },
  { id: "market", name: "Market Arcade", x: 30, z: -40 },
  { id: "suya", name: "Grill Junction", x: 74, z: -12 },
  { id: "watertower", name: "Water Tower", x: 150, z: -120 },
  { id: "viewing", name: "Sports Bar", x: -45, z: -14 },
  { id: "church", name: "Town Hall", x: 148, z: 40 },
  { id: "mosque", name: "City Museum", x: 92, z: -120 },
  { id: "school", name: "Northgate School", x: 150, z: 172 },
  { id: "baobab", name: "Oak Square", x: -127, z: -25 },
  { id: "bridge", name: "River Footbridge", x: -130, z: 150 },
  { id: "petrol", name: "Fuel Station", x: 30, z: 18 },
  { id: "mast", name: "Telecom Mast", x: -75, z: 112 },
];

export const NAIJA_AREAS: Area[] = [
  { id: "drains", name: "The Drains", x: 52, z: -60, r: 10 },
  { id: "compound", name: "Courtyard Flats", x: 100, z: 40, r: 14 },
  { id: "rooftops", name: "The Rooftops", x: 150, z: -40, r: 18 },
  { id: "busstop", name: "Bus Stop", x: 71, z: -60, r: 6 },
  { id: "okada", name: "Bike Park", x: 132, z: 100, r: 7 },
  { id: "barber", name: "Barber Shop", x: -18, z: 30, r: 5 },
  { id: "tailor", name: "Newsstand", x: 40, z: -100, r: 5 },
  { id: "mechanic", name: "Auto Row", x: -60, z: -30, r: 12 },
  { id: "carpenter", name: "Workshop", x: -88, z: 30, r: 6 },
  { id: "farm", name: "Old Farm", x: -160, z: -150, r: 20 },
  { id: "palmwine", name: "Roadside Stand", x: -100, z: 70, r: 6 },
  { id: "chief", name: "The Manor", x: -168, z: 25, r: 16 },
  { id: "borehole", name: "Water Pump", x: -150, z: -12, r: 5 },
  { id: "estate", name: "Construction Site", x: -45, z: 160, r: 20 },
  { id: "overbridge", name: "Pedestrian Bridge", x: 60, z: -40, r: 8 },
  { id: "plaza", name: "Hidden Plaza", x: 40, z: -79, r: 7 },
  { id: "genalley", name: "Utility Alley", x: 160, z: 105, r: 8 },
  { id: "siding", name: "Rail Siding", x: 192, z: -45, r: 14 },
];

/** Hand-placed: the landmarks and the places, each where the plan says. */
const FIXED: Omit<Placement, "v">[] = [
  { prefab: "buspark", x: 92, z: 110, rot: 0 },
  { prefab: "market", x: 30, z: -40, rot: 0 },
  { prefab: "suya", x: 74, z: -12, rot: 0 },
  { prefab: "watertower", x: 150, z: -120, rot: 0 },
  { prefab: "viewing", x: -45, z: -14, rot: 0 },
  { prefab: "church", x: 148, z: 40, rot: 0 },
  { prefab: "mosque", x: 92, z: -120, rot: 0 },
  { prefab: "school", x: 150, z: 172, rot: Math.PI },
  { prefab: "baobab", x: -127, z: -25, rot: 0 },
  { prefab: "footbridge", x: -130, z: 150, rot: 2.54 },
  { prefab: "petrol", x: 30, z: 18, rot: Math.PI },
  { prefab: "mast", x: -75, z: 112, rot: 0 },
  // Face-me-I-face-you: rooms round a yard you can walk into (Compound Wars plays here).
  { prefab: "courtyard", x: 100, z: 40, rot: Math.PI / 2 },
  { prefab: "busstop", x: 71, z: -60, rot: -Math.PI / 2 },
  { prefab: "okada", x: 132, z: 100, rot: Math.PI / 2 },
  { prefab: "barber", x: -18, z: 30, rot: Math.PI / 2 },
  { prefab: "kiosk", x: 40, z: -100, rot: Math.PI },
  { prefab: "mechanic", x: -60, z: -30, rot: Math.PI },
  { prefab: "carpenter", x: -88, z: 30, rot: -Math.PI / 2 },
  { prefab: "farm", x: -165, z: -150, rot: 0 },
  { prefab: "farm", x: -160, z: -120, rot: 0 },
  { prefab: "palmwine", x: -100, z: 70, rot: Math.PI / 2 },
  { prefab: "chief", x: -168, z: 25, rot: Math.PI / 2 },
  { prefab: "borehole", x: -150, z: -12, rot: 0 },
  { prefab: "uncompleted", x: -45, z: 150, rot: 0 },
  { prefab: "uncompleted", x: -35, z: 172, rot: Math.PI / 2 },
  { prefab: "uncompleted", x: -78, z: 160, rot: -Math.PI / 2 },
  { prefab: "overbridge", x: 60, z: -40, rot: Math.PI / 2 },
  { prefab: "plaza", x: 40, z: -79, rot: 0 },
  { prefab: "genalley", x: 160, z: 105, rot: 0 },
  { prefab: "carriage", x: 192, z: -45, rot: 0 },
  { prefab: "carriage", x: 193, z: -22, rot: 0.04 },
];

/**
 * Where the billboards are wanted (SPEC-V3 §8): the expressway and Market
 * Road, the landmarks people meet at, the plaza's way in, the danfo's route,
 * the middle the zone closes on. Each faces down its road (or at its place);
 * the nearest free ground is used. None by the church, the mosque or the school.
 * A board's id is its place here ("nw-03"): ads are booked by it, so new
 * boards go on the end and none is ever taken out of the middle.
 */
const BOARD_WISHES: BoardWish[] = [
  // The expressway, both sides, facing the traffic.
  { x: 74, z: -172, fx: 60, fz: -135, kind: "road", premium: true },
  { x: 46, z: -112, fx: 60, fz: -80, kind: "road" },
  { x: 74, z: 28, fx: 60, fz: 60, kind: "road", premium: true },
  { x: 46, z: 98, fx: 60, fz: 130, kind: "road" },
  { x: 74, z: 176, fx: 60, fz: 140, kind: "road" },
  // Market Road.
  { x: 100, z: 12, fx: 130, fz: 0, kind: "road" },
  { x: 160, z: -12, fx: 130, fz: 0, kind: "road" },
  { x: -22, z: 12, fx: 10, fz: 0, kind: "road" },
  // The landmarks.
  { x: 70, z: 92, fx: 92, fz: 110, kind: "landmark", premium: true, r: 18 },
  { x: -6, z: -60, fx: 30, fz: -40, kind: "landmark", r: 18 },
  { x: -45, z: 10, fx: -45, fz: -14, kind: "landmark", r: 16 },
  { x: 12, z: 32, fx: 30, fz: 18, kind: "landmark", r: 16 },
  // The plaza's way in, the danfo's route, the zone's middle.
  { x: 22, z: -96, fx: 40, fz: -79, kind: "plaza", r: 12 },
  { x: 132, z: -110, fx: 120, fz: -80, kind: "route" },
  { x: -12, z: -130, fx: 0, fz: -100, kind: "route" },
  { x: 132, z: 60, fx: 120, fz: 30, kind: "route" },
  { x: 76, z: -12, fx: 60, fz: 0, kind: "zone", r: 16 },
];

type Kind = "commercial" | "residential" | "civic" | "belt" | "village";

/** What kind of place a point is in. */
function districtOf(x: number, z: number): Kind {
  if (x < -85) return "village";
  if (x < -25) return "belt";
  if (x > 0 && x < 120 && z > -95 && z < 80) return "commercial";
  if (x > 60 && x < 125 && z > 80 && z < 150) return "commercial";
  return "residential";
}

// ── Footprints, kept apart ────────────────────────────────────────────────────

export interface Rect {
  x: number;
  z: number;
  hx: number;
  hz: number;
  c: number;
  s: number;
}

export function rectOf(x: number, z: number, w: number, d: number, rot: number): Rect {
  return { x, z, hx: w / 2, hz: d / 2, c: Math.cos(rot), s: Math.sin(rot) };
}

/** Separating-axis test for two turned rectangles. */
function overlap(a: Rect, b: Rect): boolean {
  const axes: [number, number][] = [[a.c, -a.s], [a.s, a.c], [b.c, -b.s], [b.s, b.c]];
  for (const [ax, az] of axes) {
    const pa = Math.abs(a.hx * (a.c * ax - a.s * az)) + Math.abs(a.hz * (a.s * ax + a.c * az));
    const pb = Math.abs(b.hx * (b.c * ax - b.s * az)) + Math.abs(b.hz * (b.s * ax + b.c * az));
    const d = Math.abs((b.x - a.x) * ax + (b.z - a.z) * az);
    if (d > pa + pb) return false;
  }
  return true;
}

export class Taken {
  private readonly cells = new Map<number, Rect[]>();
  private key(q: number, r: number): number {
    return (q + 64) * 1024 + (r + 64);
  }
  private span(t: Rect): [number, number, number, number] {
    const ex = Math.abs(t.c) * t.hx + Math.abs(t.s) * t.hz;
    const ez = Math.abs(t.s) * t.hx + Math.abs(t.c) * t.hz;
    return [Math.floor((t.x - ex) / 16), Math.floor((t.z - ez) / 16), Math.floor((t.x + ex) / 16), Math.floor((t.z + ez) / 16)];
  }
  add(t: Rect): void {
    const [a, b, c, d] = this.span(t);
    for (let q = a; q <= c; q++) for (let r = b; r <= d; r++) {
      const k = this.key(q, r);
      const list = this.cells.get(k);
      if (list) list.push(t);
      else this.cells.set(k, [t]);
    }
  }
  free(t: Rect): boolean {
    const [a, b, c, d] = this.span(t);
    for (let q = a; q <= c; q++) for (let r = b; r <= d; r++) for (const o of this.cells.get(this.key(q, r)) ?? []) if (overlap(t, o)) return false;
    return true;
  }
}

function roadRect(r: Road, margin: number): Rect {
  const dx = r.x1 - r.x0;
  const dz = r.z1 - r.z0;
  const len = Math.hypot(dx, dz);
  // A road along +z when rot = 0; turned to its direction.
  const rot = Math.atan2(dx, dz);
  return rectOf((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, r.w + margin * 2, len + margin * 2, rot);
}

function riverRects(rv: River, margin: number): Rect[] {
  const out: Rect[] = [];
  for (let i = 0; i + 1 < rv.pts.length; i++) {
    const [ax, az] = rv.pts[i];
    const [bx, bz] = rv.pts[i + 1];
    out.push(rectOf((ax + bx) / 2, (az + bz) / 2, rv.w + margin * 2, Math.hypot(bx - ax, bz - az) + 2, Math.atan2(bx - ax, bz - az)));
  }
  return out;
}

// ── The generator ─────────────────────────────────────────────────────────────

export function buildNaijaWorld(seed = 1957): OpenLayout {
  const rng = new Rng(seed);
  const taken = new Taken();
  const placements: Placement[] = [];
  const nextV = () => (rng.next() * 4294967296) >>> 0;

  for (const r of ROADS) taken.add(roadRect(r, r.gutters ? 1.6 : 0.6));
  for (const q of riverRects(RIVER, 1.5)) taken.add(q);

  const place = (prefab: PrefabId, x: number, z: number, rot: number, v = nextV(), force = false): boolean => {
    const [w, d] = footprint(prefab, v);
    const t = rectOf(x, z, w + 0.6, d + 0.6, rot);
    if (Math.abs(x) + 0 > HALF - 4 || Math.abs(z) > HALF - 4) return false;
    if (!force && !taken.free(t)) return false;
    taken.add(t);
    placements.push({ prefab, x, z, rot, v });
    return true;
  };

  // The landmarks and places first: everything else fits round them.
  for (const f of FIXED) place(f.prefab, f.x, f.z, f.rot, nextV(), true);

  // ── Streets: buildings along both sides of every town road, facing it ──
  for (const r of ROADS) {
    if (r.kind !== "asphalt") continue;
    const dx = r.x1 - r.x0;
    const dz = r.z1 - r.z0;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    for (const side of [1, -1] as const) {
      // The side's outward normal (perpendicular to the road).
      const nx = uz * side;
      const nz = -ux * side;
      // The building's front faces back across to the road: local +z = −normal.
      const rot = Math.atan2(-nx, -nz);
      let s = 6;
      while (s < len - 6) {
        const px = r.x0 + ux * s;
        const pz = r.z0 + uz * s;
        const kind = districtOf(px + nx * 12, pz + nz * 12);
        const pick = rng.next();
        const prefab: PrefabId =
          kind === "commercial" ? (pick < 0.5 ? "shops" : pick < 0.82 ? "storey" : "office")
          : kind === "residential" ? (pick < 0.5 ? "house" : pick < 0.78 ? "storey" : pick < 0.92 ? "compound" : "shops")
          : kind === "belt" ? (pick < 0.5 ? "house" : pick < 0.75 ? "uncompleted" : "kiosk")
          : "mudhouse";
        const v = nextV();
        const [w, d] = footprint(prefab, v);
        const set = r.w / 2 + (r.gutters ? GUTTER.w + GUTTER.wall * 2 + 1.4 : 1.2) + d / 2;
        const cx = px + ux * (w / 2) + nx * set;
        const cz = pz + uz * (w / 2) + nz * set;
        if (place(prefab, cx, cz, rot, v)) {
          s += w + 1.2 + rng.range(0, 2.5);
          // Now and then a second row behind, down the plot (a compound or a house).
          if (kind === "residential" && rng.chance(0.35)) {
            const v2 = nextV();
            const pre: PrefabId = rng.chance(0.5) ? "house" : "storey";
            const [, d2] = footprint(pre, v2);
            place(pre, cx + nx * (d / 2 + d2 / 2 + 3), cz + nz * (d / 2 + d2 / 2 + 3), rot, v2);
          }
        } else {
          s += 3;
        }
      }
      // Electric poles every 28 m on this side's pavement, and the odd kiosk or generator.
      for (let p = 10; p < len - 6; p += 28) {
        // Between the gutter and the house fronts, clear of both (not entered as taken).
        const off = r.w / 2 + (r.gutters ? GUTTER.w + GUTTER.wall * 2 + 0.63 : 0.9);
        const px = r.x0 + ux * p + nx * off;
        const pz = r.z0 + uz * p + nz * off;
        if (nearRoadOnly(px, pz, r)) place("pole", px, pz, rot, nextV(), true);
      }
    }
  }

  // ── The village: houses in family clusters, huts round them, palms ──
  const clusters: [number, number][] = [[-120, -60], [-170, -70], [-180, -10], [-150, 85], [-95, 105], [-180, 160], [-115, -170], [-95, -110], [-150, 40]];
  for (const [ox, oz] of clusters) {
    const n = 4 + Math.floor(rng.next() * 4);
    for (let i = 0; i < n * 3 && n > 0; i++) {
      const a = rng.range(0, Math.PI * 2);
      const dist = rng.range(6, 22);
      const pre: PrefabId = rng.chance(0.45) ? "hut" : "mudhouse";
      // Facing the cluster's middle (the family's yard).
      const x = ox + Math.cos(a) * dist;
      const z = oz + Math.sin(a) * dist;
      place(pre, x, z, Math.atan2(ox - x, oz - z));
    }
    for (let i = 0; i < 5; i++) place("palm", ox + rng.range(-26, 26), oz + rng.range(-26, 26), rng.range(0, 6.28));
  }

  // ── Greenery everywhere: shade trees in town, palms and bush in the village ──
  for (let i = 0; i < 520; i++) {
    const x = rng.range(-HALF + 6, HALF - 6);
    const z = rng.range(-HALF + 6, HALF - 6);
    const k = districtOf(x, z);
    const pre: PrefabId = k === "village" ? (rng.chance(0.5) ? "palm" : rng.chance(0.5) ? "bush" : "tree") : k === "belt" ? (rng.chance(0.6) ? "bush" : "tree") : rng.chance(0.55) ? "tree" : rng.chance(0.5) ? "palm" : "bush";
    place(pre, x, z, rng.range(0, 6.28));
  }
  // Wrecks and generators: the city's furniture.
  for (let i = 0, n = 0; i < 400 && n < 26; i++) {
    const x = rng.range(-80, 195);
    const z = rng.range(-195, 195);
    if (place(rng.chance(0.4) ? "wreck" : rng.chance(0.5) ? "generator" : "kiosk", x, z, rng.range(0, 6.28))) n++;
  }

  // v5: no gutters (the owner: "why does my character sink": they were pits along the roads). The roads keep
  // their `gutters` flag only so buildings stay set back where they stood.
  const gutters: Gutter[] = [];
  const slabs: Slab[] = [];

  // ── Everything solid ──
  const solids: Solid[] = [];
  for (const p of placements) solidsOf(p, solids);
  for (const g of gutters) {
    const c = Math.cos(g.rot);
    const s = Math.sin(g.rot);
    const at = (lx: number): [number, number] => [g.x + lx * c, g.z - lx * s];
    solids.push({ x: g.x, z: g.z, hx: GUTTER.w / 2, hz: g.len / 2, rot: g.rot, y0: -GUTTER.depth, y1: -GUTTER.depth, kind: "pit", surface: "concrete", water: -GUTTER.depth + 0.12 });
    for (const side of [-1, 1]) {
      const [x, z] = at(side * (GUTTER.w / 2 + GUTTER.wall / 2));
      solids.push({ x, z, hx: GUTTER.wall / 2, hz: g.len / 2, rot: g.rot, y0: -GUTTER.depth, y1: 0, kind: "box", surface: "concrete" });
    }
  }
  for (const sl of slabs) solids.push({ x: sl.x, z: sl.z, hx: GUTTER.w / 2 + GUTTER.wall + 0.05, hz: 0.9, rot: sl.rot, y0: -0.25, y1: 0.02, kind: "box", surface: "concrete" });
  // The expressway's median: a kerb you step over.
  for (const r of ROADS) {
    if (!r.median) continue;
    const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
    solids.push({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, hx: r.median / 2, hz: len / 2, rot: Math.atan2(r.x1 - r.x0, r.z1 - r.z0), y0: 0, y1: 0.3, kind: "box", surface: "concrete" });
  }
  // The river: a bed below the banks, and the banks' walls (a jump gets you out).
  for (let i = 0; i + 1 < RIVER.pts.length; i++) {
    const [ax, az] = RIVER.pts[i];
    const [bx, bz] = RIVER.pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const rot = Math.atan2(bx - ax, bz - az);
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    solids.push({ x: mx, z: mz, hx: RIVER.w / 2, hz: len / 2 + 1, rot, y0: -RIVER.depth, y1: -RIVER.depth, kind: "pit", surface: "sand", water: -RIVER.depth + RIVER.water });
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (const side of [-1, 1]) {
      const lx = side * (RIVER.w / 2 + 0.2);
      solids.push({ x: mx + lx * c, z: mz - lx * s, hx: 0.2, hz: len / 2 + 1, rot, y0: -RIVER.depth, y1: 0, kind: "box", surface: "sand" });
    }
  }

  // The city's edge: a block wall all round (the roads end at it).
  for (const [x, z, hx, hz] of [[0, -HALF + EDGE.t / 2, HALF, EDGE.t / 2], [0, HALF - EDGE.t / 2, HALF, EDGE.t / 2], [-HALF + EDGE.t / 2, 0, EDGE.t / 2, HALF], [HALF - EDGE.t / 2, 0, EDGE.t / 2, HALF]]) {
    solids.push({ x, z, hx, hz, rot: 0, y0: 0, y1: EDGE.h, kind: "box", surface: "concrete" });
  }

  // ── Where players start: open ground, spread over the city ──
  const spawns: [number, number][] = [];
  const probe = rectOf(0, 0, 2.5, 2.5, 0);
  for (let i = 0; i < 400 && spawns.length < 24; i++) {
    const x = rng.range(-150, 190);
    const z = rng.range(-185, 185);
    probe.x = x;
    probe.z = z;
    if (!taken.free(probe)) continue;
    if (spawns.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 40)) continue;
    spawns.push([x, z]);
  }

  // ── Props (v4 rework R9): the CC0 street furniture in town (bins, crates, benches, planters,
  // air units, cabinets, bags, a covered car), each with room round it so no way is shut; after the starts, so
  // they don't move; before the boards, whose solids stay on the end ──
  const cityProps = PROPS.flatMap((q, i) => (propPlaced(q) && q.at.includes("city") ? [i] : []));
  for (let i = 0, n = 0; cityProps.length && i < 2400 && n < 240; i++) {
    const x = rng.range(-HALF + 8, HALF - 8);
    const z = rng.range(-HALF + 8, HALF - 8);
    const idx = cityProps[Math.floor(rng.next() * cityProps.length)];
    const rot = rng.range(0, 6.28);
    const v = ((nextV() << 8) | idx) >>> 0;
    if (districtOf(x, z) === "village") continue;
    const q = PROPS[idx];
    // Free with 2.5 m all round (so it never closes a gap between buildings); takes only its own.
    if (!taken.free(rectOf(x, z, q.w + 5, q.d + 5, rot))) continue;
    if (spawns.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 3 + Math.max(q.w, q.d))) continue;
    if (place("prop", x, z, rot, v)) {
      solidsOf(placements[placements.length - 1], solids);
      n++;
    }
  }

  // ── The billboards: last, on ground nothing else wanted (their solids go on the end) ──
  const boards = placeBoards("nw", BOARD_WISHES, 0, HALF, taken, placements, solids, spawns);

  return {
    id: "naija-world",
    half: HALF,
    roads: ROADS,
    rivers: [RIVER],
    landmarks: NAIJA_LANDMARKS,
    areas: NAIJA_AREAS,
    placements,
    gutters,
    slabs,
    solids,
    spawns,
    boards,
    groundAt: (x, z) => groundOf(x, z),
  };
}

/** True when (x, z) is clear of every road but `own` (a pole doesn't stand in a crossing road). */
function nearRoadOnly(x: number, z: number, own: Road): boolean {
  for (const r of ROADS) {
    if (r === own) continue;
    const dx = r.x1 - r.x0;
    const dz = r.z1 - r.z0;
    const t = Math.max(0, Math.min(1, ((x - r.x0) * dx + (z - r.z0) * dz) / (dx * dx + dz * dz)));
    if (Math.hypot(r.x0 + dx * t - x, r.z0 + dz * t - z) < r.w / 2 + 2.5) return false;
  }
  return true;
}

/** The ground underfoot where nothing stands. */
function groundOf(x: number, z: number): GroundKind {
  for (const r of ROADS) {
    const dx = r.x1 - r.x0;
    const dz = r.z1 - r.z0;
    const len2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - r.x0) * dx + (z - r.z0) * dz) / len2));
    const px = r.x0 + dx * t - x;
    const pz = r.z0 + dz * t - z;
    if (px * px + pz * pz <= (r.w / 2) * (r.w / 2)) return r.kind;
  }
  const k = districtOf(x, z);
  if (Math.abs(x - 92) < 22 && Math.abs(z - 110) < 28) return "asphalt"; // the bus park's lot
  if (Math.abs(x - 30) < 24 && Math.abs(z + 40) < 32) return "paving"; // the market's floor
  if (k === "commercial") return "paving";
  if (k === "village" || k === "belt") return (Math.floor(x / 9) + Math.floor(z / 9)) % 3 === 0 ? "grass" : "earth";
  return (Math.floor(x / 13) + Math.floor(z / 11)) % 4 === 0 ? "grass" : "earth";
}
