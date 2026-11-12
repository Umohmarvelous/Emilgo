// v7 (H5): a trapped chest's flare. Opened, a trapped chest fires a red flare
// 30 m straight up: it climbs in about a second on a smoking trail, hangs
// there burning and flickering for the rest of its 6 s, drifting down a little,
// and goes out. Seen by everyone near: the point is that the whole area knows
// someone is at that chest.
//
// No light is added (a new light recompiles every lit material): the flare is
// additive sprites and one trail tube each, a few at most, only while burning.

import {
  AdditiveBlending,
  type Blending,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type Texture,
  type Vector3,
} from "three";

/** How high the flare climbs, how long it burns (the brief: 30 m, 6 s), how long the climb takes. */
export const FLARE_HEIGHT = 30;
export const FLARE_SECONDS = 6;
const CLIMB = 1.1;
/** At most this many burning at once (a rare thing; an older one gives way). */
const MAX = 4;

let glowTex: Texture | null = null;
let trailTex: Texture | null = null;

/** A soft round glow: white-hot in the middle, red at the edge. */
function glow(): Texture {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,250,235,1)");
  r.addColorStop(0.18, "rgba(255,120,90,0.95)");
  r.addColorStop(0.45, "rgba(230,30,20,0.45)");
  r.addColorStop(1, "rgba(120,0,0,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  glowTex = new CanvasTexture(c);
  glowTex.colorSpace = SRGBColorSpace;
  return glowTex;
}

/** The trail: brightest at the top (just behind the flare), gone at the bottom. */
function trail(): Texture {
  if (trailTex) return trailTex;
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createLinearGradient(0, 0, 0, 64);
  r.addColorStop(0, "rgba(235,40,25,0.85)");
  r.addColorStop(0.3, "rgba(170,30,25,0.4)");
  r.addColorStop(1, "rgba(110,30,30,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 4, 64);
  trailTex = new CanvasTexture(c);
  trailTex.colorSpace = SRGBColorSpace;
  return trailTex;
}

interface Flare {
  x: number;
  y: number;
  z: number;
  at: number;
  head: Sprite;
  halo: Sprite;
  tube: Mesh;
}

export class TrapFlares {
  readonly group = new Group();
  private readonly live: Flare[] = [];
  private readonly spare: Flare[] = [];
  private tubeGeo: CylinderGeometry | null = null;

  /** Fire one from the ground at (x, y, z), now (`time`: the view's clock). */
  fire(x: number, y: number, z: number, time: number): void {
    if (this.live.length >= MAX) this.retire(this.live[0]);
    const f = this.spare.pop() ?? this.make();
    f.x = x;
    f.y = y;
    f.z = z;
    f.at = time;
    this.group.add(f.head, f.halo, f.tube);
    this.live.push(f);
  }

  /** Every frame (`cam`: the camera, so a far flare keeps a size you can see). */
  update(time: number, cam: Vector3): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i];
      const t = time - f.at;
      if (t >= FLARE_SECONDS) {
        this.retire(f);
        continue;
      }
      // Up fast, slowing at the top; then a slow drift down while it burns.
      const u = Math.min(1, t / CLIMB);
      const up = 1 - (1 - u) * (1 - u) * (1 - u);
      const top = f.y + 1 + (FLARE_HEIGHT - 1) * up - Math.max(0, t - CLIMB) * 0.5;
      const flick = 0.82 + 0.18 * Math.sin(t * 37) * Math.sin(t * 23 + 1.3);
      const fade = Math.min(1, (FLARE_SECONDS - t) / 0.6);
      f.head.position.set(f.x, top, f.z);
      // Far off it still reads: never smaller on screen than it is at 45 m.
      const far = Math.max(1, Math.hypot(f.x - cam.x, top - cam.y, f.z - cam.z) / 45);
      f.head.scale.setScalar(2.6 * flick * far);
      (f.head.material as SpriteMaterial).opacity = fade;
      f.halo.position.copy(f.head.position);
      f.halo.scale.setScalar((11 + 3 * Math.sin(t * 9)) * flick * far);
      (f.halo.material as SpriteMaterial).opacity = 0.55 * fade;
      // The trail: from the chest to the flare, thinning as its smoke clears.
      const len = Math.max(0.1, top - f.y);
      f.tube.position.set(f.x, f.y, f.z);
      f.tube.scale.set(Math.min(far, 3), len, Math.min(far, 3));
      (f.tube.material as MeshBasicMaterial).opacity = 0.7 * Math.max(0, 1 - t / FLARE_SECONDS) * fade;
    }
  }

  dispose(): void {
    for (const f of [...this.live, ...this.spare]) {
      (f.head.material as SpriteMaterial).dispose();
      (f.halo.material as SpriteMaterial).dispose();
      (f.tube.material as MeshBasicMaterial).dispose();
    }
    this.tubeGeo?.dispose();
    this.live.length = 0;
    this.spare.length = 0;
  }

  private retire(f: Flare): void {
    const i = this.live.indexOf(f);
    if (i >= 0) this.live.splice(i, 1);
    f.head.removeFromParent();
    f.halo.removeFromParent();
    f.tube.removeFromParent();
    this.spare.push(f);
  }

  private make(): Flare {
    // The core adds light; the halo and the trail are drawn over (a red that stays red against a bright sky).
    const sprite = (opacity: number, blending: Blending) => {
      const s = new Sprite(new SpriteMaterial({ map: glow(), blending, depthWrite: false, transparent: true, opacity, fog: false }));
      s.frustumCulled = false;
      s.renderOrder = 5;
      return s;
    };
    // A thin open tube, its base at 0 and its top at 1 (scaled to the climb); UV v runs up it.
    this.tubeGeo ??= new CylinderGeometry(0.3, 0.7, 1, 8, 1, true).translate(0, 0.5, 0);
    const tube = new Mesh(
      this.tubeGeo,
      new MeshBasicMaterial({ map: trail(), blending: NormalBlending, depthWrite: false, transparent: true, side: DoubleSide, fog: false }),
    );
    // (The texture's top, bright, lands at the tube's top: a cylinder's v is 1 there.)
    tube.frustumCulled = false;
    return { x: 0, y: 0, z: 0, at: 0, head: sprite(1, AdditiveBlending), halo: sprite(0.5, NormalBlending), tube };
  }
}
