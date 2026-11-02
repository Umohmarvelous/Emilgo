// Spooky World (SPEC-V3 §3.1; Phase 7): Dead Streets' city, 320 × 320 m, at
// night. Denser rather than larger: a winding route of about 1.45 km from the
// Motor Park of the Lost to the Broadcast Mast, through twelve districts, with
// the thirty obstacles of §3.2 on the way. Decayed buildings line every
// street; between the streets the blocks are solid, so the route is a maze of
// corridors with the odd shortcut.
//
// Like Naija World it is pure and shared: the server (which checks a run) and
// the phone build the same city from the same seed. North is −z.
//
// An obstacle is drawn and solid like the rest of the city; what it DOES (a
// spark on a rhythm, a door that breaks after three blows, a gate the
// generator opens) is the survival module's, from `run.hazards` and
// `run.gates`. Each one also carries a hint (`how`) for the test that walks
// the whole route.

import { Rng } from "../../core/rng";
import type { Solid } from "../../game/core/space";
import { EDGE, rectOf, Taken, type GroundKind, type Landmark, type OpenLayout, type Road } from "./naija";
import { placeBoards, type BoardWish } from "./billboards";
import { SPOOKY_ROUTE } from "./route";
import { footprint, solidsOf, type Placement, type PrefabId } from "./prefabs";

const HALF = 160;
const ROAD_W = 8;

/** The route, corner by corner (each leg is a street): route.ts. */
export { SPOOKY_ROUTE };

/** The twelve districts (SPEC-V3 §3.1), all fictional names. */
export const SPOOKY_LANDMARKS: Landmark[] = [
  { id: "motorpark", name: "Motor Park of the Lost", x: -130, z: -135 },
  { id: "cathedral", name: "Cathedral of the Silent Bell", x: -92, z: -118 },
  { id: "nightmarket", name: "Night Market", x: -35, z: -122 },
  { id: "oldmosque", name: "Old Mosque Courtyard", x: 30, z: -122 },
  { id: "faceme", name: "Face-me-I-face-you", x: 105, z: -118 },
  { id: "gutters", name: "The Gutters", x: 105, z: -45 },
  { id: "estate", name: "Uncompleted Estate", x: 105, z: 8 },
  { id: "tankfarm", name: "Tank Farm", x: 30, z: 18 },
  { id: "hospital", name: "St. Ruth's Hospital Wing", x: -30, z: 5 },
  { id: "farmedge", name: "Farm Edge", x: -100, z: 75 },
  { id: "railway", name: "Railway Cutting", x: -85, z: 128 },
  { id: "mast", name: "The Broadcast Mast", x: 132, z: 128 },
];

export type HazardKind = "spark" | "flare" | "swing" | "collapse" | "pool" | "dark" | "nogun";

/** Something an obstacle does (the survival module runs it): within r of x, z, on for `on` s of every `period` s. */
export interface Hazard {
  id: number;
  kind: HazardKind;
  x: number;
  z: number;
  r: number;
  period: number;
  on: number;
  phase: number;
  /** Health taken (0–100) and the stun, each time it catches you. */
  dmg: number;
  stun: number;
}

export type GateKind = "barricade" | "hedge" | "key" | "generator" | "floor";

/** A solid that goes away: broken (3 blows), a key used, the generator's gate, a floor that gives way. */
export interface Gate {
  id: number;
  kind: GateKind;
  /** Index into the layout's solids, and its bottom and top while shut. */
  solid: number;
  shut: [number, number];
  x: number;
  z: number;
  /** Where its key or the generator's fuel lies, and the switch. */
  key?: [number, number];
  fuel?: [number, number];
  sw?: [number, number];
}

export type ObstacleHow = "walk" | "prone" | "crouch" | "jump" | "hit" | "key" | "generator" | "wade" | "climb";

export interface Obstacle {
  /** 1–30, §3.2's numbers. */
  n: number;
  name: string;
  x: number;
  z: number;
  /** Metres along the route. */
  d: number;
  how: ObstacleHow;
  /** For the route test: where to jump (route metres), the way through a maze (world points). */
  jumpAt?: number;
  path?: [number, number][];
  /** ✦ deliberately confusing. */
  tricky?: boolean;
}

export interface SpookyRun {
  route: [number, number][];
  /** Cumulative metres at each corner. */
  at: number[];
  length: number;
  start: [number, number];
  finish: [number, number];
  /** Churches and mosques: zombies never come in; quiet and slow healing. */
  sanctuaries: { x: number; z: number; r: number }[];
  obstacles: Obstacle[];
  hazards: Hazard[];
  gates: Gate[];
}

/** Where on the route `d` metres in is, and which way it runs. */
export function routeAt(run: Pick<SpookyRun, "route" | "at">, d: number): { x: number; z: number; ux: number; uz: number; leg: number } {
  const { route, at } = run;
  let i = 0;
  while (i < route.length - 2 && at[i + 1] < d) i++;
  const [ax, az] = route[i];
  const [bx, bz] = route[i + 1];
  const len = at[i + 1] - at[i];
  const t = Math.max(0, Math.min(1, (d - at[i]) / len));
  return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, ux: (bx - ax) / len, uz: (bz - az) / len, leg: i };
}

/** How far along the route the nearest point to (x, z) is, and how far off it. */
export function routeProgress(run: Pick<SpookyRun, "route" | "at">, x: number, z: number): { d: number; off: number } {
  let best = { d: 0, off: Infinity };
  for (let i = 0; i + 1 < run.route.length; i++) {
    const [ax, az] = run.route[i];
    const [bx, bz] = run.route[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    const off = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (off < best.off) best = { d: run.at[i] + t * Math.sqrt(len2), off };
  }
  return best;
}

export function buildSpookyWorld(seed = 4013): OpenLayout & { run: SpookyRun } {
  const rng = new Rng(seed);
  const taken = new Taken();
  const placements: Placement[] = [];
  const solids: Solid[] = [];
  const nextV = () => (rng.next() * 4294967296) >>> 0;

  const at: number[] = [0];
  for (let i = 1; i < SPOOKY_ROUTE.length; i++) at.push(at[i - 1] + Math.hypot(SPOOKY_ROUTE[i][0] - SPOOKY_ROUTE[i - 1][0], SPOOKY_ROUTE[i][1] - SPOOKY_ROUTE[i - 1][1]));
  const run: SpookyRun = {
    route: SPOOKY_ROUTE.map(([x, z]) => [x, z]),
    at,
    length: at[at.length - 1],
    start: [SPOOKY_ROUTE[0][0], SPOOKY_ROUTE[0][1] + 6],
    finish: [SPOOKY_ROUTE[SPOOKY_ROUTE.length - 1][0], SPOOKY_ROUTE[SPOOKY_ROUTE.length - 1][1]],
    sanctuaries: [],
    obstacles: [],
    hazards: [],
    gates: [],
  };
  // Streets: every leg of the route, a little longer so the corners join.
  const roads: Road[] = [];
  for (let i = 0; i + 1 < SPOOKY_ROUTE.length; i++) {
    const [ax, az] = SPOOKY_ROUTE[i];
    const [bx, bz] = SPOOKY_ROUTE[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const e = ROAD_W / 2;
    roads.push({ x0: ax - ux * e, z0: az - uz * e, x1: bx + ux * e, z1: bz + uz * e, w: ROAD_W, kind: i % 3 === 2 ? "laterite" : "asphalt", gutters: false });
  }
  for (const r of roads) {
    const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
    taken.add(rectOf((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, r.w + 1.2, len + 1.2, Math.atan2(r.x1 - r.x0, r.z1 - r.z0)));
  }

  const place = (prefab: PrefabId, x: number, z: number, rot: number, v = nextV(), force = false): boolean => {
    const [w, d] = footprint(prefab, v);
    const t = rectOf(x, z, w + 0.6, d + 0.6, rot);
    if (Math.abs(x) > HALF - 5 || Math.abs(z) > HALF - 5) return false;
    if (!force && !taken.free(t)) return false;
    taken.add(t);
    placements.push({ prefab, x, z, rot, v });
    return true;
  };

  // ── The districts' own buildings, off the street ──
  // Kept off the streets (never forced over a road): a district's own buildings fit its block.
  const FIXED: [PrefabId, number, number, number][] = [
    ["busstop", -138, -122, Math.PI / 2],
    ["danfo", -141, -110, 0.3],
    ["danfo", -144, -128, -0.2],
    ["church", -92, -118, Math.PI],
    ["suya", -40, -122, 0],
    ["kiosk", -30, -126, 0],
    ["kiosk", -24, -118, 0.4],
    ["mosque", 30, -122, 0],
    ["courtyard", 100, -110, Math.PI],
    ["uncompleted", 108, 8, -Math.PI / 2],
    ["watertower", 30, 20, 0],
    ["office", -30, 6, 0],
    ["farm", -100, 72, 0],
    ["carriage", -85, 126, Math.PI / 2],
    ["mast", 140, 128, 0],
    ["mosque", -100, 12, Math.PI / 2],
  ];
  const fixedOk = FIXED.map(([p, x, z, rot]) => place(p, x, z, rot, nextV()));
  // The churches and mosques that stand are the sanctuaries.
  FIXED.forEach(([p, x, z], i) => {
    if (fixedOk[i] && (p === "church" || p === "mosque")) run.sanctuaries.push({ x, z, r: p === "church" ? 11 : 12 });
  });

  // ── Streets lined with decay: both sides of every leg ──
  for (const r of roads) {
    const dx = r.x1 - r.x0;
    const dz = r.z1 - r.z0;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    for (const side of [1, -1] as const) {
      const nx = uz * side;
      const nz = -ux * side;
      const rot = Math.atan2(-nx, -nz);
      let s = 3;
      while (s < len - 3) {
        const pick = rng.next();
        const prefab: PrefabId = pick < 0.3 ? "storey" : pick < 0.55 ? "uncompleted" : pick < 0.75 ? "house" : pick < 0.88 ? "shops" : "compound";
        const v = nextV();
        const [w, d] = footprint(prefab, v);
        const set = r.w / 2 + 1.1 + d / 2;
        const cx = r.x0 + ux * (s + w / 2) + nx * set;
        const cz = r.z0 + uz * (s + w / 2) + nz * set;
        if (place(prefab, cx, cz, rot, v)) s += w + 0.4 + rng.range(0, 1.2);
        else s += 2;
      }
    }
  }
  // The blocks between: filled, so the streets are the way (with gaps you can find).
  for (let i = 0; i < 900; i++) {
    const x = rng.range(-HALF + 8, HALF - 8);
    const z = rng.range(-HALF + 8, HALF - 8);
    const pick = rng.next();
    place(pick < 0.35 ? "house" : pick < 0.55 ? "uncompleted" : pick < 0.7 ? "wall" : pick < 0.85 ? "tree" : pick < 0.93 ? "wreck" : "kiosk", x, z, rng.range(0, 6.28));
  }
  // Wrecks and dead poles on the streets' edges.
  for (const r of roads) {
    const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
    const ux = (r.x1 - r.x0) / len;
    const uz = (r.z1 - r.z0) / len;
    for (let s = 12; s < len - 8; s += 26) {
      const side = rng.chance(0.5) ? 1 : -1;
      place("pole", r.x0 + ux * s + uz * side * (r.w / 2 + 0.6), r.z0 + uz * s - ux * side * (r.w / 2 + 0.6), Math.atan2(ux, uz), nextV(), true);
    }
  }
  for (const p of placements) solidsOf(p, solids);

  // ── The thirty obstacles (§3.2), spaced along the route ──
  const o = obstacles(run, solids, rng);
  run.obstacles = o.obstacles;
  run.hazards = o.hazards;
  run.gates = o.gates;

  // The city's edge.
  for (const [x, z, hx, hz] of [[0, -HALF + EDGE.t / 2, HALF, EDGE.t / 2], [0, HALF - EDGE.t / 2, HALF, EDGE.t / 2], [-HALF + EDGE.t / 2, 0, EDGE.t / 2, HALF], [HALF - EDGE.t / 2, 0, EDGE.t / 2, HALF]]) {
    solids.push({ x, z, hx, hz, rot: 0, y0: 0, y1: EDGE.h, kind: "box", surface: "concrete" });
  }

  // ── The billboards (SPEC-V3 §8): old boards by the route, facing the runner coming; ──
  // last, so nothing else moves. None by a church or a mosque.
  const wishes: BoardWish[] = [];
  for (let d = 80, i = 0; d < run.length - 60; d += 120, i++) {
    const p = routeAt(run, d);
    const side = i % 2 ? 1 : -1;
    const off = ROAD_W / 2 + 4.5;
    const x = p.x + p.uz * side * off;
    const z = p.z - p.ux * side * off;
    if (run.sanctuaries.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + 25)) continue;
    wishes.push({ x, z, fx: p.x - p.ux * 25, fz: p.z - p.uz * 25, kind: "route", premium: i === 0, r: 20 });
  }
  // The last stretch, in sight of the Mast.
  const [mx, mz] = run.finish;
  wishes.push({ x: mx - 40, z: mz - 12, fx: mx - 90, fz: mz, kind: "landmark", premium: true, r: 12 });
  const boards = placeBoards("sw", wishes, 1, HALF, taken, placements, solids, [run.start, run.finish]);

  return {
    id: "spooky-world",
    half: HALF,
    roads,
    rivers: [],
    landmarks: SPOOKY_LANDMARKS,
    areas: [],
    placements,
    gutters: [],
    slabs: [],
    solids,
    spawns: [run.start],
    boards,
    groundAt: (x, z) => groundOf(roads, x, z),
    run,
  };
}

function groundOf(roads: Road[], x: number, z: number): GroundKind {
  for (const r of roads) {
    const dx = r.x1 - r.x0;
    const dz = r.z1 - r.z0;
    const len2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - r.x0) * dx + (z - r.z0) * dz) / len2));
    if ((r.x0 + dx * t - x) ** 2 + (r.z0 + dz * t - z) ** 2 <= (r.w / 2) ** 2) return r.kind;
  }
  return (Math.floor(x / 11) + Math.floor(z / 9)) % 3 === 0 ? "grass" : "earth";
}

// ── The obstacles ────────────────────────────────────────────────────────────

const NAMES = [
  "", "Tree climb", "Rooftop gap", "Collapsed overpass", "Zombie pool", "Looping tunnels", "Live power line", "Burning oil tank", "Collapsing building",
  "Barricaded door", "Danfo-wreck pile", "Market-stall maze", "Rope bridge", "Flooded drain", "Water-tank ladder", "Generator gate", "Bell tower",
  "Barbed wire", "Container maze", "Okada ramp", "Swinging zinc", "Floor collapse", "Gateman's gate", "Pitch-black room", "Thorn hedge",
  "Flooded underpass", "Narrow ledge", "Train carriage", "Scaffold climb", "Fake shortcut", "Mirrored alleys",
];

/** The order they come in along the route (§3.2's numbers), the easy ones first. */
const ORDER = [9, 3, 6, 10, 17, 1, 11, 20, 4, 13, 2, 7, 22, 12, 5, 19, 23, 14, 8, 24, 18, 15, 26, 21, 27, 25, 28, 29, 30, 16];

function obstacles(run: SpookyRun, solids: Solid[], rng: Rng): { obstacles: Obstacle[]; hazards: Hazard[]; gates: Gate[] } {
  const out: Obstacle[] = [];
  const hazards: Hazard[] = [];
  const gates: Gate[] = [];
  const W = ROAD_W;
  const first = 34;
  const gap = (run.length - first - 40) / (ORDER.length - 1);
  ORDER.forEach((n, k) => {
    // Never on a corner: slide along to the middle part of a leg.
    let d = first + k * gap;
    const leg = routeAt(run, d).leg;
    d = Math.max(run.at[leg] + 12, Math.min(run.at[leg + 1] - 12, d));
    const c = routeAt(run, d);
    const { ux, uz } = c;
    const nx = uz;
    const nz = -ux;
    const rot = Math.atan2(ux, uz);
    /** World point at u metres along, v across (to the right). */
    const pt = (u: number, v: number): [number, number] => [c.x + ux * u + nx * v, c.z + uz * u + nz * v];
    /** A solid in the street's frame: centred at (u, v), `len` along, `wid` across. */
    const box = (u: number, v: number, len: number, wid: number, y0: number, y1: number, surface: Solid["surface"] = "concrete"): number => {
      const [x, z] = pt(u, v);
      solids.push({ x, z, hx: wid / 2, hz: len / 2, rot, y0, y1, kind: "box", surface });
      return solids.length - 1;
    };
    /** A slope along the street from `from` (behind) to `to` (ahead): stairs, a ladder, a heap. */
    const ramp = (u: number, v: number, len: number, wid: number, from: number, to: number, surface: Solid["surface"] = "wood"): void => {
      const [x, z] = pt(u, v);
      solids.push({ x, z, hx: wid / 2, hz: len / 2, rot, y0: Math.min(0, from, to), y1: from, y2: to, kind: "ramp", surface });
    };
    const pit = (u: number, v: number, len: number, wid: number, floor: number, water?: number): void => {
      const [x, z] = pt(u, v);
      solids.push({ x, z, hx: wid / 2, hz: len / 2, rot, y0: floor, y1: floor, kind: "pit", surface: "sand", ...(water !== undefined ? { water } : {}) });
    };
    /** Walls down both edges of the street for `len` metres, so the obstacle is the way. */
    const sides = (len: number, h = 3.2): void => {
      box(0, -W / 2 - 0.25, len, 0.5, 0, h);
      box(0, W / 2 + 0.25, len, 0.5, 0, h);
    };
    const hazard = (kind: HazardKind, u: number, v: number, r: number, period: number, on: number, dmg: number, stun: number): void => {
      const [x, z] = pt(u, v);
      hazards.push({ id: hazards.length, kind, x, z, r, period, on, phase: rng.range(0, period), dmg, stun });
    };
    const gate = (kind: GateKind, solid: number, extra: Partial<Gate> = {}): void => {
      const [x, z] = [solids[solid].x, solids[solid].z];
      gates.push({ id: gates.length, kind, solid, shut: [solids[solid].y0, solids[solid].y1], x, z, ...extra });
    };
    const ob: Obstacle = { n, name: NAMES[n], x: c.x, z: c.z, d, how: "walk" };
    switch (n) {
      case 1: // Tree climb: a wall across, a fallen trunk up it, a drop the other side.
        sides(10);
        box(0, 0, 1, W, 0, 2.6);
        ramp(-3.2, 1.6, 5.4, 1.4, 0, 2.6);
        ob.how = "climb";
        ob.path = [pt(-6, 1.6), pt(1, 1.6), pt(4, 0)];
        break;
      case 2: // Rooftop gap: up the stairs, jump the 1.6 m gap, down. Fall in and the ladder brings you back up.
        sides(24, 4.5);
        ramp(-8.5, 0, 5, W, 0, 3);
        box(-3.5, 0, 5.4, W, 0, 3);
        pit(0, 0, 1.6, W, -1.2);
        ramp(0, W / 2 - 0.5, 1.6, 0.8, -1.2, 3, "metal");
        box(3.5, 0, 5.4, W, 0, 3);
        ramp(8.7, 0, 5, W, 3, 0);
        ob.how = "jump";
        ob.jumpAt = d - 1.3;
        break;
      case 3: // Collapsed overpass: a slab down to 0.8 m — prone under it.
        sides(10);
        box(0, 0, 6, W, 0.8, 1.6);
        ob.how = "prone";
        break;
      case 4: // Zombie pool: wade (Lurkers grab here).
        sides(16);
        pit(0, 0, 12, W, -0.42, -0.04);
        hazard("pool", 0, 0, 6.5, 1, 1, 0, 0);
        ob.how = "wade";
        break;
      case 5: // ✦ Looping tunnels: two lanes alike under a roof; the right one is a dead end. A chalk mark tells.
        sides(24, 3.4);
        box(0, 0, 20, 0.5, 0, 3.4);
        box(8, W / 4, 0.4, W / 2 - 0.3, 0, 3.4);
        box(0, 0, 24, W, 3.4, 3.8);
        hazard("dark", 0, 0, 12, 1, 1, 0, 0);
        ob.tricky = true;
        ob.path = [pt(-12, 0), pt(-9.5, -W / 4), pt(9.5, -W / 4), pt(12, 0)];
        break;
      case 6: // Live power line: sparks on a rhythm across the street.
        sides(8);
        hazard("spark", 0, 0, 3.2, 2.4, 0.7, 12, 0.8);
        break;
      case 7: // Burning oil tank: flares on a timer by the street.
        hazard("flare", 0, -W / 2 + 1, 4.2, 5, 1.6, 15, 0.4);
        break;
      case 8: // Collapsing building: roofed; it comes down 6 s after you step in.
        sides(14, 4);
        box(0, 0, 14, W, 3.6, 4);
        hazard("collapse", 0, 0, 7, 6, 2, 30, 1.5);
        break;
      case 9: { // Barricaded door: three blows (or the key from the shed).
        sides(4);
        const s = box(0, 0, 0.6, W, 0, 3);
        gate("barricade", s, { key: pt(-9, W / 2 - 1.5) });
        ob.how = "hit";
        break;
      }
      case 10: // Danfo-wreck pile: up the ramp of crushed metal and over.
        sides(14);
        box(0, 0, 3, W, 0, 2.2, "metal");
        ramp(-4, 0, 5, W, 0, 2.2, "metal");
        ramp(4, 0, 5, W, 2.2, 0, "metal");
        ob.how = "climb";
        break;
      case 11: { // ✦ Market-stall maze.
        sides(20);
        for (const [u, v, l, w] of [[-6, -1.4, 0.6, 5.2], [-2, 1.4, 0.6, 5.2], [2, -1.4, 0.6, 5.2], [6, 1.4, 0.6, 5.2]] as const) box(u, v, l, w, 0, 2.2, "wood");
        ob.tricky = true;
        ob.path = [pt(-9, 0), pt(-7.5, 3), pt(-4, 3), pt(-3.5, -3), pt(0, -3), pt(0.5, 3), pt(4, 3), pt(4.5, -3), pt(8, -3), pt(9.5, 0)];
        break;
      }
      case 12: // Rope bridge over the canal: a narrow deck over deep water.
        sides(14);
        pit(0, 0, 9, W, -3, -0.6);
        box(0, 0, 9.4, 1.2, -3, 0, "wood");
        ramp(2.5, W / 2 - 0.6, 4, 1, -3, 0, "wood");
        ob.path = [pt(-7, 0), pt(7, 0)];
        break;
      case 13: // Flooded drainage run: wade the length of it.
        sides(22);
        pit(0, 0, 20, W, -0.4, -0.04);
        ob.how = "wade";
        break;
      case 14: // Ladder up the water tank's wall, across its top, down the far ladder.
        sides(16, 5);
        box(0, 0, 1, W, 0, 3.4);
        ramp(-3, 0, 5, 1, 0, 3.4, "metal");
        ramp(3, 0, 5, 1, 3.4, 0, "metal");
        ob.how = "climb";
        ob.path = [pt(-8, 0), pt(8, 0)];
        break;
      case 15: { // Generator gate: fuel in the generator, the switch, the gate opens.
        sides(6);
        const s = box(0, 0, 0.4, W, 0, 3.2, "metal");
        gate("generator", s, { fuel: pt(-12, -W / 2 + 1.2), sw: pt(-1.6, W / 2 - 0.8) });
        ob.how = "generator";
        break;
      }
      case 16: // Bell tower: a wall across; the tower's stairs over it.
        sides(14, 6);
        box(0, 0, 2, W, 0, 4.5);
        ramp(-4.5, 0, 7, 2, 0, 4.5, "concrete");
        ramp(4.5, 0, 7, 2, 4.5, 0, "concrete");
        ob.how = "climb";
        ob.path = [pt(-9, 0), pt(9, 0)];
        break;
      case 17: // Barbed wire: low enough that only crawling gets under.
        sides(8);
        box(0, 0, 5, W, 0.62, 1.1, "metal");
        ob.how = "prone";
        break;
      case 18: { // ✦ Shipping-container maze.
        sides(26, 3);
        for (const [u, v, l, w] of [[-9, 1.2, 4.4, 5.6], [-3, -1.2, 4.4, 5.6], [3, 1.2, 4.4, 5.6], [9, -1.2, 4.4, 5.6]] as const) box(u, v, l, w, 0, 2.6, "metal");
        ob.tricky = true;
        ob.path = [pt(-13, -3), pt(-6, -3), pt(-6, 3), pt(0, 3), pt(0, -3), pt(6, -3), pt(6, 3), pt(13, 3)];
        break;
      }
      case 19: // Okada ramp: up, a jump over the 3 m ditch, down. The ditch has a ladder.
        sides(20);
        ramp(-5, 0, 5, W, 0, 1.2, "wood");
        box(-1.5, 0, 2, W, 0, 1.2, "wood");
        pit(1, 0, 3, W, -2.2);
        ramp(1, W / 2 - 0.5, 3, 0.8, -2.2, 1.2, "metal");
        box(5, 0, 5, W, 0, 1.2, "wood");
        ramp(9, 0, 3, W, 1.2, 0, "wood");
        ob.how = "jump";
        ob.jumpAt = d - 0.9;
        break;
      case 20: // Swinging zinc: three sheets on a beat; time it.
        sides(14);
        for (const u of [-4, 0, 4]) hazard("swing", u, 0, 2.2, 2.4, 0.9, 8, 1);
        break;
      case 21: { // Floor collapse: it gives way; you walk out of the basement up its ramp.
        sides(24, 3.5);
        pit(2, 0, 18, W, -3);
        const s21 = box(-2, 0, 10, W, -0.3, 0, "wood");
        gate("floor", s21);
        ramp(7, 0, 8, W, -3, 0, "concrete");
        break;
      }
      case 22: { // Gateman's locked gate: the keys are in his post.
        sides(6);
        const s = box(0, 0, 0.4, W, 0, 3, "metal");
        gate("key", s, { key: pt(-6, -W / 2 + 1.2) });
        ob.how = "key";
        break;
      }
      case 23: // Pitch-black room: roofed, torch only.
        sides(16, 3.4);
        box(0, 0, 16, W, 3.2, 3.5);
        hazard("dark", 0, 0, 8, 1, 1, 0, 0);
        break;
      case 24: { // Thorn hedge: cut through (three blows).
        sides(4);
        const s = box(0, 0, 1.2, W, 0, 2.4, "grass");
        gate("hedge", s);
        ob.how = "hit";
        break;
      }
      case 25: // Chest-deep flooded underpass: no weapons in the water.
        sides(18, 3.5);
        pit(0, 0, 14, W, -1.3, -0.15);
        ramp(-5.5, 0, 3, W, 0, -1.3, "concrete");
        ramp(5.5, 0, 3, W, -1.3, 0, "concrete");
        box(0, 0, 14, W, 2.4, 3);
        hazard("nogun", 0, 0, 8, 1, 1, 0, 0);
        ob.how = "wade";
        break;
      case 26: // Narrow ledge: the street falls away; a 0.7 m ledge along the wall.
        sides(16);
        pit(0, 0.35, 14, W - 0.7, -3, -2.6);
        ramp(5, W / 2 - 0.6, 4, 1, -3, 0, "concrete");
        ob.path = [pt(-8, -W / 2 + 0.35), pt(8, -W / 2 + 0.35)];
        break;
      case 27: // Train carriage: through it, end to end.
        sides(18, 3.6);
        box(0, -1.9, 16, 0.3, 0, 3);
        box(0, 1.9, 16, 0.3, 0, 3);
        box(0, 0, 16, 4.1, 2.8, 3.1, "metal");
        box(0, -W / 4 - 1, 16.4, W / 2 - 2, 0, 3.6);
        box(0, W / 4 + 1, 16.4, W / 2 - 2, 0, 3.6);
        ob.path = [pt(-9, 0), pt(9, 0)];
        break;
      case 28: // Scaffold climb: up the boards, along the first floor, down.
        sides(16, 5);
        box(0, 0, 4, W, 0, 2.8, "wood");
        ramp(-4.5, 0, 5, W, 0, 2.8, "wood");
        ramp(4.5, 0, 5, W, 2.8, 0, "wood");
        ob.how = "climb";
        break;
      case 29: { // ✦ Fake shortcut: an inviting alley off the street that ends in a wall.
        const [ax, az] = pt(0, -W / 2 - 6);
        solids.push({ x: ax, z: az, hx: 0.3, hz: 8, rot: rot + Math.PI / 2, y0: 0, y1: 3, kind: "box", surface: "concrete" });
        ob.tricky = true;
        break;
      }
      case 30: // ✦ Mirrored alleys: the same alley twice; the left is a dead end. The landmark ahead tells.
        sides(22);
        box(0, 0, 20, 0.6, 0, 3);
        box(7, -W / 4, 0.5, W / 2 - 0.3, 0, 3);
        ob.tricky = true;
        ob.path = [pt(-11, 0), pt(-9.5, W / 4), pt(9.5, W / 4), pt(11, 0)];
        break;
    }
    out.push(ob);
  });
  return { obstacles: out, hazards, gates };
}
