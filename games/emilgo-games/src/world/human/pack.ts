// The backpack you wear (SPEC-V3 §3.3): one small merged mesh on the chest
// bone, so it follows every lean, crouch and fall. Shared geometry and
// material for every body: a body pays one draw for it, and only when near.

import { BoxGeometry, type BufferGeometry, Mesh, MeshLambertMaterial } from "three";

import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

import { merge, part } from "../geo";

let geo: BufferGeometry | null = null;
let mat: MeshLambertMaterial | null = null;

/** A box with its corners rounded off, the way a stuffed bag's are. */
function soft(w: number, h: number, d: number, r: number): BufferGeometry {
  const g = new BoxGeometry(w, h, d, 3, 4, 2);
  const p = g.attributes.position;
  const ix = w / 2 - r;
  const iy = h / 2 - r;
  const iz = d / 2 - r;
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k);
    const y = p.getY(k);
    const z = p.getZ(k);
    const cx = Math.max(-ix, Math.min(ix, x));
    const cy = Math.max(-iy, Math.min(iy, y));
    const cz = Math.max(-iz, Math.min(iz, z));
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;
    const l = Math.hypot(dx, dy, dz) || 1;
    p.setXYZ(k, cx + (dx / l) * r, cy + (dy / l) * r, cz + (dz / l) * r);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * v5 (the owner: "make it look realistic, it should not be big"): a small
 * everyday backpack in the chest bone's space (metres; the back is −Z): the
 * main body with soft corners, a front pocket, zip lines, a grab handle, side
 * compression straps, and padded straps over the shoulders. About 22 × 30 × 10 cm.
 */
function packGeometry(): BufferGeometry {
  const bag = 0x2b2d30;
  const panel = 0x212326;
  const strap = 0x141516;
  const zip = 0x4a4d52;
  return toCreasedNormals(merge([
    // Main body, snug against the back, and the panel that sits on it.
    part(soft(0.22, 0.3, 0.095, 0.035), bag, { p: [0, -0.02, -0.165] }),
    part(soft(0.19, 0.27, 0.02, 0.008), panel, { p: [0, -0.02, -0.115] }),
    // Front pocket and its zip.
    part(soft(0.17, 0.13, 0.035, 0.014), panel, { p: [0, -0.085, -0.222] }),
    part(new BoxGeometry(0.135, 0.005, 0.004), zip, { p: [0, -0.03, -0.24] }),
    // The main zip, over the top and down both sides.
    part(new BoxGeometry(0.17, 0.004, 0.006), zip, { p: [0, 0.128, -0.165] }),
    part(new BoxGeometry(0.004, 0.2, 0.006), zip, { p: [0.109, 0.02, -0.165] }),
    part(new BoxGeometry(0.004, 0.2, 0.006), zip, { p: [-0.109, 0.02, -0.165] }),
    // Grab handle.
    part(new BoxGeometry(0.06, 0.012, 0.018), strap, { p: [0, 0.146, -0.135] }),
    // Side compression straps.
    part(new BoxGeometry(0.006, 0.014, 0.07), strap, { p: [0.111, -0.05, -0.165] }),
    part(new BoxGeometry(0.006, 0.014, 0.07), strap, { p: [-0.111, -0.05, -0.165] }),
    // Padded straps: over the shoulder, down the chest.
    part(soft(0.042, 0.016, 0.16, 0.006), strap, { p: [0.082, 0.17, -0.055], r: [0.12, 0, 0] }),
    part(soft(0.042, 0.016, 0.16, 0.006), strap, { p: [-0.082, 0.17, -0.055], r: [0.12, 0, 0] }),
    part(new BoxGeometry(0.03, 0.22, 0.012), strap, { p: [0.086, 0.055, 0.125], r: [0.1, 0, 0] }),
    part(new BoxGeometry(0.03, 0.22, 0.012), strap, { p: [-0.086, 0.055, 0.125], r: [0.1, 0, 0] }),
  ]), 0.7);
}

export function packMesh(): Mesh {
  geo ??= packGeometry();
  mat ??= new MeshLambertMaterial({ vertexColors: true });
  const m = new Mesh(geo, mat);
  m.name = "pack";
  m.frustumCulled = false;
  return m;
}
