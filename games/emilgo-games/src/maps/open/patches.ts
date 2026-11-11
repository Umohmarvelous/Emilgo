// The ground's patches (v6 max, 3.4): where grass gives way to bare earth.
//
// The worlds used to pick them on a lattice ((⌊x/11⌋ + ⌊z/9⌋) mod 5 and the like): hard-edged blocks in rows, a
// chessboard seen from any height. Here, value noise in two octaves: soft-edged blobs of every size and shape,
// a given share of the ground. Pure integer hashing and arithmetic, so the server and every phone place them
// alike (zip lines land off the grass: matchWorld.ts).

function hash(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function noise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  let fx = x - ix;
  let fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed);
  const b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed);
  const d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** The patch field at x, z: blobs about `size` m across with ragged edges, 0…1. */
export function patchField(x: number, z: number, size: number, seed: number): number {
  return 0.66 * noise(x / size, z / size, seed) + 0.34 * noise(x / (size * 0.3) + 17.3, z / (size * 0.3) - 9.1, seed + 7);
}

// The field's value above which a share of the ground lies (measured once over 6 km square; the same at any size).
const QUANT: [number, number][] = [
  [0.2, 0.6427],
  [0.25, 0.6156],
  [0.333, 0.575],
  [0.667, 0.4253],
  [0.75, 0.3843],
  [0.8, 0.357],
];

/** Is x, z in a patch: `share` of the ground (0.2, 0.25, 1/3, 2/3, 0.75 or 0.8) is. */
export function inPatch(x: number, z: number, size: number, share: number, seed: number): boolean {
  let t = 0.5;
  for (const [s, q] of QUANT) if (Math.abs(s - share) < 0.01) t = q;
  return patchField(x, z, size, seed) > t;
}
