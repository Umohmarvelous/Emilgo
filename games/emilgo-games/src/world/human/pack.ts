// The backpack you wear (SPEC-V3 §3.3): one small merged mesh on the chest
// bone, so it follows every lean, crouch and fall. Shared geometry and
// material for every body: a body pays one draw for it, and only when near.

import { type BufferGeometry, BoxGeometry, Mesh, MeshLambertMaterial } from "three";

import { merge, part } from "../geo";

let geo: BufferGeometry | null = null;
let mat: MeshLambertMaterial | null = null;

/** A daypack in the chest bone's space (metres; the back is −Z): bag, flap, pocket and the straps over the shoulders. */
function packGeometry(): BufferGeometry {
  // v4 rework: charcoal to go with the black suit, a slimmer assault pack close to the back.
  const bag = 0x26282b;
  const dark = 0x18191b;
  const strap = 0x0f1011;
  return merge([
    part(new BoxGeometry(0.27, 0.36, 0.11), bag, { p: [0, -0.03, -0.18] }),
    part(new BoxGeometry(0.28, 0.1, 0.12), dark, { p: [0, 0.13, -0.185], r: [-0.12, 0, 0] }),
    part(new BoxGeometry(0.2, 0.14, 0.04), dark, { p: [0, -0.1, -0.255] }),
    part(new BoxGeometry(0.05, 0.03, 0.2), strap, { p: [0.09, 0.2, -0.07] }),
    part(new BoxGeometry(0.05, 0.03, 0.2), strap, { p: [-0.09, 0.2, -0.07] }),
    part(new BoxGeometry(0.045, 0.3, 0.025), strap, { p: [0.1, 0.05, 0.13], r: [0.1, 0, 0] }),
    part(new BoxGeometry(0.045, 0.3, 0.025), strap, { p: [-0.1, 0.05, 0.13], r: [0.1, 0, 0] }),
  ]);
}

export function packMesh(): Mesh {
  geo ??= packGeometry();
  mat ??= new MeshLambertMaterial({ vertexColors: true });
  const m = new Mesh(geo, mat);
  m.name = "pack";
  m.frustumCulled = false;
  return m;
}
