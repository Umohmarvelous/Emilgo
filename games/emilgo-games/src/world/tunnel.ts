// The walkout walkway (SPEC-V2 §1.3): a plain concrete tunnel behind the
// start, its mouth facing the field, and a dark rubber strip from the mouth to
// the start line. The players file out of it in their black suits before every
// round. Nothing else: no lights, flags or banners (§1.3 "Do NOT add").
//
// One merged, vertex-coloured mesh on every map (≈ 300 triangles). It stands
// behind the start, where the runners never go (FIELD.backLimitZ).

import { BoxGeometry, Mesh, MeshLambertMaterial, MeshStandardMaterial } from "three";

import type { TierSpec } from "../graphics/tiers";
import { merge, part } from "./geo";

export const TUNNEL = {
  /** The mouth, facing the field (−Z). */
  mouthZ: 12,
  /** How far back it runs. */
  depth: 16,
  /** Inside width and height. */
  width: 6,
  height: 3.6,
} as const;

const WALL = 0.6;

export function buildTunnel(spec: TierSpec): Mesh {
  const { mouthZ, depth, width, height } = TUNNEL;
  const cz = mouthZ + depth / 2;
  const box = new BoxGeometry(1, 1, 1);
  const concrete = "#8d8a84";
  const dark = "#1c1d20";
  const parts = [
    // Side walls and the roof slab (down into the ground, so hills never show a gap).
    ...[-1, 1].map((s) => part(box, concrete, { p: [s * (width / 2 + WALL / 2), (height - 0.6) / 2, cz], s: [WALL, height + 0.6, depth] })),
    part(box, concrete, { p: [0, height + 0.25, cz], s: [width + WALL * 2, 0.5, depth] }),
    // The portal round the mouth, a step proud of the walls.
    ...[-1, 1].map((s) => part(box, "#6f6c67", { p: [s * (width / 2 + 0.45), (height + 0.2) / 2 - 0.1, mouthZ - 0.2], s: [0.9, height + 0.4, 0.5] })),
    part(box, "#6f6c67", { p: [0, height + 0.45, mouthZ - 0.2], s: [width + 1.8, 0.9, 0.5] }),
    // Inside: dark walls and floor, a back wall so it never shows daylight through.
    ...[-1, 1].map((s) => part(box, dark, { p: [s * (width / 2 - 0.02), height / 2, cz], s: [0.04, height, depth - 0.2] })),
    part(box, dark, { p: [0, height - 0.02, cz], s: [width, 0.04, depth - 0.2] }),
    part(box, dark, { p: [0, height / 2, mouthZ + depth - 0.3], s: [width, height, 0.1] }),
    part(box, "#2a2b2e", { p: [0, 0.006, cz], s: [width, 0.012, depth] }),
    // The walkway out to the start line.
    part(box, "#2a2b2e", { p: [0, 0.008, (mouthZ + 9) / 2], s: [3.2, 0.016, mouthZ - 9] }),
    ...[-1, 1].map((s) => part(box, "#d9d6cf", { p: [s * 1.66, 0.009, (mouthZ + 9) / 2], s: [0.08, 0.018, mouthZ - 9] })),
  ];
  const mat = spec.pbr ? new MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }) : new MeshLambertMaterial({ vertexColors: true });
  const mesh = new Mesh(merge(parts), mat);
  mesh.castShadow = spec.shadows;
  mesh.receiveShadow = spec.shadows;
  mesh.name = "tunnel";
  return mesh;
}
