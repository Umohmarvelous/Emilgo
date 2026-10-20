// Ball Haunting's pens, as you see them (the walls themselves live in
// game/pens.ts, where the referee keeps them solid).
//
// Low roofless enclosures at chest height, one doorway facing the middle of
// the field: block walls with a darker cap in towns, red mud walls in the
// villages and the wild. Corner posts stand a little taller so a pen reads
// from far up the field. About 170 triangles each, one mesh a pen (so only
// the near ones cast shadows), one material for all.

import { BoxGeometry, Mesh, MeshLambertMaterial, MeshStandardMaterial, type Material } from "three";

import type { Course } from "../config";
import { PEN, wallsOf, type Pen } from "../game/pens";
import type { TierSpec } from "../graphics/tiers";
import type { Collider } from "./camera";
import { merge, part } from "./geo";

export type PenStyle = "block" | "mud";

const LOOK: Record<PenStyle, { wall: string; cap: string; post: string }> = {
  block: { wall: "#b7b2a8", cap: "#8c877d", post: "#6e6a63" },
  mud: { wall: "#a8683f", cap: "#7c4a2a", post: "#5b3a22" },
};

export interface PenMeshes {
  meshes: { mesh: Mesh; z: number }[];
  /** The walls, for the camera (it mustn't pass through them). */
  colliders: Collider[];
  material: Material;
}

export function buildPens(course: Course, style: PenStyle, spec: TierSpec): PenMeshes {
  const look = LOOK[style];
  const box = new BoxGeometry(1, 1, 1);
  const material = spec.pbr ? new MeshStandardMaterial({ vertexColors: true, roughness: 0.93 }) : new MeshLambertMaterial({ vertexColors: true });
  const h = PEN.height;
  const partsOf = (pen: Pen) => {
    const parts = [];
    for (const w of wallsOf([pen])) {
      // The wall (a little into the ground, so no gap shows on uneven sand), and a cap on top.
      parts.push(part(box, look.wall, { p: [w.x, (h - 0.1) / 2, w.z], s: [w.hx * 2, h + 0.1, w.hz * 2] }, 0.94 + ((Math.abs(w.x * 7 + w.z * 3) % 1) * 0.1)));
      parts.push(part(box, look.cap, { p: [w.x, h + 0.04, w.z], s: [w.hx * 2 + 0.06, 0.08, w.hz * 2 + 0.06] }));
    }
    // Corner posts, and one each side of the door.
    const o = PEN.size / 2 + PEN.wall / 2;
    const door = pen.x - pen.side * o;
    for (const [px, pz] of [
      [pen.x + o, pen.z + o],
      [pen.x + o, pen.z - o],
      [pen.x - o, pen.z + o],
      [pen.x - o, pen.z - o],
      [door, pen.z + PEN.door / 2 + 0.12],
      [door, pen.z - PEN.door / 2 - 0.12],
    ]) {
      parts.push(part(box, look.post, { p: [px, (h + 0.3) / 2, pz], s: [0.34, h + 0.3, 0.34] }));
    }
    return parts;
  };
  const groups: { parts: ReturnType<typeof partsOf>; z: number }[] = spec.shadows
    ? course.pens.map((pen) => ({ parts: partsOf(pen), z: pen.z }))
    : [{ parts: course.pens.flatMap(partsOf), z: course.pens.reduce((a, p) => a + p.z, 0) / Math.max(1, course.pens.length) }];
  const meshes = groups.map(({ parts, z }) => {
    const mesh = new Mesh(merge(parts), material);
    mesh.castShadow = spec.shadows;
    mesh.receiveShadow = spec.shadows;
    mesh.name = "pen";
    return { mesh, z };
  });
  const colliders: Collider[] = wallsOf(course.pens).map((w) => ({ x: w.x, z: w.z, hx: w.hx, hz: w.hz, h: h + 0.1 }));
  return { meshes, colliders, material };
}
