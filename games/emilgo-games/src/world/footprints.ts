// Footprints (SPEC-V3 §7): yours only, a pool of 40 that fade over 20 s —
// prints in the dust in Naija World, in the mud in Spooky World. Left, right,
// a stride apart, where your feet actually go; none in the air, in water or
// while you crawl. A Harmattan sandstorm wipes them (`wipe`).

import { Color } from "three";

import { DecalPool } from "./decals";
import { canvasTexture, type Painter } from "./tex";

const MAX = 40;
const LIFE = 20;

/** A shoe's sole: a rounded toe, a waist, a heel, soft at the edges. */
const sole: Painter = (g, s) => {
  g.clearRect(0, 0, s, s);
  g.fillStyle = "rgba(255,255,255,0.85)";
  g.filter = `blur(${Math.max(1, s / 40)}px)`;
  g.beginPath();
  g.ellipse(s * 0.5, s * 0.3, s * 0.2, s * 0.22, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(s * 0.5, s * 0.72, s * 0.15, s * 0.16, 0, 0, Math.PI * 2);
  g.fill();
  g.fillRect(s * 0.37, s * 0.32, s * 0.26, s * 0.4);
  g.filter = "none";
  // The tread: lines across the sole, lighter.
  g.globalCompositeOperation = "destination-out";
  g.fillStyle = "rgba(0,0,0,0.35)";
  for (let y = s * 0.12; y < s * 0.9; y += s * 0.07) g.fillRect(0, y, s, s * 0.025);
  g.globalCompositeOperation = "source-over";
};

export type Ground = "dust" | "mud";

export class Footprints {
  readonly pool: DecalPool;
  private walked = 0;
  private left = false;
  private lastX = Number.NaN;
  private lastZ = 0;

  constructor(ground: Ground) {
    const tint = ground === "mud" ? new Color(0.16, 0.11, 0.07) : new Color(0.42, 0.33, 0.24);
    this.pool = new DecalPool(canvasTexture("sole", 64, sole, false), MAX, tint, LIFE, LIFE * 0.6);
    this.pool.mesh.name = "footprints";
  }

  get mesh(): DecalPool["mesh"] {
    return this.pool.mesh;
  }

  /**
   * Follow a body: a print every half stride it travels on the ground.
   * `ok`: the ground takes prints here (not water, not a roof's metal).
   */
  follow(b: { x: number; z: number; h: number; y: number; heading: number; stance: number; vx: number; vz: number }, ok: boolean): void {
    if (Number.isNaN(this.lastX) || Math.hypot(b.x - this.lastX, b.z - this.lastZ) > 3) {
      this.lastX = b.x;
      this.lastZ = b.z;
      return;
    }
    this.walked += Math.hypot(b.x - this.lastX, b.z - this.lastZ);
    this.lastX = b.x;
    this.lastZ = b.z;
    const speed = Math.hypot(b.vx, b.vz);
    // Half a stride: longer when running.
    const half = 0.38 + Math.min(0.5, speed * 0.06);
    if (this.walked < half) return;
    this.walked = 0;
    if (b.y > 0.03 || b.stance === 2 || !ok || speed < 0.3) return;
    this.left = !this.left;
    const side = this.left ? 1 : -1;
    const h = b.heading;
    // A foot sits 11 cm off the body's line.
    const x = b.x + Math.cos(h) * 0.11 * side;
    const z = b.z - Math.sin(h) * 0.11 * side;
    this.pool.add(x, b.h, z, h + Math.PI, 0.14, 0.3, 0.9);
  }

  update(dt: number): void {
    this.pool.update(dt);
  }

  /** Every print gone (the sandstorm; a new life). */
  wipe(): void {
    this.pool.clear();
    this.lastX = Number.NaN;
  }

  dispose(): void {
    this.pool.dispose();
  }
}

