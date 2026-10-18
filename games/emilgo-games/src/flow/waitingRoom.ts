// The waiting room (SPEC-V2 §1.2), for every game: everyone's model in full,
// standing on the ground — all in a circle for a free-for-all, or teammates on
// one side and opponents on the other for team games. You stand at the front.
// Ready marks and text chat go over it (ui/screens.ts room()). No voice chat:
// the Lagos Life frame has no microphone.
//
// Layout only (positions and facings); the lobby stage draws the people.

export interface Spot {
  x: number;
  z: number;
  /** Rotation about Y (0 = facing the camera, +Z). */
  facing: number;
}

/** How wide the circle is for n people (about a metre between neighbours). */
export function circleRadius(n: number): number {
  return Math.max(1.4, (n * 0.95) / (Math.PI * 2));
}

/**
 * n spots round a circle whose front point is (0, 0) — yours. Everyone turns
 * part way from the circle's centre towards the camera, so faces show all round.
 */
export function circleSpots(n: number): Spot[] {
  const r = circleRadius(n);
  const out: Spot[] = [];
  for (let i = 0; i < n; i++) {
    // Alternate left and right from the front, so a small room stays near you.
    const k = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 ? 1 : -1);
    const a = (k / n) * Math.PI * 2;
    const x = Math.sin(a) * r;
    const z = -r + Math.cos(a) * r;
    // In towards the centre, then most of the way round to the camera.
    const inX = -x;
    const inZ = -r - z;
    const l = Math.hypot(inX, inZ) || 1;
    const dx = (inX / l) * 0.35;
    const dz = (inZ / l) * 0.35 + 0.65;
    out.push({ x, z, facing: i === 0 ? 0 : Math.atan2(dx, dz) });
  }
  return out;
}

/** Team games: your side on the left, theirs on the right, in two short lines facing the camera. */
export function sideSpots(mine: number, theirs: number): Spot[] {
  const line = (n: number, cx: number, turn: number): Spot[] =>
    Array.from({ length: n }, (_, i) => {
      const row = Math.floor(i / 5);
      const col = i % 5;
      return { x: cx + (col - Math.min(4, n - 1) / 2) * 0.9 + row * 0.45, z: -row * 1.1, facing: turn };
    });
  return [...line(mine, -2.8, 0.25), ...line(theirs, 2.8, -0.25)];
}
