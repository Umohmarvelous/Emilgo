// Naija Max (v4 Phase 7): the big world, 2 × 2 km (25 × Naija World). The
// owner's answer: bigger, with more players. Naija World's city, exactly as
// it is, in the middle (its wall opened: the roads run on), and eight places
// round it, each its own ground, light on the eye and cover for a gunfight:
//
//   north        Ironwood Forest     pines, rocks, cabins, a ranger tower
//   north-east   Windmere Ridge      a wind farm in the grass (the blades turn)
//   east         Harbour Yard        container stacks, cranes, warehouses, the water
//   south-east   Black Refinery      tanks, pipe runs, flare stacks burning
//   south        Dune Sea            sand ridges to run over, rocks, a plane down
//   south-west   Old Airfield        the runway, hangars, the control tower, wrecks
//   west         Mangrove Sink       a swamp channel, mangroves, shacks on stilts
//   north-west   Neon Row and        clubs in neon, glass towers, and the Arena's
//                the Arena           stands round a pitch
//
// v5, two more: Glass District (just north-east of the city: towers, a plaza,
// two streets) and Frostline (east, between the harbour and the refinery: snow,
// spruce, a radar post).
//
// Savanna between them, laterite roads out from the city to each. Pure and
// seeded like the city: the server and every phone build the same world.

import { Rng } from "../../core/rng";
import type { Solid } from "../../game/core/space";
import { placeBoards, type BoardWish } from "./billboards";
import { buildNaijaWorld, EDGE, inPond, type Area, type GroundKind, type Landmark, type OpenLayout, type Pond, type River, type Road } from "./naija";
import { footprint, propPlaced, solidsOf, type Placement, type PrefabId } from "./prefabs";
import { inPatch } from "./patches";
import { PROPS } from "./propTable";

const CITY = 200;
/**
 * v6 max (3.3): the places drawn in toward the city (they stood 500 m of savanna out). Everything past the city's
 * edge comes in to PULL of its distance from it, per axis (so straight roads stay straight); the world's edge with
 * it (2 × 2 km → 1.6 × 1.6 km), each place's circle to PLACE_R of what it was.
 */
const PULL = 0.75;
const PLACE_R = 0.82;
const pin = (v: number): number => (Math.abs(v) <= CITY ? v : Math.sign(v) * (CITY + (Math.abs(v) - CITY) * PULL));
export const MAX_HALF = pin(1000);

interface Rect {
  x: number;
  z: number;
  hx: number;
  hz: number;
  c: number;
  s: number;
}
const rectOf = (x: number, z: number, w: number, d: number, rot: number): Rect => ({ x, z, hx: w / 2, hz: d / 2, c: Math.cos(rot), s: Math.sin(rot) });

/** What's taken, on a 2 m grid: each cell whose middle a (turned) rectangle covers, with a cell's margin. */
class Occupied {
  private readonly n: number;
  private readonly g: Uint8Array;
  constructor(private readonly half: number) {
    this.n = Math.ceil((half * 2) / 2);
    this.g = new Uint8Array(this.n * this.n);
  }
  private span(t: Rect): [number, number, number, number] {
    const ex = Math.abs(t.c) * t.hx + Math.abs(t.s) * t.hz;
    const ez = Math.abs(t.s) * t.hx + Math.abs(t.c) * t.hz;
    const q0 = Math.max(0, Math.floor((t.x - ex + this.half) / 2));
    const q1 = Math.min(this.n - 1, Math.floor((t.x + ex + this.half) / 2));
    const r0 = Math.max(0, Math.floor((t.z - ez + this.half) / 2));
    const r1 = Math.min(this.n - 1, Math.floor((t.z + ez + this.half) / 2));
    return [q0, q1, r0, r1];
  }
  /** Is the middle of cell (q, r) inside t (grown by a cell)? */
  private covers(t: Rect, q: number, r: number): boolean {
    const x = q * 2 + 1 - this.half - t.x;
    const z = r * 2 + 1 - this.half - t.z;
    const lx = x * t.c - z * t.s;
    const lz = x * t.s + z * t.c;
    return Math.abs(lx) <= t.hx + 1.4 && Math.abs(lz) <= t.hz + 1.4;
  }
  free(t: Rect): boolean {
    const [q0, q1, r0, r1] = this.span(t);
    for (let r = r0; r <= r1; r++) for (let q = q0; q <= q1; q++) if (this.g[r * this.n + q] && this.covers(t, q, r)) return false;
    return true;
  }
  add(t: Rect): void {
    const [q0, q1, r0, r1] = this.span(t);
    for (let r = r0; r <= r1; r++) for (let q = q0; q <= q1; q++) if (this.covers(t, q, r)) this.g[r * this.n + q] = 1;
  }
}

/** The places, their circles (for the names on the compass) and their ground. */
interface Place {
  id: string;
  name: string;
  x: number;
  z: number;
  r: number;
  ground: GroundKind;
}
const PLACES: Place[] = [
  { id: "ironwood", name: "Ironwood Forest", x: 0, z: -740, r: 230, ground: "grass" },
  { id: "windmere", name: "Windmere Ridge", x: 700, z: -700, r: 240, ground: "grass" },
  { id: "harbour", name: "Harbour Yard", x: 760, z: 0, r: 220, ground: "paving" },
  { id: "refinery", name: "Black Refinery", x: 700, z: 700, r: 230, ground: "earth" },
  { id: "dunes", name: "Dune Sea", x: 0, z: 740, r: 240, ground: "sand" },
  { id: "airfield", name: "Old Airfield", x: -700, z: 700, r: 240, ground: "earth" },
  { id: "mangrove", name: "Mangrove Sink", x: -760, z: 0, r: 220, ground: "earth" },
  { id: "neon", name: "Neon Row", x: -760, z: -560, r: 140, ground: "paving" },
  { id: "arena", name: "The Arena", x: -560, z: -800, r: 110, ground: "paving" },
  { id: "glass", name: "Glass District", x: 330, z: -330, r: 118, ground: "paving" },
  { id: "frostline", name: "Frostline", x: 772, z: 320, r: 120, ground: "snow" },
];
for (const p of PLACES) {
  p.x = pin(p.x);
  p.z = pin(p.z);
  p.r = Math.round(p.r * PLACE_R);
}
/** The new places borrow the CC0 props already made for a place like them. */
const PROPS_OF: Record<string, string> = { glass: "neon", frostline: "ironwood" };

/** The roads out of the city to every place (laterite; the runway is tarred). */
const OUT_ROADS: Road[] = [
  { x0: 60, z0: -CITY, x1: 60, z1: -980, w: 12, kind: "asphalt", gutters: false },
  { x0: 60, z0: CITY, x1: 60, z1: 980, w: 12, kind: "asphalt", gutters: false },
  { x0: CITY, z0: 0, x1: 980, z1: 0, w: 10, kind: "asphalt", gutters: false },
  { x0: -CITY, z0: 0, x1: -980, z1: 0, w: 8, kind: "laterite", gutters: false },
  // The ring between the places.
  { x0: -460, z0: -460, x1: 460, z1: -460, w: 8, kind: "laterite", gutters: false },
  { x0: 460, z0: -460, x1: 460, z1: 460, w: 8, kind: "laterite", gutters: false },
  { x0: 460, z0: 460, x1: -460, z1: 460, w: 8, kind: "laterite", gutters: false },
  { x0: -460, z0: 460, x1: -460, z1: -460, w: 8, kind: "laterite", gutters: false },
  // Out to the corners.
  { x0: 460, z0: -460, x1: 760, z1: -760, w: 7, kind: "laterite", gutters: false },
  { x0: 460, z0: 460, x1: 760, z1: 760, w: 7, kind: "laterite", gutters: false },
  { x0: -460, z0: 460, x1: -560, z1: 560, w: 7, kind: "laterite", gutters: false },
  { x0: -460, z0: -460, x1: -700, z1: -700, w: 7, kind: "laterite", gutters: false },
  // Glass District's two streets; the track out to Frostline.
  { x0: CITY, z0: -330, x1: 460, z1: -330, w: 10, kind: "asphalt", gutters: false },
  { x0: 330, z0: -CITY, x1: 330, z1: -460, w: 10, kind: "asphalt", gutters: false },
  { x0: 460, z0: 320, x1: 652, z1: 320, w: 7, kind: "laterite", gutters: false },
];
for (const r of OUT_ROADS) {
  r.x0 = pin(r.x0);
  r.z0 = pin(r.z0);
  r.x1 = pin(r.x1);
  r.z1 = pin(r.z1);
}
/** The Old Airfield's runway (asphalt ground, not a road: nothing parks on it). */
const RUNWAY = { x: pin(-700), z: pin(700), len: 460, w: 36, rot: Math.PI / 4 };

/** The harbour's water along the east edge, the swamp's channel through the west. */
const WATERS: River[] = [
  { pts: [[MAX_HALF - 40, -pin(300)], [MAX_HALF - 40, pin(300)]], w: 70, depth: 3, water: 2.6 },
  {
    pts: ([[-980, -260], [-860, -180], [-800, -40], [-700, 40], [-620, 140], [-560, 260]] as [number, number][]).map(([x, z]) => [pin(x), pin(z)]),
    w: 12,
    depth: 1.1,
    water: 0.85,
  },
];

const MAX_BOARDS: BoardWish[] = [
  // The roads out of the city (both ways), the ring, and each place's heart.
  { x: 74, z: -320, fx: 60, fz: -260, kind: "road", premium: true },
  { x: 46, z: 320, fx: 60, fz: 260, kind: "road", premium: true },
  { x: 320, z: 14, fx: 260, fz: 0, kind: "road" },
  { x: -320, z: -14, fx: -260, fz: 0, kind: "road" },
  { x: 0, z: -472, fx: 0, fz: -460, kind: "road" },
  { x: 472, z: 0, fx: 460, fz: 0, kind: "road" },
  { x: 0, z: 472, fx: 0, fz: 460, kind: "road" },
  { x: -472, z: 0, fx: -460, fz: 0, kind: "road" },
  { x: 680, z: 40, fx: 760, fz: 0, kind: "landmark", premium: true, r: 30 },
  { x: 640, z: 640, fx: 700, fz: 700, kind: "landmark", r: 30 },
  { x: -640, z: 640, fx: -700, fz: 700, kind: "landmark", r: 30 },
  { x: 40, z: 680, fx: 0, fz: 760, kind: "landmark", r: 30 },
  { x: -700, z: -40, fx: -760, fz: 0, kind: "landmark", r: 30 },
  { x: 40, z: -680, fx: 0, fz: -760, kind: "landmark", r: 30 },
  { x: 640, z: -640, fx: 700, fz: -700, kind: "landmark", r: 30 },
  { x: -720, z: -520, fx: -760, fz: -560, kind: "plaza", premium: true, r: 30 },
  { x: -520, z: -760, fx: -560, fz: -800, kind: "plaza", premium: true, r: 30 },
  // v5: more ("add more ads billboards everywhere"): along every road out, round the ring, at the corners and in each place.
  { x: 74, z: -520, fx: 60, fz: -460, kind: "road", r: 20 },
  { x: 46, z: -700, fx: 60, fz: -640, kind: "road", premium: true, r: 20 },
  { x: 74, z: -860, fx: 60, fz: -800, kind: "road", r: 20 },
  { x: 46, z: 520, fx: 60, fz: 460, kind: "road", r: 20 },
  { x: 74, z: 700, fx: 60, fz: 640, kind: "road", premium: true, r: 20 },
  { x: 46, z: 860, fx: 60, fz: 800, kind: "road", r: 20 },
  { x: 520, z: 14, fx: 460, fz: 0, kind: "road", r: 20 },
  { x: 660, z: -14, fx: 600, fz: 0, kind: "road", r: 20 },
  { x: 880, z: 14, fx: 820, fz: 0, kind: "road", r: 20 },
  { x: -520, z: -14, fx: -460, fz: 0, kind: "road", r: 20 },
  { x: -660, z: 14, fx: -600, fz: 0, kind: "road", r: 20 },
  { x: -880, z: -14, fx: -820, fz: 0, kind: "road", r: 20 },
  { x: -300, z: -472, fx: -260, fz: -460, kind: "road", r: 20 },
  { x: 300, z: -448, fx: 260, fz: -460, kind: "road", r: 20 },
  { x: -300, z: 472, fx: -260, fz: 460, kind: "road", r: 20 },
  { x: 300, z: 448, fx: 260, fz: 460, kind: "road", r: 20 },
  { x: 472, z: -280, fx: 460, fz: -240, kind: "road", r: 20 },
  { x: 448, z: 280, fx: 460, fz: 240, kind: "road", r: 20 },
  { x: -472, z: -280, fx: -460, fz: -240, kind: "road", r: 20 },
  { x: -448, z: 280, fx: -460, fz: 240, kind: "road", r: 20 },
  { x: 600, z: -600, fx: 700, fz: -700, kind: "road", r: 25 },
  { x: 600, z: 600, fx: 700, fz: 700, kind: "road", r: 25 },
  { x: -520, z: 540, fx: -700, fz: 700, kind: "road", r: 25 },
  { x: 800, z: -120, fx: 760, fz: 0, kind: "landmark", r: 30 },
  { x: 800, z: 130, fx: 760, fz: 0, kind: "landmark", r: 30 },
  { x: 760, z: 780, fx: 700, fz: 700, kind: "landmark", r: 30 },
  { x: -780, z: 780, fx: -700, fz: 700, kind: "landmark", premium: true, r: 30 },
  { x: -150, z: 800, fx: 0, fz: 760, kind: "landmark", r: 30 },
  { x: 150, z: 800, fx: 0, fz: 760, kind: "landmark", r: 30 },
  { x: -840, z: 100, fx: -760, fz: 0, kind: "landmark", r: 30 },
  { x: -120, z: -800, fx: 0, fz: -760, kind: "landmark", r: 30 },
  { x: 130, z: -800, fx: 0, fz: -760, kind: "landmark", r: 30 },
  { x: 780, z: -780, fx: 700, fz: -700, kind: "landmark", r: 30 },
  { x: -820, z: -600, fx: -760, fz: -560, kind: "plaza", premium: true, r: 30 },
  { x: -700, z: -610, fx: -760, fz: -560, kind: "plaza", r: 30 },
  { x: -600, z: -860, fx: -560, fz: -800, kind: "plaza", r: 30 },
  // v5: Glass District and Frostline (on the end: the older boards keep their ids).
  { x: 216, z: -318, fx: 260, fz: -330, kind: "road", premium: true },
  { x: 318, z: -216, fx: 330, fz: -260, kind: "road", premium: true },
  { x: 444, z: -344, fx: 400, fz: -330, kind: "road" },
  { x: 500, z: 333, fx: 560, fz: 320, kind: "road" },
  { x: 640, z: 307, fx: 600, fz: 320, kind: "road" },
  // v6 max (3.6): portrait LED towers, lit at night, where the night-life is (on the end: no id moves).
  { x: -735, z: -545, fx: -760, fz: -560, kind: "plaza", premium: true, portrait: true },
  { x: -785, z: -578, fx: -760, fz: -560, kind: "plaza", portrait: true },
  { x: -540, z: -780, fx: -560, fz: -800, kind: "plaza", premium: true, portrait: true },
  { x: 312, z: -312, fx: 330, fz: -330, kind: "landmark", premium: true, portrait: true },
  { x: 736, z: 22, fx: 760, fz: 0, kind: "landmark", portrait: true },
  { x: 752, z: 305, fx: 772, fz: 320, kind: "landmark", portrait: true },
  { x: -670, z: 660, fx: -700, fz: 700, kind: "landmark", portrait: true, r: 30 },
  { x: 668, z: 662, fx: 700, fz: 700, kind: "landmark", portrait: true, r: 30 },
];

for (const b of MAX_BOARDS) {
  b.x = pin(b.x);
  b.z = pin(b.z);
  b.fx = pin(b.fx);
  b.fz = pin(b.fz);
}

export function buildMaxWorld(seed = 1957): OpenLayout {
  const city = buildNaijaWorld(seed);
  const H = MAX_HALF;
  const rng = new Rng((seed ^ 0x4d4158) >>> 0);
  const taken = new Occupied(H);
  // The city's ground is the city's (its own generator placed it all).
  taken.add(rectOf(0, 0, CITY * 2 + 8, CITY * 2 + 8, 0));
  const roadRect = (r: Road) => {
    const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
    return rectOf((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, r.w + 2, len, Math.atan2(r.x1 - r.x0, r.z1 - r.z0));
  };
  for (const r of OUT_ROADS) taken.add(roadRect(r));
  taken.add(rectOf(RUNWAY.x, RUNWAY.z, RUNWAY.w + 6, RUNWAY.len + 10, RUNWAY.rot));
  for (const w of WATERS) for (let i = 0; i + 1 < w.pts.length; i++) {
    const [ax, az] = w.pts[i];
    const [bx, bz] = w.pts[i + 1];
    taken.add(rectOf((ax + bx) / 2, (az + bz) / 2, w.w + 4, Math.hypot(bx - ax, bz - az) + 4, Math.atan2(bx - ax, bz - az)));
  }

  const placements: Placement[] = [];
  const nextV = () => (rng.next() * 4294967296) >>> 0;
  const place = (prefab: PrefabId, x: number, z: number, rot: number, v = nextV(), gap = 0.8): boolean => {
    const [w, d] = footprint(prefab, v);
    if (Math.abs(x) > H - 10 || Math.abs(z) > H - 10) return false;
    const t = rectOf(x, z, w + gap, d + gap, rot);
    if (!taken.free(t)) return false;
    taken.add(t);
    placements.push({ prefab, x, z, rot, v });
    return true;
  };
  /** n tries to put `prefab` somewhere in a place's circle (a fraction `inner` of it left clear). */
  const scatter = (
    pl: { x: number; z: number; r: number },
    prefab: PrefabId,
    n: number,
    opts: { inner?: number; rot?: () => number; gap?: number; where?: (x: number, z: number) => boolean } = {},
  ) => {
    let put = 0;
    for (let k = 0; k < n * 4 && put < n; k++) {
      const a = rng.range(0, Math.PI * 2);
      const d = pl.r * Math.sqrt(rng.range(opts.inner ?? 0, 1));
      const x = pl.x + Math.cos(a) * d;
      const z = pl.z + Math.sin(a) * d;
      const rot = opts.rot ? opts.rot() : rng.range(0, Math.PI * 2);
      if (opts.where && !opts.where(x, z)) continue;
      if (place(prefab, x, z, rot, nextV(), opts.gap)) put++;
    }
  };
  const P = Object.fromEntries(PLACES.map((p) => [p.id, p])) as Record<string, Place>;

  // ── Ironwood Forest: a ranger tower in a clearing, cabins, rocks, then pines thick round them ──
  place("rangertower", P.ironwood.x + 20, P.ironwood.z, 0);
  for (const [dx, dz] of [[-40, 30], [60, -50], [-90, -80], [110, 70]]) place("cabin", P.ironwood.x + dx, P.ironwood.z + dz, rng.range(0, 6.28));
  scatter(P.ironwood, "rock", 60, { inner: 0.02 });
  scatter(P.ironwood, "pine", 520, { inner: 0.03, gap: 1.6 });
  // ── Windmere Ridge: turbines in rows across the grass, rocks between ──
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if ((i + j) % 2 === 0) place("turbine", P.windmere.x + i * 80 + rng.range(-6, 6), P.windmere.z + j * 80 + rng.range(-6, 6), 0.6);
  scatter(P.windmere, "rock", 40);
  scatter(P.windmere, "bush", 120);
  // ── Harbour Yard: warehouses on the quay, cranes over the water's edge, container rows ──
  for (const dz of [-160, -60, 60, 160]) place("crane", MAX_HALF - 40 - 35 - 20, pin(dz), Math.PI / 2);
  for (const [dx, dz] of [[-130, -125], [-130, 0], [-130, 125]]) place("warehouse", P.harbour.x + dx, P.harbour.z + dz, 0);
  for (let i = 0; i < 10; i++) for (let j = 0; j < 6; j++) if (rng.chance(0.8)) place("containers", P.harbour.x - 75 + i * 15, P.harbour.z - 170 + j * 28 + rng.range(-3, 3), 0, nextV(), 2.2);
  scatter(P.harbour, "generator", 10);
  // ── Black Refinery: tanks in a grid, pipe runs between, flares at the edge ──
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (rng.chance(0.75)) place("tank", P.refinery.x + i * 60, P.refinery.z + j * 60, 0, nextV(), 3);
  for (let k = 0; k < 18; k++) place("pipes", P.refinery.x + rng.range(-125, 125), P.refinery.z + rng.range(-125, 125), rng.chance(0.5) ? 0 : Math.PI / 2);
  for (const [dx, dz] of [[-156, -33], [148, 98], [33, 164], [-98, 156]]) place("flarestack", P.refinery.x + dx, P.refinery.z + dz, 0);
  // ── Dune Sea: ridges across the sand, rocks, an oasis of palms, a plane down ──
  place("planewreck", P.dunes.x + 60, P.dunes.z + 40, 0.7);
  for (let k = 0; k < 70; k++) place("dune", P.dunes.x + rng.range(-190, 190), P.dunes.z + rng.range(-190, 190), rng.range(-0.4, 0.4) + (k % 2) * 0.3, nextV(), 3);
  scatter({ x: P.dunes.x - 90, z: P.dunes.z - 60, r: 28 }, "palm", 14);
  scatter(P.dunes, "rock", 50);
  // ── Old Airfield: hangars and the tower along the runway, wrecks on the apron ──
  const rc = Math.cos(RUNWAY.rot);
  const rs = Math.sin(RUNWAY.rot);
  for (const t of [-160, -60, 40, 140]) place("hangar", RUNWAY.x + rs * t - rc * 60, RUNWAY.z + rc * t + rs * 60, RUNWAY.rot + Math.PI / 2);
  place("ctower", RUNWAY.x - rc * 100 + rs * 200, RUNWAY.z + rs * 100 + rc * 200, 0);
  for (const t of [-220, 210]) place("planewreck", RUNWAY.x + rs * t + rc * 70, RUNWAY.z + rc * t - rs * 70, rng.range(0, 6.28));
  scatter(P.airfield, "wreck", 16);
  scatter(P.airfield, "bush", 80, { inner: 0.4 });
  // ── Mangrove Sink (v6 max, 3.3, after the v4 picture): standing water with drowned trees in it and huts on
  // stilts over it, the channel through; on the dry ground between, stones, grass and the living mangroves ──
  const ponds: Pond[] = [[-95, 40, 60], [70, -70, 55], [-40, 118, 44], [20, -132, 38], [-104, -76, 33]].map(([dx, dz, r], i) => ({ x: P.mangrove.x + dx, z: P.mangrove.z + dz, r, seed: 3 + i * 1.9 }));
  const wet = (x: number, z: number) => inPond(ponds, x, z, 2);
  const dry = (x: number, z: number) => !inPond(ponds, x, z, -3);
  for (const pd of ponds) scatter({ x: pd.x, z: pd.z, r: pd.r * 0.85 }, "stilt", 3, { where: wet });
  scatter(P.mangrove, "stilt", 5, { inner: 0.05, where: dry });
  for (const pd of ponds) scatter({ x: pd.x, z: pd.z, r: pd.r * 1.1 }, "deadtree", Math.round(pd.r * 1.5), { where: wet, gap: 2.5 });
  scatter(P.mangrove, "deadtree", 35, { where: dry, gap: 3 });
  scatter(P.mangrove, "mangrove", 70, { gap: 1.2, inner: 0.25, where: dry });
  scatter(P.mangrove, "rock", 45, { where: dry });
  scatter(P.mangrove, "bush", 120, { where: dry });
  // ── Neon Row: clubs along the road, glass towers behind; the Arena's stands round its pitch ──
  for (let k = 0; k < 8; k++) place("club", P.neon.x - 100 + k * 28, P.neon.z + (k % 2 ? 22 : -22), k % 2 ? Math.PI : 0);
  for (const [dx, dz] of [[-90, -90], [-30, -100], [40, -95], [100, -80], [-100, 80], [90, 90]]) place("glasstower", P.neon.x + dx, P.neon.z + dz, 0);
  for (let s = 0; s < 4; s++) {
    const a = (s * Math.PI) / 2;
    place("stand", P.arena.x + Math.sin(a) * 52, P.arena.z + Math.cos(a) * 52, a + Math.PI, nextV(), 0.2);
  }
  // ── Glass District: a tower on each block either side of the two streets, a plaza at the crossing ──
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    place("plaza", P.glass.x + sx * 24, P.glass.z + sz * 24, 0);
    for (const [ax, az] of [[40, 40], [78, 34], [34, 78]]) place("glasstower", P.glass.x + sx * ax, P.glass.z + sz * az, 0);
  }
  scatter(P.glass, "pole", 18, { inner: 0.05 });
  // ── Frostline: a radar post in a clearing, cabins, spruce and rock in the snow ──
  place("ctower", P.frostline.x, P.frostline.z, 0);
  for (const [dx, dz] of [[-34, 22], [30, 30], [-20, -36], [44, -24]]) place("cabin", P.frostline.x + dx, P.frostline.z + dz, rng.range(0, 6.28));
  place("containers", P.frostline.x + 8, P.frostline.z + 44, 0.3, nextV(), 2.2);
  place("generator", P.frostline.x - 10, P.frostline.z + 16, 0);
  scatter(P.frostline, "wreck", 3, { inner: 0.2 });
  scatter(P.frostline, "rock", 34, { inner: 0.04 });
  scatter(P.frostline, "snowpine", 170, { inner: 0.08, gap: 1.6 });
  // ── Props (v4 rework R9): the CC0 models for each place (crates, drums and buoys on the quay,
  // generators and racks in the refinery, ferns and camp tables in the forest...), room round each ──
  for (const pl of PLACES) {
    const mine = PROPS.flatMap((q, i) => (propPlaced(q) && q.at.includes(PROPS_OF[pl.id] ?? pl.id) ? [i] : []));
    const want = Math.round(pl.r * 0.45);
    for (let k = 0, put = 0; mine.length && k < want * 6 && put < want; k++) {
      const a = rng.range(0, Math.PI * 2);
      const d = pl.r * Math.sqrt(rng.range(0.02, 1));
      const x = pl.x + Math.cos(a) * d;
      const z = pl.z + Math.sin(a) * d;
      const idx = mine[Math.floor(rng.next() * mine.length)];
      const rot = rng.range(0, Math.PI * 2);
      const q = PROPS[idx];
      // (In the swamp's water only what floats: the buoys and the channel markers.)
      if (inPond(ponds, x, z, -2) && q.id !== "ocean_buoy" && q.id !== "lateral_sea_marker") continue;
      if (!taken.free(rectOf(x, z, q.w + 4, q.d + 4, rot))) continue;
      if (place("prop", x, z, rot, ((nextV() << 8) | idx) >>> 0)) put++;
    }
  }
  // ── The savanna between: trees, bushes and rocks, thinly ──
  for (let k = 0; k < 600; k++) {
    const x = rng.range(-H + 20, H - 20);
    const z = rng.range(-H + 20, H - 20);
    if (Math.abs(x) < CITY + 10 && Math.abs(z) < CITY + 10) continue;
    if (PLACES.some((p) => Math.hypot(p.x - x, p.z - z) < p.r)) continue;
    const pick = rng.next();
    place(pick < 0.45 ? "tree" : pick < 0.8 ? "bush" : pick < 0.92 ? "rock" : "baobab", x, z, rng.range(0, 6.28));
  }

  // ── Solids: the city's (without its wall), the places', the waters', the world's edge ──
  const solids: Solid[] = city.solids.filter(
    (s) => !(s.kind === "box" && s.y0 === 0 && s.y1 === EDGE.h && (Math.abs(Math.abs(s.x) - (CITY - EDGE.t / 2)) < 0.01 || Math.abs(Math.abs(s.z) - (CITY - EDGE.t / 2)) < 0.01) && Math.max(s.hx, s.hz) >= CITY - 1),
  );
  for (const p of placements) solidsOf(p, solids);
  for (const w of WATERS) {
    for (let i = 0; i + 1 < w.pts.length; i++) {
      const [ax, az] = w.pts[i];
      const [bx, bz] = w.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const rot = Math.atan2(bx - ax, bz - az);
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      solids.push({ x: mx, z: mz, hx: w.w / 2, hz: len / 2 + 1, rot, y0: -w.depth, y1: -w.depth, kind: "pit", surface: "sand", water: -w.depth + w.water });
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      for (const side of [-1, 1]) {
        const lx = side * (w.w / 2 + 0.2);
        solids.push({ x: mx + lx * c, z: mz - lx * s, hx: 0.2, hz: len / 2 + 1, rot, y0: -w.depth, y1: 0, kind: "box", surface: "sand" });
      }
    }
  }
  for (const [x, z, hx, hz] of [[0, -H + EDGE.t / 2, H, EDGE.t / 2], [0, H - EDGE.t / 2, H, EDGE.t / 2], [-H + EDGE.t / 2, 0, EDGE.t / 2, H], [H - EDGE.t / 2, 0, EDGE.t / 2, H]]) {
    solids.push({ x, z, hx, hz, rot: 0, y0: 0, y1: EDGE.h, kind: "box", surface: "concrete" });
  }

  // ── Starts: the city's, and three in every place (24-player rooms spread wide) ──
  const spawns: [number, number][] = [...city.spawns];
  const probe = rectOf(0, 0, 2.5, 2.5, 0);
  for (const p of PLACES) {
    let n = 0;
    for (let k = 0; k < 80 && n < 3; k++) {
      const a = rng.range(0, Math.PI * 2);
      const d = p.r * Math.sqrt(rng.range(0.1, 0.8));
      probe.x = p.x + Math.cos(a) * d;
      probe.z = p.z + Math.sin(a) * d;
      if (!taken.free(probe) || Math.abs(probe.x) > H - 20 || Math.abs(probe.z) > H - 20) continue;
      if (spawns.some(([sx, sz]) => Math.hypot(sx - probe.x, sz - probe.z) < 40)) continue;
      spawns.push([probe.x, probe.z]);
      n++;
    }
  }

  // ── More billboards: the city's (their ids kept), then the big world's on the end ──
  const boards = [...(city.boards ?? []), ...placeBoards("mx", MAX_BOARDS, 1, H, taken, placements, solids, spawns)];

  const landmarks: Landmark[] = [...city.landmarks, ...PLACES.map((p) => ({ id: `mx-${p.id}`, name: p.name, x: p.x, z: p.z }))];
  const areas: Area[] = [...city.areas, ...PLACES.map((p) => ({ id: `mx-${p.id}-area`, name: p.name, x: p.x, z: p.z, r: p.r }))];
  const roads = [...city.roads, ...OUT_ROADS];

  // Each road's box (with its half-width), so most points skip it at once.
  const boxes = OUT_ROADS.map((r) => [Math.min(r.x0, r.x1) - r.w, Math.max(r.x0, r.x1) + r.w, Math.min(r.z0, r.z1) - r.w, Math.max(r.z0, r.z1) + r.w]);
  // The answer per 2 m square, worked out once (the ground paint and the map ask hundreds of thousands of times).
  const GN = H;
  const memo = new Uint8Array(GN * GN).fill(255);
  const KINDS: GroundKind[] = ["asphalt", "laterite", "paving", "grass", "earth", "sand", "snow"];
  const groundAt = (x: number, z: number): GroundKind => {
    const q = Math.floor((x + H) / 2);
    const r = Math.floor((z + H) / 2);
    if (q < 0 || r < 0 || q >= GN || r >= GN) return groundOf(x, z);
    const i = r * GN + q;
    if (memo[i] === 255) memo[i] = KINDS.indexOf(groundOf(q * 2 + 1 - H, r * 2 + 1 - H));
    return KINDS[memo[i]];
  };
  const groundOf = (x: number, z: number): GroundKind => {
    if (Math.abs(x) <= CITY && Math.abs(z) <= CITY) return city.groundAt(x, z);
    for (let k = 0; k < OUT_ROADS.length; k++) {
      const b = boxes[k];
      if (x < b[0] || x > b[1] || z < b[2] || z > b[3]) continue;
      const r = OUT_ROADS[k];
      const dx = r.x1 - r.x0;
      const dz = r.z1 - r.z0;
      const t = Math.max(0, Math.min(1, ((x - r.x0) * dx + (z - r.z0) * dz) / (dx * dx + dz * dz)));
      if (Math.hypot(r.x0 + dx * t - x, r.z0 + dz * t - z) <= r.w / 2) return r.kind;
    }
    // The runway.
    const lx = (x - RUNWAY.x) * Math.cos(RUNWAY.rot) - (z - RUNWAY.z) * Math.sin(RUNWAY.rot);
    const lz = (x - RUNWAY.x) * Math.sin(RUNWAY.rot) + (z - RUNWAY.z) * Math.cos(RUNWAY.rot);
    if (Math.abs(lx) <= RUNWAY.w / 2 && Math.abs(lz) <= RUNWAY.len / 2) return "asphalt";
    // v6 max (3.4): bare earth in soft patches through the grass (patches.ts), not a lattice of blocks.
    for (const p of PLACES) if (Math.hypot(p.x - x, p.z - z) <= p.r) return p.ground === "grass" && inPatch(x, z, 26, 0.2, 31) ? "earth" : p.ground;
    return inPatch(x, z, 40, 0.333, 32) ? "earth" : "grass";
  };

  return {
    id: "max-world",
    half: H,
    roads,
    rivers: [...city.rivers, ...WATERS],
    ponds,
    landmarks,
    areas,
    placements: [...city.placements, ...placements],
    gutters: city.gutters,
    slabs: city.slabs,
    solids,
    spawns,
    boards,
    groundAt,
  };
}
