// Billboard slots (SPEC-V3 §8): the boards are prefabs in the layout. A
// unipole on its own patch of ground: one steel pole and the panel up top,
// both solid, so the server and every phone build the same city. The boards
// go in last, on ground nothing else wanted, and their solids go on the end
// of the list: the rest of the city is exactly as it was (indices too).
//
// Each slot has a stable id ("nw-03", the wish's place in its list): an
// advertiser books a slot by it, and the phone reports seconds on screen per
// slot. New wishes go on the end of a list, never in the middle. What a board shows is the
// phone's business (world/billboards.ts), never the layout's.

import type { Solid } from "../../game/core/space";
import { BOARD_DEPTH, BOARD_SIZE, PORTRAIT_SIZE, solidsOf, type Placement } from "./prefabs";

export { BOARD_DEPTH, BOARD_SIZE, PORTRAIT_SIZE };

/** A turned rectangle (naija.ts's Rect), and the taken ground it is checked against. */
interface Rect {
  x: number;
  z: number;
  hx: number;
  hz: number;
  c: number;
  s: number;
}

interface Ground {
  free(t: Rect): boolean;
  add(t: Rect): void;
}

const rectOf = (x: number, z: number, w: number, d: number, rot: number): Rect => ({ x, z, hx: w / 2, hz: d / 2, c: Math.cos(rot), s: Math.sin(rot) });

export type BoardKind = "road" | "landmark" | "plaza" | "route" | "zone";

export interface BoardSlot {
  /** Stable name: the map's prefix and a number ("nw-03"). Bookings and reports use it. */
  id: string;
  x: number;
  z: number;
  /** The face looks along world (sin rot, cos rot). */
  rot: number;
  /** The face: width, height, and its bottom edge above the ground (m). */
  w: number;
  h: number;
  y: number;
  /** Why it stands there. */
  kind: BoardKind;
  /** Sold as a premium static slot (outside the rotation). */
  premium: boolean;
  /** v6 max (3.6): a face on the back too (the same ad, seen both ways). */
  back: boolean;
  /** v6 max (3.6): a tall portrait LED tower, lit at night. */
  portrait: boolean;
}

/** Where a board is wanted: near (x, z), facing (fx, fz). */
export interface BoardWish {
  x: number;
  z: number;
  fx: number;
  fz: number;
  kind: BoardKind;
  premium?: boolean;
  /** How far from (x, z) to look for free ground (m). */
  r?: number;
  /** v6 max (3.6): a portrait LED tower (lit at night). Roadside boards are two-sided (traffic both ways). */
  portrait?: boolean;
}

/** No two boards closer than this (m). */
const APART = 16;

/** Does any solid that stands in the way (above `above`) overlap this turned rectangle? */
function solidIn(solids: readonly Solid[], x: number, z: number, hx: number, hz: number, rot: number, above: number): boolean {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const r = Math.hypot(hx, hz);
  for (const o of solids) {
    if (o.kind === "pit" || o.y1 <= above) continue;
    const or = Math.hypot(o.hx, o.hz);
    if (Math.abs(o.x - x) > r + or || Math.abs(o.z - z) > r + or) continue;
    // Separating axes: the two rectangles' own.
    const oc = Math.cos(o.rot);
    const os = Math.sin(o.rot);
    let apart = false;
    for (const [ax, az] of [[c, -s], [s, c], [oc, -os], [os, oc]] as const) {
      const pa = Math.abs(hx * (c * ax - s * az)) + Math.abs(hz * (s * ax + c * az));
      const pb = Math.abs(o.hx * (oc * ax - os * az)) + Math.abs(o.hz * (os * ax + oc * az));
      if (Math.abs((o.x - x) * ax + (o.z - z) * az) > pa + pb) {
        apart = true;
        break;
      }
    }
    if (!apart) return true;
  }
  return false;
}

/**
 * Put up the boards: for each wish, the nearest free ground (a spiral out
 * from it), with the pole's foot and the panel's shadow both clear of
 * everything placed, of anything solid, of the starts in `avoid`, and of the
 * other boards. A wish with no room is skipped. Placements and solids are
 * appended; the taken ground is marked.
 */
export function placeBoards(
  prefix: string,
  wishes: readonly BoardWish[],
  variant: 0 | 1,
  half: number,
  taken: Ground,
  placements: Placement[],
  solids: Solid[],
  avoid: readonly (readonly [number, number])[],
): BoardSlot[] {
  const out: BoardSlot[] = [];
  // What was solid before the boards (each board checks against these and the boards before it).
  const before = solids.slice();
  let size: { w: number; h: number; y: number } = BOARD_SIZE[variant];
  const fits = (x: number, z: number, rot: number): boolean => {
    if (Math.abs(x) > half - 8 || Math.abs(z) > half - 8) return false;
    if (out.some((b) => Math.hypot(b.x - x, b.z - z) < APART)) return false;
    if (avoid.some(([ax, az]) => Math.hypot(ax - x, az - z) < 5)) return false;
    // The pole's foot, and the ground under the panel (nothing tall under a board 5 m up, no tree in it).
    if (!taken.free(rectOf(x, z, 1.4, 1.4, rot))) return false;
    if (!taken.free(rectOf(x, z, size.w + 0.8, 1.6, rot))) return false;
    if (solidIn(before, x, z, 0.7, 0.7, rot, -0.2)) return false;
    return !solidIn(before, x, z, size.w / 2 + 0.4, 0.8, rot, size.y - 1.5);
  };
  for (let k = 0; k < wishes.length; k++) {
    const w = wishes[k];
    const r = w.r ?? 14;
    size = w.portrait ? PORTRAIT_SIZE : BOARD_SIZE[variant];
    // Roadside boards are seen by traffic both ways, and a tower from all round: a face on each side.
    const back = !!w.portrait || w.kind === "road";
    let got: [number, number, number] | null = null;
    for (let ring = 0; ring <= r && !got; ring += 1.5) {
      const n = ring === 0 ? 1 : Math.max(6, Math.round((ring * Math.PI * 2) / 1.5));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = w.x + Math.cos(a) * ring;
        const z = w.z + Math.sin(a) * ring;
        const rot = Math.atan2(w.fx - x, w.fz - z);
        if (fits(x, z, rot)) {
          got = [x, z, rot];
          break;
        }
      }
    }
    if (!got) continue;
    const [x, z, rot] = got;
    const p: Placement = { prefab: "billboard", x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, rot: Math.round(rot * 1000) / 1000, v: variant | (back ? 2 : 0) | (w.portrait ? 4 : 0) };
    placements.push(p);
    solidsOf(p, solids);
    taken.add(rectOf(p.x, p.z, size.w + 0.8, 1.6, p.rot));
    // The id is the wish's place in the list (bookings use it): a wish with no room leaves a gap, and moves nothing.
    out.push({ id: `${prefix}-${String(k + 1).padStart(2, "0")}`, x: p.x, z: p.z, rot: p.rot, w: size.w, h: size.h, y: size.y, kind: w.kind, premium: !!w.premium, back, portrait: !!w.portrait });
  }
  return out;
}

/** The face's middle in world axes, and its normal. */
export function faceOf(b: BoardSlot): { x: number; y: number; z: number; nx: number; nz: number } {
  return sideOf(b, 1);
}

/** v6 max (3.6): every face a board has: the front, and the back of a two-sided board (facing the other way). */
export function facesOf(b: BoardSlot): { x: number; y: number; z: number; nx: number; nz: number; back: boolean }[] {
  const out = [{ ...sideOf(b, 1), back: false }];
  if (b.back) out.push({ ...sideOf(b, -1), back: true });
  return out;
}

function sideOf(b: BoardSlot, s: 1 | -1): { x: number; y: number; z: number; nx: number; nz: number } {
  const nx = Math.sin(b.rot) * s;
  const nz = Math.cos(b.rot) * s;
  // The portrait tower's case is deeper (prefabs' solids, art's case).
  const off = (b.portrait ? BOARD_DEPTH + 0.2 : BOARD_DEPTH) / 2 + 0.02;
  return { x: b.x + nx * off, y: b.y + b.h / 2, z: b.z + nz * off, nx, nz };
}
