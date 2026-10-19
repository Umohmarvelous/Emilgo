// Blood (SPEC-V2 §2.6 step 3), pooled so a crowd of catches never allocates.
//
//   drops   thrown from the chest, mostly away from Mama (the shot goes
//           through), stretched along their flight (one draw call)
//   splats  where the drops land: irregular blots, stretched the way they were
//           going; they stay until the match ends (one draw call)
//   pools   one under each body, spreading for a few seconds after it lands;
//           they stay too (the same draw call as the splats)
//
// The "Blood" setting swaps it all for grey dust (no pools, just a scuff).
// It defaults ON inside Lagos Life (18+, per its Terms) and OFF in the EMILGO
// app, whose audience is not age-gated.

import {
  CanvasTexture,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three";

const MAX_DROPS = 220;
const MAX_SPLATS = 200;
/** One pool per contestant (rooms of 20). */
const MAX_POOLS = 20;
/** Seconds a pool takes to spread to full size. */
const POOL_GROW = 3.5;

interface Drop {
  on: boolean;
  p: Vector3;
  v: Vector3;
  s: number;
  life: number;
  /** Leaves a splat where it lands (not in a replay: the ground has them already). */
  mark: boolean;
}

interface Mark {
  on: boolean;
  x: number;
  z: number;
  /** Radius, stretch along `ang`, angle. */
  r: number;
  k: number;
  ang: number;
  age: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);
const ZERO = new Matrix4().makeScale(0, 0, 0);

/** A soft, irregular blot (drawn once): a dark middle, ragged edge, transparent outside. */
function blotTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (!g) return null;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = "#fff";
  // A body of overlapping lobes, then small satellite drops round the rim.
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * 9;
    g.globalAlpha = 0.55 + rnd() * 0.45;
    g.beginPath();
    g.arc(32 + Math.cos(a) * d, 32 + Math.sin(a) * d, 12 + rnd() * 9, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 22 + rnd() * 8;
    g.globalAlpha = 0.6 + rnd() * 0.4;
    g.beginPath();
    g.arc(32 + Math.cos(a) * d, 32 + Math.sin(a) * d, 0.8 + rnd() * 2.2, 0, Math.PI * 2);
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

export class Blood {
  readonly group = new Group();
  private readonly dropMesh: InstancedMesh;
  private readonly markMesh: InstancedMesh;
  private readonly dropMat = new MeshLambertMaterial({ color: 0x8e0c12 });
  private readonly markMat: MeshBasicMaterial;
  private readonly drops: Drop[] = [];
  /** Pools first (one slot per contestant), then the splats (a ring). */
  private readonly marks: Mark[] = [];
  private nextDrop = 0;
  private nextSplat = 0;
  private on = true;

  constructor() {
    this.dropMesh = new InstancedMesh(new IcosahedronGeometry(1, 0), this.dropMat, MAX_DROPS);
    this.dropMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.dropMesh.frustumCulled = false;

    const tex = blotTexture();
    this.markMat = new MeshBasicMaterial({ color: 0x5a080c, map: tex, transparent: true, opacity: 0.9, depthWrite: false, alphaTest: 0.02 });
    const plane = new PlaneGeometry(2, 2);
    plane.rotateX(-Math.PI / 2);
    this.markMesh = new InstancedMesh(plane, this.markMat, MAX_POOLS + MAX_SPLATS);
    this.markMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.markMesh.frustumCulled = false;
    this.markMesh.renderOrder = 2;

    for (let i = 0; i < MAX_DROPS; i++) {
      this.drops.push({ on: false, p: new Vector3(), v: new Vector3(), s: 0, life: 0, mark: true });
      this.dropMesh.setMatrixAt(i, ZERO);
    }
    for (let i = 0; i < MAX_POOLS + MAX_SPLATS; i++) {
      this.marks.push({ on: false, x: 0, z: 0, r: 0, k: 1, ang: 0, age: 0 });
      this.markMesh.setMatrixAt(i, ZERO);
    }
    this.group.add(this.markMesh, this.dropMesh);
  }

  setOn(on: boolean): void {
    this.on = on;
    this.dropMat.color.set(on ? 0x8e0c12 : 0x9e9890);
    this.markMat.color.set(on ? 0x5a080c : 0x8a8478);
    this.markMat.opacity = on ? 0.9 : 0.4;
  }

  /**
   * The shot: `count` drops from `origin`. Most fly on along `away` (unit,
   * horizontal: away from Mama), a few spray back towards her. `lasting`:
   * marks on the ground (a replay's drops leave none).
   */
  burst(origin: Vector3, away: Vector3, count: number, lasting = true): void {
    for (let i = 0; i < count; i++) {
      const d = this.drops[this.nextDrop];
      this.nextDrop = (this.nextDrop + 1) % MAX_DROPS;
      d.on = true;
      d.p.copy(origin);
      const back = i % 6 === 0 ? -0.45 : 1;
      const speed = (2 + Math.random() * 3.4) * back;
      const spread = 1.8;
      d.v.set(away.x * speed + (Math.random() - 0.5) * spread, 0.6 + Math.random() * 3, away.z * speed + (Math.random() - 0.5) * spread);
      d.s = this.on ? 0.014 + Math.random() * 0.03 : 0.012 + Math.random() * 0.022;
      d.life = 2.5;
      d.mark = lasting;
    }
    if (!lasting) return;
    // A spray on the ground right where they were hit.
    for (let i = 0; i < 3; i++) this.splat(origin.x + away.x * (0.3 + i * 0.35), origin.z + away.z * (0.3 + i * 0.35), 0.16 + Math.random() * 0.12, 1.8, Math.atan2(away.x, away.z));
  }

  /** Contestant `i`'s body lies at (x, z): its pool spreads there (call again as the body settles). */
  pool(i: number, x: number, z: number): void {
    if (i < 0 || i >= MAX_POOLS) return;
    const m = this.marks[i];
    if (!m.on) {
      m.on = true;
      m.age = 0;
      // Everyone's pool is a little different.
      m.r = this.on ? 0.55 + ((i * 0.37) % 0.25) : 0.4;
      m.k = 1.15 + ((i * 0.53) % 0.3);
      m.ang = i * 1.37;
    }
    m.x = x;
    m.z = z;
  }

  private splat(x: number, z: number, r: number, k: number, ang: number): void {
    const m = this.marks[MAX_POOLS + this.nextSplat];
    this.nextSplat = (this.nextSplat + 1) % MAX_SPLATS;
    m.on = true;
    m.x = x;
    m.z = z;
    m.r = r;
    m.k = k;
    m.ang = ang;
    m.age = 0;
  }

  clear(): void {
    for (let i = 0; i < MAX_DROPS; i++) {
      this.drops[i].on = false;
      this.dropMesh.setMatrixAt(i, ZERO);
    }
    for (let i = 0; i < this.marks.length; i++) {
      this.marks[i].on = false;
      this.markMesh.setMatrixAt(i, ZERO);
    }
    this.dropMesh.instanceMatrix.needsUpdate = true;
    this.markMesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    // Drops: ballistic, stretched along their flight; a splat where they land.
    for (let i = 0; i < MAX_DROPS; i++) {
      const d = this.drops[i];
      if (!d.on) continue;
      d.life -= dt;
      d.v.y -= 9.8 * dt;
      d.p.addScaledVector(d.v, dt);
      if (d.p.y <= 0.02 || d.life <= 0) {
        d.on = false;
        this.dropMesh.setMatrixAt(i, ZERO);
        if (d.mark && d.life > 0 && Math.random() < 0.6) {
          const hv = Math.hypot(d.v.x, d.v.z);
          this.splat(d.p.x, d.p.z, d.s * (3 + Math.random() * 3), 1 + Math.min(2.2, hv * 0.4), Math.atan2(d.v.x, d.v.z));
        }
        continue;
      }
      const sp = d.v.length();
      _q.setFromUnitVectors(_up, _v.copy(d.v).divideScalar(sp || 1));
      _s.set(d.s, d.s * (1 + sp * 0.35), d.s);
      _m.compose(d.p, _q, _s);
      this.dropMesh.setMatrixAt(i, _m);
    }
    this.dropMesh.instanceMatrix.needsUpdate = true;

    // Marks: splats spread at once and stay; pools spread slowly and stay.
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i];
      if (!m.on) continue;
      m.age += dt;
      const isPool = i < MAX_POOLS;
      const grow = isPool ? 1 - Math.pow(1 - Math.min(1, m.age / POOL_GROW), 2) : Math.min(1, m.age / 0.12);
      const r = m.r * (isPool ? 0.15 + 0.85 * grow : grow);
      // A tiny lift per slot: no z-fighting between overlapping marks.
      _v.set(m.x, 0.021 + (i % 11) * 0.0005, m.z);
      _s.set(r, 1, r * m.k);
      _m.compose(_v, _q.setFromAxisAngle(_up, m.ang), _s);
      this.markMesh.setMatrixAt(i, _m);
    }
    this.markMesh.instanceMatrix.needsUpdate = true;
  }
}
