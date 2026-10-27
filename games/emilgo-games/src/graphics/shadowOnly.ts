// Shadow stand-ins: meshes that cast a shadow and draw nothing on screen.

import { MeshBasicMaterial, type BufferGeometry, type Mesh } from "three";

/**
 * A shadow-only layer won't do: three's shadow pass draws only what the screen
 * camera's layers see. So a stand-in stays on layer 0, and every screen pass
 * (the view, the puddle mirror) draws an empty range of it. The shadow pass
 * calls onBeforeShadow, not onBeforeRender, so it draws the whole mesh with
 * its own depth material.
 */
const SHADOW_ONLY = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });

function hide(this: Mesh, _r: unknown, _s: unknown, _c: unknown, g: BufferGeometry): void {
  this.userData.drawCount = g.drawRange.count;
  g.drawRange.count = 0;
}

function show(this: Mesh, _r: unknown, _s: unknown, _c: unknown, g: BufferGeometry): void {
  g.drawRange.count = this.userData.drawCount ?? Infinity;
}

/** Make a mesh a shadow stand-in (its geometry may be shared with meshes that draw). */
export function shadowOnly<T extends Mesh>(m: T): T {
  m.material = SHADOW_ONLY;
  m.onBeforeRender = hide;
  m.onAfterRender = show;
  return m;
}
