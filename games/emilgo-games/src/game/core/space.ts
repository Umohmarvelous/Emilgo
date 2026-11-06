// Solid ground and walls for the open worlds (SPEC-V3 §6.2): what a body
// stands on and what stops it. Pure and shared: the server's referee, Solo and
// the online client's prediction all move bodies through this same code, built
// from the same layout, so nothing about the world ever goes on the wire.
//
// Three kinds of solid, each a rectangle on the ground turned by `rot`:
//   box    a wall, a building, a roof, a slab, a bench: from y0 (bottom) to y1 (top)
//   ramp   stairs and slopes: solid from y0 up to a top that runs from y1 at its
//          −hz end to y2 at its +hz end
//   pit    a sunken floor at y1 (gutters, the river); its walls are boxes of
//          their own, so a pit only lowers the ground inside it
//
// A body is a circle with a height. Something whose top is within STEP of your
// feet is ground (you step up onto it); something higher, that you aren't
// fully under, is a wall. A body keeps two heights: `h`, the floor it stands
// on, and `y`, how far it is above that floor (a jump, a fall). "In the air"
// is y > 0, exactly as on the flat Red Light, Green Light field.

import type { Surface } from "../../maps/registry";

export type SolidKind = "box" | "ramp" | "pit";

export interface Solid {
  x: number;
  z: number;
  /** Half sizes along the solid's own axes. */
  hx: number;
  hz: number;
  /** Turn about the vertical, radians (the solid's +x axis is world (cos rot, −sin rot)). */
  rot: number;
  /** box: bottom and top. ramp: bottom, the top at −hz (y1) and at +hz (y2). pit: y1 is its floor. */
  y0: number;
  y1: number;
  y2?: number;
  kind: SolidKind;
  /** What a footstep on it sounds like. */
  surface: Surface;
  /** pit: the water's surface height (the river); deeper than WADE slows you. */
  water?: number;
}

/** Highest step a body takes without jumping, metres. */
export const STEP = 0.45;
/** A body's height by stance (standing, crouching, prone). */
export const HEAD: readonly [number, number, number] = [1.75, 1.15, 0.55];
/** Water deeper than this at your feet slows you to a wade. */
export const WADE = 0.3;
const WADE_SPEED = 2.2;

/** What moves through a Space: the body fields the movement kernel keeps. */
export interface Mover {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Floor height under the body. */
  h: number;
  /** Height above that floor (a jump or a fall). */
  y: number;
  vy: number;
  stance: number;
}

export interface Floor {
  h: number;
  surface: Surface;
  /** Water depth over that floor (0: dry). */
  water: number;
}

/** A camera's box: the AABB of a solid, with its bottom and top. */
export interface CamBox {
  x: number;
  z: number;
  hx: number;
  hz: number;
  h: number;
  y0: number;
}

const GRID = 8;

export class Space {
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly cells: number[][];
  private readonly cols: number;
  private readonly rows: number;
  private readonly stamp: Int32Array;
  private tick = 1;
  private readonly cam: CamBox[];

  constructor(
    readonly solids: readonly Solid[],
    /** The world's edge: nobody leaves this rectangle. */
    readonly bounds: { x0: number; z0: number; x1: number; z1: number },
    /** The open ground's own surface (a road, a field), where no solid says otherwise. */
    readonly baseSurface: (x: number, z: number) => Surface = () => "concrete",
  ) {
    const n = solids.length;
    this.cos = new Float64Array(n);
    this.sin = new Float64Array(n);
    this.stamp = new Int32Array(n);
    this.cols = Math.max(1, Math.ceil((bounds.x1 - bounds.x0) / GRID));
    this.rows = Math.max(1, Math.ceil((bounds.z1 - bounds.z0) / GRID));
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
    this.cam = [];
    solids.forEach((s, i) => {
      const c = Math.cos(s.rot);
      const sn = Math.sin(s.rot);
      this.cos[i] = c;
      this.sin[i] = sn;
      // The rectangle's bounding box in the world.
      const ex = Math.abs(c) * s.hx + Math.abs(sn) * s.hz;
      const ez = Math.abs(sn) * s.hx + Math.abs(c) * s.hz;
      const a = this.cellOf(s.x - ex, s.z - ez);
      const b = this.cellOf(s.x + ex, s.z + ez);
      for (let r = a[1]; r <= b[1]; r++) for (let q = a[0]; q <= b[0]; q++) this.cells[r * this.cols + q].push(i);
      if (s.kind !== "pit") this.cam.push({ x: s.x, z: s.z, hx: ex, hz: ez, h: s.kind === "ramp" ? Math.max(s.y1, s.y2 ?? s.y1) : s.y1, y0: s.y0 });
      else this.cam.push({ x: s.x, z: s.z, hx: 0, hz: 0, h: -99, y0: -99 });
    });
  }

  private cellOf(x: number, z: number): [number, number] {
    const q = Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.bounds.x0) / GRID)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.bounds.z0) / GRID)));
    return [q, r];
  }

  /** Every solid whose cell is within `r` of (x, z), each once. */
  near(x: number, z: number, r: number, out: number[] = []): number[] {
    out.length = 0;
    const t = ++this.tick;
    // No arrays made here: the hottest function in a match (every step, every body, every shot).
    const { x0, z0 } = this.bounds;
    const qa = Math.min(this.cols - 1, Math.max(0, Math.floor((x - r - x0) / GRID)));
    const qb = Math.min(this.cols - 1, Math.max(0, Math.floor((x + r - x0) / GRID)));
    const ra = Math.min(this.rows - 1, Math.max(0, Math.floor((z - r - z0) / GRID)));
    const rb = Math.min(this.rows - 1, Math.max(0, Math.floor((z + r - z0) / GRID)));
    const stamp = this.stamp;
    for (let row = ra; row <= rb; row++) {
      for (let q = qa; q <= qb; q++) {
        const cell = this.cells[row * this.cols + q];
        for (let k = 0; k < cell.length; k++) {
          const i = cell[k];
          if (stamp[i] === t) continue;
          stamp[i] = t;
          out.push(i);
        }
      }
    }
    return out;
  }

  /**
   * Can an eye at (ax, az) see (bx, bz), both `y` metres up? Walls, roofs and
   * anything solid at that height in between block it (sampled every half
   * metre; open ground, kerbs and gutters don't). Lights Out's lamps use it.
   */
  lineClear(ax: number, az: number, bx: number, bz: number, y: number): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(d / 0.5));
    for (let k = 1; k < steps; k++) {
      const u = k / steps;
      const x = ax + (bx - ax) * u;
      const z = az + (bz - az) * u;
      for (const i of this.near(x, z, 0.05, _ids)) {
        const so = this.solids[i];
        if (so.kind === "pit" || so.y0 > y) continue;
        const [lx, lz] = this.toLocal(i, x, z, _l);
        if (Math.abs(lx) > so.hx || Math.abs(lz) > so.hz) continue;
        if (this.topAt(so, lz) >= y) return false;
      }
    }
    return true;
  }

  /**
   * A bullet (v4): how far a ray from (ox, oy, oz) along the unit (dx, dy, dz)
   * goes before it meets a solid or the ground, at most `max`. Walks the grid
   * cell by cell (Amanatides–Woo) and tests each solid once (a slab test in
   * the solid's own axes; a ramp as a box up to its mean top). Pits and the
   * open ground stop it at the floor (y 0 outside solids).
   */
  ray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
    let best = max;
    // The ground plane (everything stands on y ≥ 0; pits are a few cm down at most to a bullet).
    if (dy < -1e-6) best = Math.min(best, Math.max(0, -oy / dy));
    const t = ++this.tick;
    const b = this.bounds;
    let q = Math.floor((ox - b.x0) / GRID);
    let r = Math.floor((oz - b.z0) / GRID);
    const sq = dx > 0 ? 1 : -1;
    const sr = dz > 0 ? 1 : -1;
    const tdq = Math.abs(dx) > 1e-9 ? GRID / Math.abs(dx) : Infinity;
    const tdr = Math.abs(dz) > 1e-9 ? GRID / Math.abs(dz) : Infinity;
    let tq = Math.abs(dx) > 1e-9 ? ((dx > 0 ? (q + 1) * GRID : q * GRID) - (ox - b.x0)) / dx : Infinity;
    let tr = Math.abs(dz) > 1e-9 ? ((dz > 0 ? (r + 1) * GRID : r * GRID) - (oz - b.z0)) / dz : Infinity;
    let tc = 0;
    for (let n = 0; n < 512 && tc <= best; n++) {
      if (q >= 0 && r >= 0 && q < this.cols && r < this.rows) {
        for (const i of this.cells[r * this.cols + q]) {
          if (this.stamp[i] === t) continue;
          this.stamp[i] = t;
          const so = this.solids[i];
          if (so.kind === "pit") continue;
          const hit = this.slab(i, ox, oy, oz, dx, dy, dz, best);
          if (hit < best) best = hit;
        }
      } else if ((q < 0 && sq < 0) || (r < 0 && sr < 0) || (q >= this.cols && sq > 0) || (r >= this.rows && sr > 0)) break;
      if (tq < tr) {
        tc = tq;
        tq += tdq;
        q += sq;
      } else {
        tc = tr;
        tr += tdr;
        r += sr;
      }
    }
    return best;
  }

  /** Where a ray enters solid i (or `max`): the slab test in its own frame. */
  private slab(i: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
    const so = this.solids[i];
    const c = this.cos[i];
    const sn = this.sin[i];
    const px = ox - so.x;
    const pz = oz - so.z;
    const lo = [px * c - pz * sn, oy, px * sn + pz * c];
    const ld = [dx * c - dz * sn, dy, dx * sn + dz * c];
    const top = so.kind === "ramp" ? (so.y1 + (so.y2 ?? so.y1)) / 2 : so.y1;
    const mins = [-so.hx, so.y0, -so.hz];
    const maxs = [so.hx, top, so.hz];
    let t0 = 0;
    let t1 = max;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(ld[a]) < 1e-9) {
        if (lo[a] < mins[a] || lo[a] > maxs[a]) return max;
        continue;
      }
      let u = (mins[a] - lo[a]) / ld[a];
      let v = (maxs[a] - lo[a]) / ld[a];
      if (u > v) [u, v] = [v, u];
      if (u > t0) t0 = u;
      if (v < t1) t1 = v;
      if (t0 > t1) return max;
    }
    return t0;
  }

  /** The highest top of anything solid within r of (x, z) (0: open ground). Zip-lines check their path with it. */
  topNear(x: number, z: number, r: number): number {
    let best = 0;
    for (const i of this.near(x, z, r, _ids)) {
      const so = this.solids[i];
      if (so.kind === "pit") continue;
      const [lx, lz] = this.toLocal(i, x, z, _l);
      if (Math.abs(lx) > so.hx + r || Math.abs(lz) > so.hz + r) continue;
      best = Math.max(best, this.topAt(so, Math.max(-so.hz, Math.min(so.hz, lz))));
    }
    return best;
  }

  /** The camera's boxes near a point (the follow camera keeps out of them). */
  camBoxes(x: number, z: number, r: number, out: CamBox[] = []): CamBox[] {
    out.length = 0;
    for (const i of this.near(x, z, r, _ids)) if (this.solids[i].kind !== "pit") out.push(this.cam[i]);
    return out;
  }

  /** (x, z) in solid i's own axes. */
  private toLocal(i: number, x: number, z: number, out: [number, number]): [number, number] {
    const s = this.solids[i];
    const dx = x - s.x;
    const dz = z - s.z;
    out[0] = dx * this.cos[i] - dz * this.sin[i];
    out[1] = dx * this.sin[i] + dz * this.cos[i];
    return out;
  }

  /** The solid's top at a local point (ramps slope; boxes are flat). */
  private topAt(s: Solid, lz: number): number {
    if (s.kind !== "ramp") return s.y1;
    const u = Math.min(1, Math.max(0, (lz / Math.max(1e-6, s.hz)) * 0.5 + 0.5));
    return s.y1 + ((s.y2 ?? s.y1) - s.y1) * u;
  }

  /** The highest floor under (x, z) a body with its feet at `feet` can stand on. */
  floorAt(x: number, z: number, feet: number): Floor {
    let base = 0;
    let baseSurface: Surface | null = null;
    let water = -Infinity;
    let best = -Infinity;
    let surface: Surface | null = null;
    for (const i of this.near(x, z, 0, _ids)) {
      const s = this.solids[i];
      const [lx, lz] = this.toLocal(i, x, z, _l);
      if (Math.abs(lx) > s.hx || Math.abs(lz) > s.hz) continue;
      if (s.kind === "pit") {
        if (s.y1 < base) {
          base = s.y1;
          baseSurface = s.surface;
          water = s.water ?? -Infinity;
        }
        continue;
      }
      const top = this.topAt(s, lz);
      if (top <= feet + STEP && top > best) {
        best = top;
        surface = s.surface;
      }
    }
    if (best > base) return { h: best, surface: surface!, water: 0 };
    return { h: base, surface: baseSurface ?? this.baseSurface(x, z), water: Math.max(0, water - base) };
  }

  /**
   * After a body has moved for one step: keep it out of walls (sliding along
   * them), then put it on the floor under it — up a step, up stairs, down onto
   * a lower floor, or into the air off a ledge (gravity takes it from there).
   */
  resolve(c: Mover, radius: number): void {
    const feet = c.h + c.y;
    const head = feet + (HEAD[c.stance as 0 | 1 | 2] ?? HEAD[0]);
    for (let pass = 0; pass < 2; pass++) {
      for (const i of this.near(c.x, c.z, radius + 0.1, _ids)) {
        const s = this.solids[i];
        if (s.kind === "pit" || s.y0 >= head) continue;
        const [lx, lz] = this.toLocal(i, c.x, c.z, _l);
        if (Math.abs(lx) > s.hx + radius || Math.abs(lz) > s.hz + radius) continue;
        const nx = Math.max(-s.hx, Math.min(s.hx, lx));
        const nz = Math.max(-s.hz, Math.min(s.hz, lz));
        // The top where the body touches it: low enough is ground, not a wall.
        if (this.topAt(s, nz) <= feet + STEP) continue;
        let px = lx;
        let pz = lz;
        let ox = lx - nx;
        let oz = lz - nz;
        const d2 = ox * ox + oz * oz;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          if (d >= radius) continue;
          ox /= d;
          oz /= d;
          px = nx + ox * radius;
          pz = nz + oz * radius;
        } else {
          // The centre is inside: out by the shortest way.
          const fx = s.hx + radius - Math.abs(lx);
          const fz = s.hz + radius - Math.abs(lz);
          if (fx < fz) {
            ox = lx >= 0 ? 1 : -1;
            oz = 0;
            px = ox * (s.hx + radius);
          } else {
            ox = 0;
            oz = lz >= 0 ? 1 : -1;
            pz = oz * (s.hz + radius);
          }
        }
        // Back to the world, and no more speed into the wall.
        const ci = this.cos[i];
        const si = this.sin[i];
        c.x = s.x + px * ci + pz * si;
        c.z = s.z - px * si + pz * ci;
        const wnx = ox * ci + oz * si;
        const wnz = -ox * si + oz * ci;
        const into = c.vx * wnx + c.vz * wnz;
        if (into < 0) {
          c.vx -= into * wnx;
          c.vz -= into * wnz;
        }
      }
    }

    // The world's edge.
    const b = this.bounds;
    if (c.x < b.x0 + radius) { c.x = b.x0 + radius; c.vx = Math.max(0, c.vx); }
    if (c.x > b.x1 - radius) { c.x = b.x1 - radius; c.vx = Math.min(0, c.vx); }
    if (c.z < b.z0 + radius) { c.z = b.z0 + radius; c.vz = Math.max(0, c.vz); }
    if (c.z > b.z1 - radius) { c.z = b.z1 - radius; c.vz = Math.min(0, c.vz); }

    // The floor.
    const f = this.floorAt(c.x, c.z, feet);
    if (f.h > c.h + 1e-4) {
      if (c.y <= 0) c.h = f.h; // a step, the stairs
      else if (feet <= f.h) {
        c.h = f.h; // landed on it
        c.y = 0;
        c.vy = 0;
      } else {
        c.y = feet - f.h; // still above it
        c.h = f.h;
      }
    } else if (f.h < c.h - 1e-4) {
      const drop = c.h - f.h;
      if (c.y <= 0 && c.vy <= 0 && drop <= STEP) c.h = f.h; // down a step: stay on your feet
      else {
        c.y = feet - f.h; // off a ledge: falling
        c.h = f.h;
      }
    }
    // Wading: deep water holds you back.
    if (f.water > WADE && c.y <= 0) {
      const sp = Math.hypot(c.vx, c.vz);
      if (sp > WADE_SPEED) {
        c.vx *= WADE_SPEED / sp;
        c.vz *= WADE_SPEED / sp;
      }
    }
  }

  /** What a footstep at (x, z) lands on (feet at `feet`). */
  surfaceAt(x: number, z: number, feet: number): Surface {
    const f = this.floorAt(x, z, feet);
    return f.water > 0.05 ? "puddle" : f.surface;
  }
}

const _ids: number[] = [];
const _l: [number, number] = [0, 0];
