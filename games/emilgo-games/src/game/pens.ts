// Ball Haunting's pens (the owner, 18 Oct 2026: "balls scattered round a
// wider arena with places to go in and find them"; SPEC-V2 Decisions).
//
// Small roofless walled enclosures along both edges of the field, one doorway
// each, facing the middle. Some of the balls lie inside them; to get one you
// go in through the door, and out again. No roof: Mama sees inside, so a pen
// is never a place to hide from her.
//
// Pure and shared: the layout follows from the course alone (mode, distance,
// width — never the seed), and the walls are solid in the referee's own
// movement code, which the server runs and every phone predicts with. So all
// agree on where the walls are without a word on the wire.
//
// No imports from config: config builds each course's pens with this file.

export interface Pen {
  /** Centre of the inside. */
  readonly x: number;
  readonly z: number;
  /** Which edge it stands on: the door faces the other way, towards x = 0. */
  readonly side: 1 | -1;
}

/** An axis-aligned wall: centre and half sizes on the ground. */
export interface Wall {
  readonly x: number;
  readonly z: number;
  readonly hx: number;
  readonly hz: number;
}

export const PEN = {
  /** Inside, metres square. */
  size: 4,
  /** Walls: thickness and height (chest height: heads show over them). */
  wall: 0.24,
  height: 1.3,
  /** The doorway's width. */
  door: 1.8,
  /** Gap left between a pen's back wall and the field's edge. */
  edge: 0.35,
} as const;

const HALF = PEN.size / 2;

/** Pens per side for a distance: 2 on 100 m, 3 on 200 m, 4 on 300 m. */
function perSide(distance: number): number {
  return distance <= 100 ? 2 : distance <= 200 ? 3 : 4;
}

/** The pens for a course (none outside Ball Haunting). */
export function pensFor(mode: string, distance: number, halfWidth: number): Pen[] {
  if (mode !== "balls") return [];
  const n = perSide(distance);
  const z0 = -distance * 0.2;
  const z1 = -distance * 0.8;
  const out: Pen[] = [];
  const cx = halfWidth - PEN.edge - PEN.wall - HALF;
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < n; i++) {
      // The two sides are staggered, so a runner meets them one at a time.
      const u = (i + (side > 0 ? 0.5 : 0)) / (n - 0.5);
      out.push({ x: side * cx, z: z0 + (z1 - z0) * u, side });
    }
  }
  return out;
}

/** Every wall of every pen: back, two ends, and the front split round the door. */
export function wallsOf(pens: readonly Pen[]): Wall[] {
  const w = PEN.wall;
  const out: Wall[] = [];
  const front = (HALF + w - PEN.door / 2) / 2;
  for (const p of pens) {
    out.push({ x: p.x + p.side * (HALF + w / 2), z: p.z, hx: w / 2, hz: HALF + w });
    out.push({ x: p.x, z: p.z + HALF + w / 2, hx: HALF + w, hz: w / 2 });
    out.push({ x: p.x, z: p.z - HALF - w / 2, hx: HALF + w, hz: w / 2 });
    const fx = p.x - p.side * (HALF + w / 2);
    out.push({ x: fx, z: p.z + PEN.door / 2 + front, hx: w / 2, hz: front });
    out.push({ x: fx, z: p.z - PEN.door / 2 - front, hx: w / 2, hz: front });
  }
  return out;
}

/** The pen whose inside holds (x, z), or null. */
export function penAt(pens: readonly Pen[], x: number, z: number, margin = 0): Pen | null {
  for (const p of pens) if (Math.abs(x - p.x) < HALF + margin && Math.abs(z - p.z) < HALF + margin) return p;
  return null;
}

/** Is (x, z) inside a pen or its walls (with room `r` round it)? */
export function inPenArea(pens: readonly Pen[], x: number, z: number, r: number): boolean {
  return penAt(pens, x, z, PEN.wall + r) !== null;
}

/** How wide the open middle is: the half width between the pens' doors (Infinity: no pens). */
export function openLane(pens: readonly Pen[]): number {
  let lane = Infinity;
  for (const p of pens) lane = Math.min(lane, Math.abs(p.x) - HALF - PEN.wall);
  return lane;
}

/**
 * A body of radius `r` at (o.x, o.z), moving (o.vx, o.vz): pushed out of any
 * wall it overlaps, and its speed into that wall taken away (it can slide
 * along). Corners are round, so nobody snags on them.
 */
export function collideWalls(o: { x: number; z: number; vx: number; vz: number }, walls: readonly Wall[], r: number): void {
  for (const w of walls) {
    const dx = o.x - w.x;
    const dz = o.z - w.z;
    const ex = Math.abs(dx) - w.hx;
    const ez = Math.abs(dz) - w.hz;
    if (ex >= r || ez >= r) continue;
    if (ex > 0 && ez > 0) {
      // Round the corner.
      const d = Math.hypot(ex, ez);
      if (d >= r) continue;
      const nx = (Math.sign(dx) * ex) / d;
      const nz = (Math.sign(dz) * ez) / d;
      o.x += nx * (r - d);
      o.z += nz * (r - d);
      const vn = o.vx * nx + o.vz * nz;
      if (vn < 0) {
        o.vx -= vn * nx;
        o.vz -= vn * nz;
      }
      continue;
    }
    // Out along the side it went in least.
    if (r - ex < r - ez) {
      const s = Math.sign(dx) || 1;
      o.x = w.x + s * (w.hx + r);
      if (o.vx * s < 0) o.vx = 0;
    } else {
      const s = Math.sign(dz) || 1;
      o.z = w.z + s * (w.hz + r);
      if (o.vz * s < 0) o.vz = 0;
    }
  }
}

/** A point (a ball) pushed clear of the walls. */
export function clearOfWalls(p: { x: number; z: number }, walls: readonly Wall[], r: number): void {
  const o = { x: p.x, z: p.z, vx: 0, vz: 0 };
  collideWalls(o, walls, r);
  p.x = o.x;
  p.z = o.z;
}

/** Close enough to the door's line to walk straight through it. */
const LINED = 0.35;

/**
 * Where to head for, going from (fx, fz) to (tx, tz) with pens about: round
 * any pen in the way, and in or out by the door — lined up on its axis first,
 * then straight through. The CPUs and the tutorial's model use it; people find
 * their own way.
 */
export function route(pens: readonly Pen[], fx: number, fz: number, tx: number, tz: number): { x: number; z: number } {
  if (!pens.length) return { x: tx, z: tz };
  const into = penAt(pens, tx, tz);
  const from = penAt(pens, fx, fz, PEN.wall);
  if (from && from !== into) {
    // Out by the door: onto its axis inside, then straight out.
    const doorX = from.x - from.side * HALF;
    if (Math.abs(fz - from.z) < LINED) return { x: doorX - from.side * 1.6, z: from.z };
    return { x: from.x - from.side * 0.6, z: from.z };
  }
  if (into && from !== into) {
    const doorX = into.x - into.side * (HALF + PEN.wall);
    // In front of the door and inside its opening: straight in along its axis.
    if (Math.abs(fz - into.z) < LINED && (fx - doorX) * into.side < 0.2 && (fx - doorX) * into.side > -2) return { x: into.x - into.side * (HALF - 0.9), z: into.z };
    // Else to the spot in front of the door (round any pen in the way).
    const ox = doorX - into.side * 1.3;
    return around(pens, fx, fz, ox, into.z, into) ?? { x: ox, z: into.z };
  }
  // Both in the same pen, or neither in one: straight, or round a pen in between.
  return around(pens, fx, fz, tx, tz, from ?? into) ?? { x: tx, z: tz };
}

/** A pen across the straight line (fx, fz) → (tx, tz) — not `skip`, the one you're in — : the way round it on its field side, or null. */
function around(pens: readonly Pen[], fx: number, fz: number, tx: number, tz: number, skip: Pen | null): { x: number; z: number } | null {
  const e = HALF + PEN.wall + 0.6;
  for (const p of pens) {
    if (p === skip || !crosses(fx, fz, tx, tz, p.x, p.z, e)) continue;
    const lane = p.x - p.side * (e + 0.5);
    // Beside it on the edge's side of the lane: step out into the lane first…
    if ((fx - lane) * p.side > 0.2 && Math.abs(fz - p.z) > e) return { x: lane, z: fz };
    // …then along the lane past its end.
    return { x: lane, z: tz < p.z ? p.z - e - 0.3 : p.z + e + 0.3 };
  }
  return null;
}

/** Does the segment cross the square of half size `e` round (cx, cz)? */
function crosses(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, e: number): boolean {
  let t0 = 0;
  let t1 = 1;
  for (const [o, d, lo, hi] of [
    [ax, bx - ax, cx - e, cx + e],
    [az, bz - az, cz - e, cz + e],
  ] as const) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return false;
      continue;
    }
    let a = (lo - o) / d;
    let b = (hi - o) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}
