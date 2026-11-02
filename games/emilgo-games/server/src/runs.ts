// Dead Streets runs (SPEC-V3 §3.3; Phase 7): the server checks each one and
// keeps the board. A run is played on the phone (it's solo); the phone asks
// for a run first (a seed and the time, from here), then sends where it went
// (one sample a second, in parts: messages are small) and what it claims.
//
// The check doesn't replay the run (a phone's maths can differ from Node's in
// the last bit, and twelve minutes of zombies would drift). It asks whether a
// body could have done what the trace says on this city:
//   - no faster than a sprint between samples (with a little slack);
//   - every sample on a real floor there, and never inside a wall;
//   - the route's checkpoints in order, the Mast at the end if it claims a finish;
//   - no quicker than the wall clock since the run was asked for;
//   - kills and head shots that a run that long could have.
// Then the XP (rank/xp.ts runXp) and, for a finish, a time on the board.
//
// What is stored: the profile key, the time, the score, the day. No names.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { MOVE, SURVIVAL } from "../../src/config";
import { Space } from "../../src/game/core/space";
import { SURFACE_OF } from "../../src/maps/open/naija";
import { buildSpookyWorld, routeAt, type SpookyRun } from "../../src/maps/open/spooky";

export interface RunClaim {
  secs: number;
  fin: boolean;
  kills: number;
  heads: number;
  route: number;
}

export interface Verdict {
  ok: boolean;
  why: string;
}

/** Most metres between two samples a second apart (a sprint, and slack for a knock or a shove). */
const MAX_STEP = MOVE.sprint * 1.25 + 1.5;
/** Steps through something solid that are forgiven (a corner clipped between samples). */
const WALL_SLACK = 4;

let world: { run: SpookyRun; space: Space } | null = null;

/** Spooky World as the server knows it, with every gate open (the phone opened them as it went). */
export function runWorld(): { run: SpookyRun; space: Space } {
  if (world) return world;
  const L = buildSpookyWorld();
  const space = new Space(L.solids, { x0: -L.half, z0: -L.half, x1: L.half, z1: L.half }, (x, z) => SURFACE_OF[L.groundAt(x, z)]);
  for (const g of L.run.gates) {
    L.solids[g.solid].y0 = 99;
    L.solids[g.solid].y1 = -99;
  }
  world = { run: L.run, space };
  return world;
}

/** Is a body standing on floor `h` at (x, z) inside something solid (a wall, a building)? */
function insideSolid(space: Space, x: number, z: number, h: number): boolean {
  for (const i of space.near(x, z, 0.1, [])) {
    const s = space.solids[i];
    // Only what comes down below the knee: a low ceiling you crawl under isn't a wall.
    if (s.kind === "pit" || s.y0 >= h + 0.5) continue;
    const c = Math.cos(s.rot);
    const sn = Math.sin(s.rot);
    const lx = (x - s.x) * c - (z - s.z) * sn;
    const lz = (x - s.x) * sn + (z - s.z) * c;
    if (Math.abs(lx) > s.hx - 0.15 || Math.abs(lz) > s.hz - 0.15) continue;
    const top = s.kind === "ramp" ? (s.y1 + ((s.y2 ?? s.y1) - s.y1) * (Math.max(-1, Math.min(1, lz / s.hz)) * 0.5 + 0.5)) : s.y1;
    if (top > h + 0.6) return true;
  }
  return false;
}

/**
 * Could a body have run this? `trace`: t, x, z, h (the floor under it)
 * samples a second apart. `wall`: real seconds since the run was asked for.
 */
export function verifyRun(trace: readonly number[], claim: RunClaim, wall: number): Verdict {
  const { run, space } = runWorld();
  const S = 4;
  const n = Math.floor(trace.length / S);
  if (n < 2 || trace.length % S !== 0) return { ok: false, why: "trace" };
  if (!(claim.secs > 0) || claim.secs > 3600 || claim.kills < 0 || claim.heads < 0 || claim.heads > claim.kills) return { ok: false, why: "claim" };
  if (claim.secs > wall + 3) return { ok: false, why: "clock" };
  if (Math.abs(trace[(n - 1) * S] - claim.secs) > 2.5) return { ok: false, why: "length" };
  if (Math.hypot(trace[1] - run.start[0], trace[2] - run.start[1]) > 6) return { ok: false, why: "start" };
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const [t1, x1, z1, h1] = [trace[i * S], trace[i * S + 1], trace[i * S + 2], trace[i * S + 3]];
    // On a real floor there, and not inside a wall.
    const f = space.floorAt(x1, z1, h1 + 0.3).h;
    if (Math.abs(f - h1) > 0.5 || insideSolid(space, x1, z1, h1)) {
      if (++bad > WALL_SLACK) return { ok: false, why: `walls at ${t1.toFixed(0)} s` };
    }
    if (i === 0) continue;
    const t0 = trace[i * S - S];
    const dt = t1 - t0;
    if (!(dt > 0.2) || dt > 2.5) return { ok: false, why: "gap" };
    const d = Math.hypot(x1 - trace[i * S - S + 1], z1 - trace[i * S - S + 2]);
    if (d > MAX_STEP * dt) return { ok: false, why: `speed ${d.toFixed(1)} m in ${dt.toFixed(1)} s at ${t1.toFixed(0)} s` };
  }
  // The route's checkpoints, every 60 m, in order (only as far as it claims).
  const reached = claim.fin ? run.length : Math.min(run.length, claim.route * run.length);
  let k = 0;
  for (let d = 60; d < reached - 30; d += 60) {
    const p = routeAt(run, d);
    while (k < n && Math.hypot(trace[k * S + 1] - p.x, trace[k * S + 2] - p.z) > 14) k++;
    if (k >= n) return { ok: false, why: `checkpoint ${d} m` };
  }
  if (claim.fin && Math.hypot(trace[(n - 1) * S + 1] - run.finish[0], trace[(n - 1) * S + 2] - run.finish[1]) > SURVIVAL.finish + 4) return { ok: false, why: "finish" };
  // A kill takes a second or so at best.
  if (claim.kills > claim.secs * 1.2 + 5) return { ok: false, why: "kills" };
  return { ok: true, why: "" };
}

export interface BoardEntry {
  secs: number;
  you: boolean;
}

/** The finished runs (best time per player). */
export class RunBoard {
  private readonly db: DatabaseSync;
  private readonly q;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS runs (
        key   TEXT PRIMARY KEY,
        secs  REAL NOT NULL,
        score INTEGER NOT NULL,
        day   TEXT NOT NULL,
        at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS runs_secs ON runs (secs);
      CREATE TABLE IF NOT EXISTS daily (
        key  TEXT NOT NULL,
        day  TEXT NOT NULL,
        secs REAL NOT NULL,
        PRIMARY KEY (key, day)
      );
    `);
    this.q = {
      get: this.db.prepare("SELECT secs FROM runs WHERE key = ?"),
      put: this.db.prepare(
        `INSERT INTO runs (key, secs, score, day, at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET secs = excluded.secs, score = excluded.score, day = excluded.day, at = excluded.at WHERE excluded.secs < runs.secs`,
      ),
      top: this.db.prepare("SELECT key, secs FROM runs ORDER BY secs ASC LIMIT ?"),
      place: this.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE secs < ?"),
      remove: this.db.prepare("DELETE FROM runs WHERE key = ?"),
      dput: this.db.prepare(
        `INSERT INTO daily (key, day, secs) VALUES (?, ?, ?) ON CONFLICT(key, day) DO UPDATE SET secs = excluded.secs WHERE excluded.secs < daily.secs`,
      ),
      dtop: this.db.prepare("SELECT key, secs FROM daily WHERE day = ? ORDER BY secs ASC LIMIT ?"),
      dplace: this.db.prepare("SELECT COUNT(*) AS n FROM daily WHERE day = ? AND secs < (SELECT secs FROM daily WHERE key = ? AND day = ?)"),
      dremove: this.db.prepare("DELETE FROM daily WHERE key = ?"),
    };
  }

  /** A finished run: kept if it's this player's best. Their best and place after. */
  put(key: string, secs: number, score: number, day: string): { best: number; place: number } {
    this.q.put.run(key, secs, score, day, Date.now());
    const best = Number((this.q.get.get(key) as { secs: number }).secs);
    const place = Number((this.q.place.get(best) as { n: number }).n) + 1;
    return { best, place };
  }

  top(key: string | null, n = 10): BoardEntry[] {
    return (this.q.top.all(n) as { key: string; secs: number }[]).map((r) => ({ secs: Number(r.secs), you: r.key === key }));
  }

  /** The Daily Run's board (§3.4 #10): one per UTC day. */
  putDaily(key: string, day: string, secs: number): number {
    this.q.dput.run(key, day, secs);
    return Number((this.q.dplace.get(day, key, day) as { n: number }).n) + 1;
  }

  topDaily(day: string, key: string | null, n = 10): BoardEntry[] {
    return (this.q.dtop.all(day, n) as { key: string; secs: number }[]).map((r) => ({ secs: Number(r.secs), you: r.key === key }));
  }

  remove(key: string): boolean {
    this.q.dremove.run(key);
    return Number(this.q.remove.run(key).changes) > 0;
  }

  close(): void {
    this.db.close();
  }
}
