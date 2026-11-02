// Where a body can walk in an open world (SPEC-V3 Phase 3): a 1 m grid of the
// ground, each cell marked free when a standing body fits there, then flooded
// from one start so only ground joined to the rest counts. Items, Airfall
// crates, zone centres and respawns are all placed on it, so nothing lands in
// a wall, on a roof nobody can reach or in a yard with no way in.
//
// Pure and shared: the server and every phone build the same grid from the
// same Space. Built once per Space (about 0.1–0.3 s for Naija World) and kept.

import { HEAD, STEP, type Space } from "./space";

export interface Reach {
  /** Cells per side (1 m each), and the world's corner. */
  readonly n: number;
  readonly x0: number;
  readonly z0: number;
  /** 1 where a body can walk to from the start. */
  readonly ok: Uint8Array;
  /** The floor's height in each cell. */
  readonly h: Float32Array;
  /**
   * Reachable cells on open ground: dry, not sunk (no gutters, no river),
   * the indices of `ok`. Things are placed on these.
   */
  readonly open: Int32Array;
  /** 1 for the cells in `open`. */
  readonly ground: Uint8Array;
  /** 1 where a standing body fits, joined to the start or not (a shut gate can cut a world in two). */
  readonly free: Uint8Array;
  /** Is (x, z) walkable ground joined to the rest? */
  at(x: number, z: number): boolean;
  /** The cell (x, z) falls in, or −1 off the grid. */
  cell(x: number, z: number): number;
  /** A cell's centre. */
  centre(i: number): [number, number];
}

/** A standing body's radius for the free test (a little under MOVE.radius: brushing a wall is fine). */
const R = 0.3;

const built = new WeakMap<Space, Reach>();

/** The walk grid of `space`, flooded from `from` (built the first time, then kept). */
export function reachOf(space: Space, from: readonly [number, number]): Reach {
  const had = built.get(space);
  if (had) return had;
  const b = space.bounds;
  const n = Math.ceil(Math.max(b.x1 - b.x0, b.z1 - b.z0));
  const x0 = b.x0;
  const z0 = b.z0;
  const free = new Uint8Array(n * n);
  const h = new Float32Array(n * n);
  const dry = new Uint8Array(n * n);
  const ids: number[] = [];
  for (let r = 0; r < n; r++) {
    for (let q = 0; q < n; q++) {
      const x = x0 + q + 0.5;
      const z = z0 + r + 0.5;
      const f = space.floorAt(x, z, 0);
      const i = r * n + q;
      h[i] = f.h;
      dry[i] = f.water <= 0.02 && f.h > -0.3 ? 1 : 0;
      let ok = true;
      for (const k of space.near(x, z, R + 0.1, ids)) {
        const s = space.solids[k];
        if (s.kind === "pit" || s.y0 >= f.h + HEAD[0]) continue;
        const c = Math.cos(s.rot);
        const sn = Math.sin(s.rot);
        const dx = x - s.x;
        const dz = z - s.z;
        const lx = dx * c - dz * sn;
        const lz = dx * sn + dz * c;
        if (Math.abs(lx) > s.hx + R || Math.abs(lz) > s.hz + R) continue;
        const top = s.kind === "ramp" ? Math.max(s.y1, s.y2 ?? s.y1) : s.y1;
        if (top > f.h + STEP) {
          ok = false;
          break;
        }
      }
      free[i] = ok ? 1 : 0;
    }
  }
  const cell = (x: number, z: number): number => {
    const q = Math.floor(x - x0);
    const r = Math.floor(z - z0);
    return q < 0 || r < 0 || q >= n || r >= n ? -1 : r * n + q;
  };
  // The flood from the start.
  const ok = new Uint8Array(n * n);
  const queue = new Int32Array(n * n);
  let tail = 0;
  const s0 = cell(from[0], from[1]);
  if (s0 >= 0 && free[s0]) {
    ok[s0] = 1;
    queue[tail++] = s0;
  }
  for (let head = 0; head < tail; head++) {
    const i = queue[head];
    const q = i % n;
    const r = (i / n) | 0;
    if (q > 0 && !ok[i - 1] && free[i - 1]) (ok[i - 1] = 1), (queue[tail++] = i - 1);
    if (q < n - 1 && !ok[i + 1] && free[i + 1]) (ok[i + 1] = 1), (queue[tail++] = i + 1);
    if (r > 0 && !ok[i - n] && free[i - n]) (ok[i - n] = 1), (queue[tail++] = i - n);
    if (r < n - 1 && !ok[i + n] && free[i + n]) (ok[i + n] = 1), (queue[tail++] = i + n);
  }
  const open: number[] = [];
  const ground = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) {
    if (!ok[i] || !dry[i]) continue;
    open.push(i);
    ground[i] = 1;
  }
  const reach: Reach = {
    n,
    x0,
    z0,
    ok,
    h,
    open: Int32Array.from(open),
    ground,
    free,
    at: (x, z) => {
      const i = cell(x, z);
      return i >= 0 && ok[i] === 1;
    },
    cell,
    centre: (i) => [x0 + (i % n) + 0.5, z0 + ((i / n) | 0) + 0.5],
  };
  built.set(space, reach);
  return reach;
}
