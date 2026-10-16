// Where each body part lives on a person's texture (UV space, v = 0 at the
// bottom). The mesh builder writes UVs into these rectangles and the painter
// paints into the same rectangles, so the two never disagree.
//
// The head gets a quarter of the texture, and inside it the FACE gets most of
// that: UVs are bunched towards the front (headU/headV), like a lens, so eyes
// and lips have real pixels even on a 512 texture.

export type Rect = readonly [u0: number, v0: number, u1: number, v1: number];

export const UV: Record<"torso" | "head" | "armL" | "armR" | "legL" | "legR" | "skirt" | "hair" | "palette", Rect> = {
  torso: [0, 0.5, 0.5, 1],
  head: [0.5, 0.5, 1, 1],
  legL: [0, 0, 0.25, 0.5],
  legR: [0.25, 0, 0.5, 0.5],
  armL: [0.5, 0.25, 0.625, 0.5],
  armR: [0.625, 0.25, 0.75, 0.5],
  skirt: [0.75, 0.25, 1, 0.5],
  hair: [0.5, 0.125, 0.75, 0.25],
  palette: [0.75, 0.125, 1, 0.25],
};

/** Solid-colour cells in the palette block (8 × 4). */
export const CELL = {
  skin: 0,
  lips: 1,
  shoe: 2,
  sole: 3,
  gold: 4,
  metal: 5,
  black: 6,
  white: 7,
  lensDark: 8,
  hair: 9,
  vest: 10,
  gloves: 11,
  pads: 12,
  belt: 13,
  cap: 14,
  gele: 15,
  headset: 16,
  strap: 17,
  skinDark: 18,
  nail: 19,
  pouch: 20,
  geleShine: 21,
  capFold: 22,
  laces: 23,
} as const;

export const PALETTE_COLS = 8;
export const PALETTE_ROWS = 4;

/** UV of a palette cell's centre. */
export function cellUv(cell: number): [number, number] {
  const [u0, v0, u1, v1] = UV.palette;
  const c = cell % PALETTE_COLS;
  const r = Math.floor(cell / PALETTE_COLS);
  return [u0 + ((c + 0.5) / PALETTE_COLS) * (u1 - u0), v0 + ((r + 0.5) / PALETTE_ROWS) * (v1 - v0)];
}

/**
 * Head grid per detail level (mesh.ts Detail: far, Low, Medium, High): rings
 * pole to pole, vertices around (even: the face centre is a column). A tier's
 * texture is painted for its NEAR level (tier + 1); the far level only ever
 * shows at a distance, where a small misfit of the face can't be seen.
 */
export const HEAD_GRID: readonly (readonly [rings: number, seg: number])[] = [
  [7, 10],
  [10, 14],
  [14, 20],
  [18, 24],
];

/** Polar angle kept off the poles by the head blob (radians). */
export const HEAD_EPS = 0.06;

const KU = 2.0;
const KV = 2.4;
const EV0 = -0.15; // the face's vertical centre (elevation, radians)

/** 0..1 across the head region for an angle round the head measured from the BACK (0..2π). */
export function headWarpU(phi: number): number {
  const az = phi - Math.PI;
  return 0.5 + Math.atan(KU * az) / (2 * Math.atan(KU * Math.PI));
}

/** 0..1 up the head region for an elevation (−π/2 chin pole … +π/2 crown). */
export function headWarpV(el: number): number {
  const f = (e: number) => Math.atan(KV * (e - EV0));
  return (f(el) - f(-Math.PI / 2)) / (f(Math.PI / 2) - f(-Math.PI / 2));
}

/** Ring parameter t (0 bottom … 1 top) of the head blob → elevation. */
export function headElevation(t: number): number {
  const th = Math.PI - HEAD_EPS - t * (Math.PI - 2 * HEAD_EPS);
  return Math.PI / 2 - th;
}
