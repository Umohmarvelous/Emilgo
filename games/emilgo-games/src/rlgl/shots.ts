// Red Light, Green Light's field preview (SPEC-V2 §1.3), after the walk:
// four sweeping angles of the arena, the eye in the sky close up, the balls
// and baskets (Ball Haunting only), along the field's edge, then back behind
// the players.
//
// Lengths come from FLOW (config.ts): the referee times the walkout with the
// same numbers, so every phone cuts at the same moment.

import { Vector3 } from "three";

import { FLOW, type Course } from "../config";
import type { Ball, Basket } from "../game/balls";
import { dolly, follow, orbit, smooth, type Frame, type Shot } from "../flow/cinema";

export interface FieldInfo {
  course: Course;
  balls: readonly Ball[];
  baskets: readonly Basket[];
  /** The watcher's eye in the sky (Phase 11: Mama is gone), in the world. */
  dollFace(out: Vector3): Vector3;
}

const _face = new Vector3();

export function previewShots(f: FieldInfo): Shot[] {
  const c = f.course;
  const hw = c.halfWidth;
  const fz = c.finishZ;
  const s = FLOW.sweep;
  const shots: Shot[] = [
    // 1. High along the field from behind the start, the whole run below.
    dolly(s, [-hw - 6, 16, 6], [hw + 2, 24, fz * 0.3], [0, 0, fz * 0.4], [0, 0, fz * 0.65], 55),
    // 2. Low down the left side, the field going by.
    dolly(s, [-hw - 9, 3.4, fz * 0.18], [-hw - 8, 4, fz * 0.62], [0, 1.4, fz * 0.32], [0, 1.6, fz * 0.85], 50),
    // 3. Round the far end: the line, and the sky over it.
    orbit(s, [0, 0, fz * 0.92], hw + 22, -0.9, 0.6, 18, 12, 2, 50),
    // 4. From beyond the line, looking all the way back to the start.
    dolly(s, [hw * 0.7, 7, fz - 4], [-hw * 0.5, 4.5, fz + 12], [0, 1.2, fz * 0.5], [0, 1.2, 0], 48),
    // The eye in the sky: from past the line, looking up at it, pushing in.
    follow(FLOW.sky, (u, out) => {
      const face = f.dollFace(_face);
      const e = smooth(u);
      out.pos.set(face.x + 14 - e * 8, 6 + e * 3, face.z + 150 - e * 30);
      out.look.set(face.x, face.y, face.z);
      out.fov = 34 - e * 8;
    }),
  ];
  if (c.mode === "balls" && f.balls.length) {
    // The balls where they lie: low behind the nearest one, pushing in, the rest up the field beyond it.
    // Then the baskets past the line.
    let first = f.balls[0];
    for (const b of f.balls) if (b.z > first.z) first = b;
    const half = FLOW.balls / 2;
    const side = first.x > 0 ? -1 : 1;
    shots.push(
      dolly(
        half,
        [first.x + side * 0.7, 0.6, first.z + 2.6],
        [first.x + side * 0.35, 0.45, first.z + 1.3],
        [first.x - side * 0.3, 0.05, first.z - 6],
        [first.x - side * 0.5, 0.08, first.z - 9],
        40,
      ),
    );
    const bz = f.baskets[0]?.z ?? fz - 2.4;
    shots.push(dolly(half, [hw * 0.5, 2.2, bz + 7], [-hw * 0.2, 1.8, bz + 4.5], [0, 0.4, bz], [0, 0.35, bz], 42));
  }
  // Along the field's edge, the run ahead (the towers were here before the sky laser).
  shots.push(dolly(FLOW.edge, [hw + 3, 6, -6], [hw, 7, -10], [hw + 2.6, 7, -12], [hw + 2.6, 7, -40], 44));
  return shots;
}

/** Back behind the players: from above the field down into the game's own camera spot. */
export function behindShot(rest: (pos: Vector3, look: Vector3) => number): Shot {
  const p = new Vector3();
  const l = new Vector3();
  return follow(FLOW.behind, (u, out: Frame) => {
    const fov = rest(p, l);
    const e = smooth(u);
    out.pos.set(p.x, p.y + (1 - e) * 7, p.z + (1 - e) * 6);
    out.look.copy(l);
    out.fov = fov;
  });
}

// ── Elimination and highlights (SPEC-V2 §2.7–2.9) ───────────────────────────

const _mid = new Vector3();
const _dir = new Vector3();

/**
 * The kill cam's lens: from the eye in the sky's side — up the line from the
 * runner toward the eye, 16 m out — looking down at them. It starts wide
 * enough to see them run and closes in as the sky laser strikes (u: 0 … 1 of
 * the replay). (The eye itself is 200 m and more away: filmed from there, a
 * runner was a few pixels behind the beams.)
 */
export function killCamLens(eyes: (l: Vector3, r: Vector3) => void, chest: Vector3, u: number, pos: Vector3, look: Vector3): number {
  eyes(_mid, _dir);
  _mid.add(_dir).multiplyScalar(0.5);
  _dir.subVectors(_mid, chest).normalize();
  const e = smooth(Math.min(1, u * 1.25));
  pos.copy(chest).addScaledVector(_dir, 16 - e * 7);
  look.copy(chest);
  return 40 - e * 12;
}

/**
 * The play of the game's lens: low beside the runner, a little ahead of them,
 * turning slowly round them as the moment plays (u: 0 … 1). `side` picks the
 * side with the open field.
 */
export function potgLens(chest: Vector3, u: number, side: number, pos: Vector3, look: Vector3): number {
  const a = side * (1.25 - 0.7 * smooth(u));
  const r = 4.2 - 0.9 * smooth(u);
  pos.set(chest.x + Math.sin(a) * r, Math.max(0.6, chest.y + 0.25), chest.z - Math.cos(a) * r);
  look.set(chest.x, chest.y - 0.1, chest.z);
  return 42;
}

/**
 * Two runners left (§2.8), seen from outside: side by side in the frame (the
 * lens square on to the line between them, from the start's side), far enough
 * back for both, closing in.
 */
export function finalTwoLens(a: Vector3, b: Vector3, u: number, pos: Vector3, look: Vector3): number {
  _mid.addVectors(a, b).multiplyScalar(0.5);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const span = Math.max(1.5, Math.hypot(dx, dz));
  let px = -dz / span;
  let pz = dx / span;
  if (pz < 0 || (Math.abs(pz) < 1e-3 && px * _mid.x > 0)) {
    px = -px;
    pz = -pz;
  }
  const fov = 44;
  // Wide enough for both (the frame is wider than tall), with room round them.
  const r = Math.max(5, Math.min(34, (span * 0.62) / Math.tan(((fov / 2) * Math.PI) / 180) + 3.5)) * (1 - 0.18 * smooth(u));
  pos.set(_mid.x + px * r, 1.5 + r * 0.1, _mid.z + pz * r);
  look.set(_mid.x, 1.0, _mid.z);
  return fov;
}

