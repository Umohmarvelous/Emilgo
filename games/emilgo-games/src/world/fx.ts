// Elimination effects, pooled so a crowd of catches never allocates.
//
//   drops   low-poly droplets thrown away from the doll (one draw call)
//   stains  marks where they land, gone after five seconds (one draw call)
//   beams   the red flash from Mama Gele's eyes to whoever moved (one draw call)
//
// The look is stylised on purpose — flat red facets, no gore detail — and the
// "Blood" setting swaps it all for grey dust. The setting defaults ON inside
// Lagos Life (18+, per its Terms) and OFF in the EMILGO app, whose audience
// is not age-gated.

import {
  AdditiveBlending,
  CircleGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from "three";

const MAX_DROPS = 180;
const MAX_STAINS = 56;
const STAIN_LIFE = 5;

interface Drop {
  on: boolean;
  p: Vector3;
  v: Vector3;
  s: number;
  life: number;
}

interface Stain {
  on: boolean;
  x: number;
  z: number;
  r: number;
  age: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);
const ZERO = new Matrix4().makeScale(0, 0, 0);

export class Effects {
  readonly group = new Group();
  private readonly dropMesh: InstancedMesh;
  private readonly stainMesh: InstancedMesh;
  private readonly beamMesh: InstancedMesh;
  private readonly dropMat = new MeshLambertMaterial({ color: 0x9b0f14 });
  private readonly stainMat = new MeshBasicMaterial({ color: 0x5e0a0d, transparent: true, opacity: 0.85, depthWrite: false });
  private readonly drops: Drop[] = [];
  private readonly stains: Stain[] = [];
  private nextDrop = 0;
  private nextStain = 0;
  private beamT = 0;
  private readonly beamFrom = [new Vector3(), new Vector3()];
  private readonly beamTo = new Vector3();
  private blood = true;

  constructor() {
    this.dropMesh = new InstancedMesh(new IcosahedronGeometry(1, 0), this.dropMat, MAX_DROPS);
    this.dropMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.dropMesh.frustumCulled = false;

    const stainGeo = new CircleGeometry(1, 9);
    stainGeo.rotateX(-Math.PI / 2);
    this.stainMesh = new InstancedMesh(stainGeo, this.stainMat, MAX_STAINS);
    this.stainMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.stainMesh.frustumCulled = false;
    this.stainMesh.renderOrder = 2;

    const beamGeo = new CylinderGeometry(1, 1, 1, 5, 1, true);
    beamGeo.translate(0, 0.5, 0); // pivot at one end
    this.beamMesh = new InstancedMesh(
      beamGeo,
      new MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }),
      2,
    );
    this.beamMesh.frustumCulled = false;
    this.beamMesh.visible = false;

    for (let i = 0; i < MAX_DROPS; i++) {
      this.drops.push({ on: false, p: new Vector3(), v: new Vector3(), s: 0, life: 0 });
      this.dropMesh.setMatrixAt(i, ZERO);
    }
    for (let i = 0; i < MAX_STAINS; i++) {
      this.stains.push({ on: false, x: 0, z: 0, r: 0, age: 0 });
      this.stainMesh.setMatrixAt(i, ZERO);
    }
    this.group.add(this.stainMesh, this.dropMesh, this.beamMesh);
  }

  setBlood(on: boolean): void {
    this.blood = on;
    this.dropMat.color.set(on ? 0x9b0f14 : 0x9e9890);
    this.stainMat.color.set(on ? 0x5e0a0d : 0x8a8478);
    this.stainMat.opacity = on ? 0.85 : 0.45;
  }

  /** Throw `count` drops from `origin`, mostly along `away` (unit, horizontal). */
  burst(origin: Vector3, away: Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      const d = this.drops[this.nextDrop];
      this.nextDrop = (this.nextDrop + 1) % MAX_DROPS;
      d.on = true;
      d.p.copy(origin);
      const spread = 1.6;
      d.v.set(
        away.x * (2.2 + Math.random() * 2.6) + (Math.random() - 0.5) * spread,
        1.2 + Math.random() * 3.2,
        away.z * (2.2 + Math.random() * 2.6) + (Math.random() - 0.5) * spread,
      );
      d.s = this.blood ? 0.02 + Math.random() * 0.035 : 0.015 + Math.random() * 0.025;
      d.life = 2.5;
    }
    // A pool under the body as well.
    this.stain(origin.x + away.x * 0.9, origin.z + away.z * 0.9, this.blood ? 0.9 : 0.6);
  }

  /** Eye beams from both eyes to `to`, for a fraction of a second. */
  beam(eyeL: Vector3, eyeR: Vector3, to: Vector3): void {
    this.beamFrom[0].copy(eyeL);
    this.beamFrom[1].copy(eyeR);
    this.beamTo.copy(to);
    this.beamT = 0.28;
  }

  stain(x: number, z: number, r: number): void {
    const s = this.stains[this.nextStain];
    this.nextStain = (this.nextStain + 1) % MAX_STAINS;
    s.on = true;
    s.x = x;
    s.z = z;
    s.r = r;
    s.age = 0;
  }

  clear(): void {
    for (let i = 0; i < MAX_DROPS; i++) {
      this.drops[i].on = false;
      this.dropMesh.setMatrixAt(i, ZERO);
    }
    for (let i = 0; i < MAX_STAINS; i++) {
      this.stains[i].on = false;
      this.stainMesh.setMatrixAt(i, ZERO);
    }
    this.dropMesh.instanceMatrix.needsUpdate = true;
    this.stainMesh.instanceMatrix.needsUpdate = true;
    this.beamT = 0;
    this.beamMesh.visible = false;
  }

  update(dt: number): void {
    // Drops: ballistic, then a small stain where they land.
    for (let i = 0; i < MAX_DROPS; i++) {
      const d = this.drops[i];
      if (!d.on) continue;
      d.life -= dt;
      d.v.y -= 9.8 * dt;
      d.p.addScaledVector(d.v, dt);
      if (d.p.y <= 0.02 || d.life <= 0) {
        d.on = false;
        this.dropMesh.setMatrixAt(i, ZERO);
        if (d.life > 0 && Math.random() < 0.55) this.stain(d.p.x, d.p.z, 0.08 + Math.random() * 0.16);
        continue;
      }
      _s.setScalar(d.s);
      _m.compose(d.p, _q.identity(), _s);
      this.dropMesh.setMatrixAt(i, _m);
    }
    this.dropMesh.instanceMatrix.needsUpdate = true;

    // Stains: spread quickly, sit, then shrink away at five seconds.
    for (let i = 0; i < MAX_STAINS; i++) {
      const s = this.stains[i];
      if (!s.on) continue;
      s.age += dt;
      if (s.age >= STAIN_LIFE) {
        s.on = false;
        this.stainMesh.setMatrixAt(i, ZERO);
        continue;
      }
      const grow = Math.min(1, s.age / 0.35);
      const fade = s.age > STAIN_LIFE - 0.8 ? (STAIN_LIFE - s.age) / 0.8 : 1;
      const r = s.r * grow * fade;
      _v.set(s.x, 0.022 + (i % 7) * 0.0006, s.z); // tiny lift per slot: no z-fighting
      _s.set(r, 1, r * 0.85);
      _m.compose(_v, _q.setFromAxisAngle(_up, i * 1.37), _s);
      this.stainMesh.setMatrixAt(i, _m);
    }
    this.stainMesh.instanceMatrix.needsUpdate = true;

    // Beams.
    if (this.beamT > 0) {
      this.beamT -= dt;
      this.beamMesh.visible = this.beamT > 0;
      const w = 0.05 + this.beamT * 0.12;
      for (let k = 0; k < 2; k++) {
        const from = this.beamFrom[k];
        _v.subVectors(this.beamTo, from);
        const len = _v.length();
        _q.setFromUnitVectors(_up, _v.normalize());
        _s.set(w, len, w);
        _m.compose(from, _q, _s);
        this.beamMesh.setMatrixAt(k, _m);
      }
      this.beamMesh.instanceMatrix.needsUpdate = true;
    }
  }
}
